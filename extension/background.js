const ALARM_PREFIX = "keepalive:";
const DEFAULT_INTERVAL = 5;
const DEFAULT_SETTINGS = {
  interval: DEFAULT_INTERVAL,
  dedupeIgnoreQuery: false,
  liveMode: false,
  liveAutoGroup: false,
  groupByBaseDomain: false
};
const LIVE_DEBOUNCE_MS = 1000;

const store = browser.storage.sync || browser.storage.local;

async function migrateToSyncStorage() {
  if (store === browser.storage.local) return;
  try {
    const synced = await store.get(["sites", "settings"]);
    if (synced.sites || synced.settings) return;
    const local = await browser.storage.local.get(["sites", "settings"]);
    if (local.sites || local.settings) await store.set(local);
  } catch {}
}

async function init() {
  await migrateToSyncStorage();
  await scheduleKeepalive();
  await updateBadge();
  browser.alarms.onAlarm.addListener(onAlarm);
  browser.tabs.onCreated.addListener(scheduleLiveCleanup);
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") scheduleLiveCleanup();
  });
  if (browser.commands) {
    browser.commands.onCommand.addListener(onCommand);
  }
}

async function onCommand(command) {
  if (command === "group-tabs") await groupTabsByDomain();
  if (command === "sort-tabs") await sortTabsAlphabetically();
  if (command === "close-duplicates") await closeDuplicateTabs();
}

let liveTimer = null;
let liveRunning = false;

function scheduleLiveCleanup() {
  if (liveRunning) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runLiveCleanup, LIVE_DEBOUNCE_MS);
}

async function runLiveCleanup() {
  liveTimer = null;
  const settings = await getSettings();
  if (!settings.liveMode) return;
  liveRunning = true;
  try {
    await closeDuplicateTabs();
    if (settings.liveAutoGroup) await groupTabsByDomain();
    await sortTabsAlphabetically();
  } finally {
    liveRunning = false;
  }
}

async function onAlarm(alarm) {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    await pingProtectedSites([alarm.name.slice(ALARM_PREFIX.length)]);
  }
}

async function scheduleKeepalive() {
  const alarms = await browser.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith(ALARM_PREFIX)) await browser.alarms.clear(alarm.name);
  }
  const settings = await getSettings();
  const sites = await getProtectedSites();
  for (const site of filterPingTargets(sites)) {
    browser.alarms.create(ALARM_PREFIX + site.domain, {
      periodInMinutes: effectiveInterval(site, settings)
    });
  }
}

async function getProtectedSites() {
  const { sites } = await store.get("sites");
  return sites || [];
}

async function saveProtectedSites(sites) {
  await store.set({ sites });
  await updateBadge();
}

async function getSettings() {
  const { settings } = await store.get("settings");
  return mergeSettings(settings || {}, DEFAULT_SETTINGS);
}

async function saveSettings(settings) {
  await store.set({ settings });
  await scheduleKeepalive();
}

async function updateBadge() {
  const sites = await getProtectedSites();
  const active = filterPingTargets(sites);
  const failing = active.filter(s => s.lastPing && s.lastStatus !== "ok");
  await browser.browserAction.setBadgeText({ text: active.length ? String(active.length) : "" });
  await browser.browserAction.setBadgeBackgroundColor({ color: failing.length ? "#f85149" : "#238636" });
}

function notifySessionLost(site) {
  if (!browser.notifications) return;
  browser.notifications.create(`session-lost:${site.domain}`, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.png"),
    title: "Better Tabs — session at risk",
    message: `Ping for ${site.domain} returned "${site.lastStatus}". You may have been logged out.`
  });
}

async function mutateSites(mutate) {
  const sites = await getProtectedSites();
  const result = mutate(sites);
  await saveProtectedSites(result || sites);
  await scheduleKeepalive();
  return result || sites;
}

async function addProtectedSite(domain, url) {
  return mutateSites(sites => {
    if (!sites.find(s => s.domain === domain)) sites.push(buildSiteEntry(domain, url));
    return sites;
  });
}

async function removeProtectedSite(domain) {
  return mutateSites(sites => sites.filter(s => s.domain !== domain));
}

async function toggleProtectedSite(domain, enabled) {
  return mutateSites(sites => {
    const site = sites.find(s => s.domain === domain);
    if (site) site.enabled = enabled;
    return sites;
  });
}

async function importProtectedSites(imported) {
  return mutateSites(sites => mergeSites(sites, Array.isArray(imported) ? imported : []));
}

async function updateSite(domain, fields) {
  return mutateSites(sites => {
    const site = sites.find(s => s.domain === domain);
    if (!site) return sites;
    if (typeof fields.url === "string" && fields.url) site.url = fields.url;
    if ("interval" in fields) {
      site.interval = Number.isFinite(fields.interval) && fields.interval > 0 ? fields.interval : null;
    }
    return sites;
  });
}

async function pingProtectedSites(domains) {
  const sites = await getProtectedSites();
  let targets = filterPingTargets(sites);
  if (domains) targets = targets.filter(s => domains.includes(s.domain));
  if (targets.length === 0) return;

  for (const site of targets) {
    const previousStatus = site.lastStatus;
    try {
      const res = await fetch(site.url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow"
      });
      site.lastStatus = classifyPing(site.domain, res.ok, res.status, res.url);
    } catch {
      site.lastStatus = "error";
    }
    site.lastPing = Date.now();
    if (previousStatus === "ok" && site.lastStatus !== "ok") notifySessionLost(site);
  }

  await saveProtectedSites(sites);
}

async function groupTabsByDomain() {
  if (!browser.tabs.group) return;

  const settings = await getSettings();
  const tabs = await browser.tabs.query({ currentWindow: true });
  const activeTab = tabs.find(t => t.active);
  const win = await browser.windows.getCurrent();
  const groups = await browser.tabGroups.query({ windowId: win.id });
  const domainTabs = groupByDomain(tabs, settings.groupByBaseDomain);

  for (const [domain, tabList] of domainTabs) {
    if (tabList.length < 2) continue;
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

  await ungroupSingleTabDomainGroups(win.id, domainTabs);

  if (activeTab) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
}

async function ungroupSingleTabDomainGroups(windowId, domainTabs) {
  if (!browser.tabs.ungroup) return;
  const tabs = await browser.tabs.query({ windowId });
  const groups = await browser.tabGroups.query({ windowId });
  const loneTabIds = findSingleTabDomainGroups(tabs, groups, [...domainTabs.keys()]);
  if (loneTabIds.length > 0) await browser.tabs.ungroup(loneTabIds);
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
  let groups = [];
  if (browser.tabGroups) {
    const win = await browser.windows.getCurrent();
    groups = await browser.tabGroups.query({ windowId: win.id });
  }
  const { groupOrder, groupedTabs, ungrouped } = planGroupedSort(tabs, groups);

  for (const groupId of groupOrder) {
    const sorted = groupedTabs.get(groupId);
    const base = Math.min(...tabs.filter(t => t.groupId === groupId).map(t => t.index));
    for (let i = 0; i < sorted.length; i++) {
      await browser.tabs.move(sorted[i].id, { index: base + i });
    }
  }

  for (const tab of ungrouped) {
    await browser.tabs.move(tab.id, { index: -1 });
  }

  if (browser.tabGroups?.move) {
    let index = tabs.filter(t => t.pinned).length;
    for (const groupId of groupOrder) {
      await browser.tabGroups.move(groupId, { index });
      index += groupedTabs.get(groupId).length;
    }
  }

  if (activeTab) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
}

let lastClosedCount = 0;

async function closeDuplicateTabs() {
  const settings = await getSettings();
  const tabs = await browser.tabs.query({ currentWindow: true });
  const toClose = findDuplicates(tabs, settings.dedupeIgnoreQuery);

  if (toClose.length > 0) {
    await browser.tabs.remove(toClose);
    lastClosedCount = toClose.length;
  }
  return toClose.length;
}

async function undoLastClose() {
  if (!browser.sessions || lastClosedCount === 0) return 0;
  const restored = lastClosedCount;
  for (let i = 0; i < restored; i++) {
    try {
      await browser.sessions.restore();
    } catch {
      break;
    }
  }
  lastClosedCount = 0;
  return restored;
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
    const closed = await closeDuplicateTabs();
    return { ok: true, closed };
  }
  if (msg.type === "undoClose") {
    const restored = await undoLastClose();
    return { ok: true, restored };
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
  if (msg.type === "importSites") {
    return await importProtectedSites(msg.sites);
  }
  if (msg.type === "updateSite") {
    return await updateSite(msg.domain, msg.fields);
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
