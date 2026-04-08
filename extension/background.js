const KEEPALIVE_ALARM = "keepalive";
const DEFAULT_INTERVAL = 5;
const DEFAULT_SETTINGS = { interval: DEFAULT_INTERVAL, onlyWithOpenTab: true };

async function init() {
  await scheduleKeepalive();
  browser.alarms.onAlarm.addListener(onAlarm);
}

async function onAlarm(alarm) {
  if (alarm.name === KEEPALIVE_ALARM) await pingProtectedSites();
}

async function scheduleKeepalive() {
  await browser.alarms.clear(KEEPALIVE_ALARM);
  const settings = await getSettings();
  browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: settings.interval });
}

async function getProtectedSites() {
  const { sites } = await browser.storage.local.get("sites");
  return sites || [];
}

async function saveProtectedSites(sites) {
  await browser.storage.local.set({ sites });
}

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return mergeSettings(settings || {}, DEFAULT_SETTINGS);
}

async function saveSettings(settings) {
  await browser.storage.local.set({ settings });
  await scheduleKeepalive();
}

async function addProtectedSite(domain, url) {
  const sites = await getProtectedSites();
  if (sites.find(s => s.domain === domain)) return sites;
  sites.push(buildSiteEntry(domain, url));
  await saveProtectedSites(sites);
  return sites;
}

async function removeProtectedSite(domain) {
  let sites = await getProtectedSites();
  sites = sites.filter(s => s.domain !== domain);
  await saveProtectedSites(sites);
  return sites;
}

async function toggleProtectedSite(domain, enabled) {
  const sites = await getProtectedSites();
  const site = sites.find(s => s.domain === domain);
  if (site) site.enabled = enabled;
  await saveProtectedSites(sites);
  return sites;
}

async function updateSiteUrl(domain, url) {
  const sites = await getProtectedSites();
  const site = sites.find(s => s.domain === domain);
  if (site) site.url = url;
  await saveProtectedSites(sites);
  return sites;
}

async function pingProtectedSites() {
  const sites = await getProtectedSites();
  const settings = await getSettings();
  const openTabs = await browser.tabs.query({});
  const openDomains = new Set();

  for (const tab of openTabs) {
    try {
      openDomains.add(new URL(tab.url).hostname);
    } catch {}
  }

  const targets = filterPingTargets(sites, settings, openDomains);
  if (targets.length === 0) return;

  for (const site of targets) {
    try {
      const res = await fetch(site.url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow"
      });
      site.lastPing = Date.now();
      site.lastStatus = res.ok ? "ok" : `${res.status}`;
    } catch {
      site.lastPing = Date.now();
      site.lastStatus = "error";
    }
  }

  await saveProtectedSites(sites);
}

async function groupTabsByDomain() {
  if (!browser.tabs.group) return;

  const tabs = await browser.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(t => t.active);
  const win = await browser.windows.getCurrent();
  const groups = await browser.tabGroups.query({ windowId: win.id });
  const domainTabs = groupByDomain(tabs);

  for (const [domain, tabList] of domainTabs) {
    if (tabList.length === 0) continue;
    const existing = groups.find(g => g.title === domain);
    const tabIds = tabList.map(t => t.id);
    try {
      if (existing) {
        await browser.tabs.group({ tabIds, groupId: existing.id });
      } else {
        const groupId = await browser.tabs.group({ tabIds, createProperties: { windowId: win.id } });
        await browser.tabGroups.update(groupId, { title: domain });
      }
    } catch (e) {
      console.error("Better Tabs: domain group error", domain, e);
    }
  }

  if (activeTab) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
}

async function ungroupAllTabs() {
  if (!browser.tabGroups) return;

  const win = await browser.windows.getCurrent();
  const groups = await browser.tabGroups.query({ windowId: win.id });

  for (const group of groups) {
    try {
      const tabs = await browser.tabs.query({ groupId: group.id });
      if (tabs.length > 0 && browser.tabs.ungroup) {
        await browser.tabs.ungroup(tabs.map(t => t.id));
      }
    } catch (e) {
      console.error("Better Tabs: error removing group", group.id, e);
    }
  }
}

async function sortTabsAlphabetically() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(t => t.active);
  const sorted = sortTabs(tabs);

  const pinnedCount = tabs.filter(t => t.pinned).length;
  for (let i = 0; i < sorted.length; i++) {
    await browser.tabs.move(sorted[i].id, { index: pinnedCount + i });
  }

  if (activeTab) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
}

async function closeDuplicateTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const toClose = findDuplicates(tabs);

  if (toClose.length > 0) {
    await browser.tabs.remove(toClose);
  }
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "groupByDomain") {
    await groupTabsByDomain();
    return { ok: true };
  }
  if (msg.type === "ungroupAll") {
    await ungroupAllTabs();
    return { ok: true };
  }
  if (msg.type === "sortTabs") {
    await sortTabsAlphabetically();
    return { ok: true };
  }
  if (msg.type === "closeDuplicates") {
    await closeDuplicateTabs();
    return { ok: true };
  }

  if (msg.type === "getSites") {
    return await getProtectedSites();
  }
  if (msg.type === "getSettings") {
    return await getSettings();
  }
  if (msg.type === "saveSettings") {
    await saveSettings(msg.settings);
    return { ok: true };
  }
  if (msg.type === "addSite") {
    return await addProtectedSite(msg.domain, msg.url);
  }
  if (msg.type === "removeSite") {
    return await removeProtectedSite(msg.domain);
  }
  if (msg.type === "toggleSite") {
    return await toggleProtectedSite(msg.domain, msg.enabled);
  }
  if (msg.type === "updateSiteUrl") {
    return await updateSiteUrl(msg.domain, msg.url);
  }
  if (msg.type === "pingNow") {
    await pingProtectedSites();
    return await getProtectedSites();
  }
  if (msg.type === "getCurrentTab") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return { domain: null, url: null };
    const domain = extractDomain(tab.url);
    return { domain, url: tab.url };
  }
});

init();
