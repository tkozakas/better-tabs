const siteListEl = document.getElementById("site-list");
const toastArea = document.getElementById("toast-area");
const intervalSelect = document.getElementById("interval-select");
const checkboxes = [
  ["ignore-query-check", "dedupeIgnoreQuery"],
  ["base-domain-check", "groupByBaseDomain"],
  ["live-mode-check", "liveMode"],
  ["live-group-check", "liveAutoGroup"]
];

const INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30];
let expandedDomain = null;

async function init() {
  await renderSites();
  await loadSettings();
}

function statusClass(site) {
  if (!site.lastPing) return "pending";
  if (site.lastStatus === "ok") return "ok";
  if (site.lastStatus === "redirected") return "warn";
  return "error";
}

function statusTitle(site) {
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
  const pingInfo = el("span", "ping-info", site.lastPing ? formatAgo(site.lastPing) : "never");
  const toggleBtn = el("button", "toggle-btn", site.enabled ? "⏸" : "▶");
  toggleBtn.title = site.enabled ? "Pause pinging" : "Resume pinging";
  const removeBtn = el("button", "remove-btn", "×");
  removeBtn.title = "Remove";
  row.append(dot, domain, pingInfo, toggleBtn, removeBtn);

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

  removeBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "removeSite", domain: site.domain });
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

async function loadSettings() {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  intervalSelect.value = String(settings.interval || 5);
  for (const [id, key] of checkboxes) {
    document.getElementById(id).checked = settings[key] === true;
  }
}

async function updateSetting(key, value) {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  settings[key] = value;
  await browser.runtime.sendMessage({ type: "saveSettings", settings });
}

function formatAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function showUndoToast(closed) {
  toastArea.textContent = "";
  const toast = el("div", "toast");
  const undoBtn = el("button", null, "Undo");
  toast.append(el("span", null, `Closed ${closed} tab${closed === 1 ? "" : "s"}`), undoBtn);
  undoBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "undoClose" });
    toast.remove();
  });
  toastArea.appendChild(toast);
  setTimeout(() => toast.remove(), 10000);
}

document.getElementById("group-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "groupByDomain" });
});

document.getElementById("ungroup-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "ungroupAll" });
});

document.getElementById("sort-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "sortTabs" });
});

document.getElementById("close-dupes-btn").addEventListener("click", async () => {
  const { closed } = await browser.runtime.sendMessage({ type: "closeDuplicates" });
  if (closed > 0) showUndoToast(closed);
});

document.getElementById("protect-btn").addEventListener("click", async () => {
  const { domain, url } = await browser.runtime.sendMessage({ type: "getCurrentTab" });
  if (!domain) return;
  await browser.runtime.sendMessage({ type: "addSite", domain, url });
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

document.getElementById("export-btn").addEventListener("click", openTransferPage);
document.getElementById("import-btn").addEventListener("click", openTransferPage);

intervalSelect.addEventListener("change", () => {
  updateSetting("interval", Number(intervalSelect.value));
});

for (const [id, key] of checkboxes) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => updateSetting(key, el.checked));
}

init();
