const messageHandlers = {
  getSites: () => describeSites(),
  getSettings: () => getSettings(),
  updateSettings: msg => updateSettings(msg.patch),
  addSite: msg => addSite(msg.domain, msg.url),
  removeSite: msg => removeSite(msg.domain),
  toggleSite: msg => toggleSite(msg.domain, msg.enabled),
  updateSite: msg => updateSite(msg.domain, msg.fields || {}),
  importSites: msg => importSites(msg.sites),
  pingNow: async () => {
    await pingSites();
    return describeSites();
  },
  getCurrentTab: getCurrentTabInfo,
  groupByDomain: async () => ({ ok: true, count: await groupTabsByDomain() }),
  ungroupAll: async () => ({ ok: true, count: await ungroupAllTabs() }),
  sortTabs: async () => ({ ok: true, count: await sortTabsAlphabetically() }),
  closeDuplicates: async () => ({ ok: true, closed: await closeDuplicateTabs() }),
  undoClose: async () => ({ ok: true, restored: await undoLastClose() }),
  getLastClosed: async () => getLastClosed()
};

async function getCurrentTabInfo() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) return { domain: null, url: null, protected: false };
  const domain = extractDomain(tab.url);
  const sites = await readSites();
  return { domain, url: tab.url, protected: sites.some(s => s.domain === domain) };
}

async function onMessage(msg) {
  const handler = messageHandlers[msg?.type];
  if (handler) return handler(msg);
}

async function onCommand(command) {
  if (command === "group-tabs") await groupTabsByDomain();
  if (command === "sort-tabs") await sortTabsAlphabetically();
  if (command === "close-duplicates") await closeDuplicateTabs();
}

async function init() {
  await migrateStorage();
  await scheduleKeepalive();
  await updateBadge();
  browser.alarms.onAlarm.addListener(onAlarm);
  browser.tabs.onCreated.addListener(scheduleLiveCleanup);
  browser.tabs.onUpdated.addListener(onTabUpdated);
  if (browser.commands) {
    browser.commands.onCommand.addListener(onCommand);
  }
}

browser.runtime.onMessage.addListener(onMessage);

const backgroundReady = init();
