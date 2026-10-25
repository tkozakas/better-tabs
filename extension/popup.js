const siteListEl = document.getElementById("site-list");
const toastArea = document.getElementById("toast-area");
const intervalSelect = document.getElementById("interval-select");
const checkboxes = [
  ["ignore-query-check", "dedupeIgnoreQuery"],
  ["base-domain-check", "groupByBaseDomain"],
  ["live-mode-check", "liveMode"],
  ["live-sort-check", "liveSort"],
  ["live-group-check", "liveAutoGroup"]
];
const liveSubRows = ["live-sort-row", "live-group-row"];
const protectBtn = document.getElementById("protect-btn");
const protectLabel = document.getElementById("protect-label");

const INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30];
const RECENT_CLOSE_MS = 60000;
let expandedDomain = null;
let currentTab = null;

async function init() {
  for (const min of INTERVAL_OPTIONS) intervalSelect.append(new Option(`${min} min`, String(min)));
  await Promise.all([renderSites(), loadSettings(), loadCurrentTab(), showRecentLiveClose()]);
}

async function loadCurrentTab() {
  currentTab = await browser.runtime.sendMessage({ type: "getCurrentTab" });
  await refreshProtectButton();
}

async function refreshProtectButton() {
  if (!currentTab || !currentTab.domain) {
    protectLabel.textContent = "Can't protect this page";
    protectBtn.disabled = true;
    return;
  }
  if (currentTab.protected) {
    protectLabel.textContent = "Protected ✓";
    protectBtn.disabled = true;
    return;
  }
  protectLabel.textContent = "Keep Me Logged In on This Site";
  protectBtn.disabled = false;
}

async function showRecentLiveClose() {
  const last = await browser.runtime.sendMessage({ type: "getLastClosed" });
  if (last && last.count > 0 && Date.now() - last.at < RECENT_CLOSE_MS) {
    showUndoToast(last.count, `Live mode closed ${last.count} tab${last.count === 1 ? "" : "s"}`);
  }
}

function statusClass(site) {
  if (site.lastStatus === "no-access" || !site.hasAccess) return "warn";
  if (!site.lastPing) return "pending";
  if (site.lastStatus === "ok") return "ok";
  if (site.lastStatus === "redirected") return "warn";
  return "error";
}

function statusText(site) {
  if (!site.hasAccess || site.lastStatus === "no-access") return "No access";
  if (!site.lastPing) return "Not pinged";
  if (site.lastStatus === "ok") return "OK";
  if (site.lastStatus === "redirected") return "Logged out?";
  return "Error";
}

function statusTitle(site) {
  if (!site.hasAccess || site.lastStatus === "no-access") return "Permission for this site was not granted";
  if (!site.lastPing) return "Not pinged yet";
  if (site.lastStatus === "ok") return "Session alive";
  if (site.lastStatus === "redirected") return "Ping was redirected — you may be logged out";
  return `Last ping failed: ${site.lastStatus}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildSiteItem(site) {
  const item = el("div", "site-item" + (site.domain === expandedDomain ? " expanded" : ""));

  const row = el("div", "site-row");
  const dot = el("span", `status-dot ${statusClass(site)}`);
  dot.title = statusTitle(site);
  const domain = el("span", "domain", site.domain);
  domain.title = "Click to edit ping URL and interval";
  const statusLabel = el("span", "status-text", statusText(site));
  statusLabel.title = statusTitle(site);
  const pingInfo = el("span", "ping-info", site.lastPing ? formatAgo(site.lastPing) : "never");
  const toggleBtn = el("button", "toggle-btn", site.enabled ? "⏸" : "▶");
  toggleBtn.title = site.enabled ? "Pause pinging" : "Resume pinging";
  const removeBtn = el("button", "remove-btn", "×");
  removeBtn.title = "Remove";
  row.append(dot, domain, statusLabel, pingInfo);
  if (!site.hasAccess) {
    const grantBtn = el("button", "grant-btn", "Grant access");
    grantBtn.title = `Allow Better Tabs to ping ${site.domain}`;
    grantBtn.addEventListener("click", async () => {
      const granted = await browser.permissions.request({ origins: [originFor(site.domain)] });
      if (!granted) {
        showToast("Access not granted", true);
        return;
      }
      await browser.runtime.sendMessage({ type: "pingNow" });
      await renderSites();
    });
    row.append(grantBtn);
  }
  row.append(toggleBtn, removeBtn);

  const detail = el("div", "site-detail");
  const urlInput = el("input", "url-input");
  urlInput.type = "url";
  urlInput.value = site.url;
  const intervalSel = el("select", "site-interval");
  intervalSel.append(new Option("default", ""));
  for (const min of INTERVAL_OPTIONS) {
    intervalSel.append(new Option(`${min} min`, String(min), false, site.interval === min));
  }
  detail.append(el("label", null, "Ping URL"), urlInput, el("label", null, "Ping interval for this site"), intervalSel);

  item.append(row, detail);

  domain.addEventListener("click", async () => {
    expandedDomain = expandedDomain === site.domain ? null : site.domain;
    await renderSites();
  });

  toggleBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "toggleSite", domain: site.domain, enabled: !site.enabled });
    await renderSites();
  });

  let confirmTimer = null;
  removeBtn.addEventListener("click", async () => {
    if (!confirmTimer) {
      removeBtn.textContent = "Remove?";
      removeBtn.classList.add("confirming");
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        removeBtn.textContent = "×";
        removeBtn.classList.remove("confirming");
      }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
    await browser.runtime.sendMessage({ type: "removeSite", domain: site.domain });
    if (currentTab && currentTab.domain === site.domain) {
      currentTab.protected = false;
      await refreshProtectButton();
    }
    await renderSites();
  });

  urlInput.addEventListener("change", async () => {
    await browser.runtime.sendMessage({ type: "updateSite", domain: site.domain, fields: { url: urlInput.value.trim() } });
    await renderSites();
  });

  intervalSel.addEventListener("change", async (e) => {
    const value = e.target.value ? Number(e.target.value) : null;
    await browser.runtime.sendMessage({ type: "updateSite", domain: site.domain, fields: { interval: value } });
    await renderSites();
  });

  return item;
}

async function renderSites() {
  const sites = await browser.runtime.sendMessage({ type: "getSites" });
  siteListEl.textContent = "";

  if (!sites || sites.length === 0) {
    siteListEl.appendChild(el("div", "empty-state", "No protected sites yet"));
    return;
  }

  sites.sort((a, b) => a.domain.localeCompare(b.domain));
  for (const site of sites) siteListEl.appendChild(buildSiteItem(site));
}

function originFor(domain) {
  return `*://${domain}/*`;
}

function applyLiveModeState(enabled) {
  for (const id of liveSubRows) {
    const row = document.getElementById(id);
    row.classList.toggle("disabled", !enabled);
    row.querySelector("input").disabled = !enabled;
  }
}

async function loadSettings() {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  intervalSelect.value = String(settings.interval || 5);
  for (const [id, key] of checkboxes) {
    document.getElementById(id).checked = settings[key] === true;
  }
  document.getElementById("live-sort-check").checked = settings.liveSort !== false;
  applyLiveModeState(settings.liveMode === true);
}

async function updateSetting(key, value) {
  await browser.runtime.sendMessage({ type: "updateSettings", patch: { [key]: value } });
}

function formatAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

let toastTimer = null;

function showToast(message, isError) {
  clearTimeout(toastTimer);
  toastArea.textContent = "";
  const toast = el("div", "toast" + (isError ? " error" : ""));
  toast.append(el("span", null, message));
  toastArea.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 10000);
  return toast;
}

function showUndoToast(closed, message) {
  const toast = showToast(message || `Closed ${closed} tab${closed === 1 ? "" : "s"}`);
  const undoBtn = el("button", null, "Undo");
  toast.append(undoBtn);
  undoBtn.addEventListener("click", async () => {
    const { restored } = await browser.runtime.sendMessage({ type: "undoClose" });
    showToast(`Restored ${restored} tab${restored === 1 ? "" : "s"}`);
  });
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function bindAction(id, type, describe) {
  document.getElementById(id).addEventListener("click", async () => {
    const { count } = await browser.runtime.sendMessage({ type });
    showToast(describe(count));
  });
}

bindAction("group-btn", "groupByDomain", (n) => (n > 0 ? `Grouped ${plural(n, "tab")}` : "Nothing to group"));
bindAction("ungroup-btn", "ungroupAll", (n) => (n > 0 ? `Ungrouped ${plural(n, "tab")}` : "No groups to remove"));
bindAction("sort-btn", "sortTabs", (n) => (n > 0 ? `Moved ${plural(n, "tab")}` : "Nothing to sort"));

document.getElementById("close-dupes-btn").addEventListener("click", async () => {
  const { closed } = await browser.runtime.sendMessage({ type: "closeDuplicates" });
  if (closed > 0) showUndoToast(closed);
  else showToast("No duplicates found");
});

protectBtn.addEventListener("click", async () => {
  if (!currentTab || !currentTab.domain) return;
  const { domain, url } = currentTab;
  const granted = await browser.permissions.request({ origins: [originFor(domain)] });
  if (!granted) {
    showToast("Access denied — site not protected", true);
    return;
  }
  await browser.runtime.sendMessage({ type: "addSite", domain, url });
  currentTab.protected = true;
  await refreshProtectButton();
  await renderSites();
});

document.getElementById("ping-now-btn").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "pingNow" });
  await renderSites();
});

async function openTransferPage() {
  await browser.tabs.create({ url: browser.runtime.getURL("transfer.html") });
  window.close();
}

document.getElementById("transfer-btn").addEventListener("click", openTransferPage);

intervalSelect.addEventListener("change", () => {
  updateSetting("interval", Number(intervalSelect.value));
});

for (const [id, key] of checkboxes) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => {
    if (key === "liveMode") applyLiveModeState(el.checked);
    updateSetting(key, el.checked);
  });
}

init();
