const siteListEl = document.getElementById("site-list");
const intervalSelect = document.getElementById("interval-select");
const openTabCheck = document.getElementById("open-tab-check");

async function init() {
  await renderSites();
  await loadSettings();
}

async function renderSites() {
  const sites = await browser.runtime.sendMessage({ type: "getSites" });
  siteListEl.innerHTML = "";

  if (!sites || sites.length === 0) {
    siteListEl.innerHTML = '<div class="empty-state">No protected sites yet</div>';
    return;
  }

  for (const site of sites) {
    const item = document.createElement("div");
    item.className = "site-item";

    const statusClass = !site.lastPing ? "pending" : site.lastStatus === "ok" ? "ok" : "error";
    const pingInfo = site.lastPing ? formatAgo(site.lastPing) : "never";

    item.innerHTML = `
      <span class="status-dot ${statusClass}"></span>
      <span class="domain" title="${site.url}">${site.domain}</span>
      <span class="ping-info">${pingInfo}</span>
      <button class="toggle-btn" data-domain="${site.domain}" data-enabled="${site.enabled}" title="${site.enabled ? 'Disable' : 'Enable'}">${site.enabled ? '⏸' : '▶'}</button>
      <button class="remove-btn" data-domain="${site.domain}" title="Remove">&times;</button>
    `;
    siteListEl.appendChild(item);
  }

  siteListEl.querySelectorAll(".remove-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ type: "removeSite", domain: btn.dataset.domain });
      await renderSites();
    });
  });

  siteListEl.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const enabled = btn.dataset.enabled === "true";
      await browser.runtime.sendMessage({ type: "toggleSite", domain: btn.dataset.domain, enabled: !enabled });
      await renderSites();
    });
  });
}

async function loadSettings() {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  intervalSelect.value = String(settings.interval || 5);
  openTabCheck.checked = settings.onlyWithOpenTab !== false;
}

function formatAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
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

document.getElementById("close-dupes-btn").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "closeDuplicates" });
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

intervalSelect.addEventListener("change", async () => {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  settings.interval = Number(intervalSelect.value);
  await browser.runtime.sendMessage({ type: "saveSettings", settings });
});

openTabCheck.addEventListener("change", async () => {
  const settings = await browser.runtime.sendMessage({ type: "getSettings" });
  settings.onlyWithOpenTab = openTabCheck.checked;
  await browser.runtime.sendMessage({ type: "saveSettings", settings });
});

init();
