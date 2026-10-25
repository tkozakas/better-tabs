const LIVE_DEBOUNCE_MS = 1000;

let lastClosed = null;
let liveTimer = null;
let liveRunning = false;
let liveRerun = false;

async function currentWindowTabs() {
  const win = await browser.windows.getCurrent();
  return { windowId: win.id, tabs: await browser.tabs.query({ windowId: win.id }) };
}

async function groupTabsByDomain() {
  if (!browser.tabs.group) return 0;

  const settings = await readSettings();
  const { windowId, tabs } = await currentWindowTabs();
  const activeTab = tabs.find(t => t.active);
  const groups = await browser.tabGroups.query({ windowId });
  const domainTabs = groupByDomain(tabs, settings.groupByBaseDomain);
  let grouped = 0;

  for (const [domain, tabList] of domainTabs) {
    if (tabList.length < 2) continue;
    const existing = groups.find(g => g.title === domain);
    const tabIds = tabList.map(t => t.id);
    try {
      if (existing) {
        await browser.tabs.group({ tabIds, groupId: existing.id });
      } else {
        const groupId = await browser.tabs.group({ tabIds, createProperties: { windowId } });
        await browser.tabGroups.update(groupId, { title: domain });
      }
      grouped += tabIds.length;
    } catch (e) {
      console.error("Better Tabs: domain group error", domain, e);
    }
  }

  await ungroupSingleTabDomainGroups(windowId, domainTabs);

  if (activeTab) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
  return grouped;
}

async function ungroupSingleTabDomainGroups(windowId, domainTabs) {
  if (!browser.tabs.ungroup) return;
  const tabs = await browser.tabs.query({ windowId });
  const groups = await browser.tabGroups.query({ windowId });
  const loneTabIds = findSingleTabDomainGroups(tabs, groups, [...domainTabs.keys()]);
  if (loneTabIds.length > 0) await browser.tabs.ungroup(loneTabIds);
}

async function ungroupAllTabs() {
  if (!browser.tabGroups || !browser.tabs.ungroup) return 0;

  const win = await browser.windows.getCurrent();
  const groups = await browser.tabGroups.query({ windowId: win.id });
  let ungrouped = 0;

  for (const group of groups) {
    try {
      const tabs = await browser.tabs.query({ groupId: group.id });
      if (tabs.length > 0) {
        await browser.tabs.ungroup(tabs.map(t => t.id));
        ungrouped += tabs.length;
      }
    } catch (e) {
      console.error("Better Tabs: error removing group", group.id, e);
    }
  }
  return ungrouped;
}

function sameSequence(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function idsInTabOrder(tabs, ids) {
  const wanted = new Set(ids);
  return tabs.filter(t => wanted.has(t.id)).sort((a, b) => a.index - b.index).map(t => t.id);
}

async function sortTabsAlphabetically({ keepActiveInPlace = false } = {}) {
  const { windowId, tabs } = await currentWindowTabs();
  const activeTab = tabs.find(t => t.active);
  const skipId = keepActiveInPlace ? activeTab?.id : undefined;
  const groups = browser.tabGroups ? await browser.tabGroups.query({ windowId }) : [];
  const { groupOrder, groupedTabs, ungrouped } = planGroupedSort(tabs, groups);
  let moved = 0;

  for (const groupId of groupOrder) {
    const ids = groupedTabs.get(groupId).map(t => t.id).filter(id => id !== skipId);
    if (ids.length === 0) continue;
    const fresh = await browser.tabs.query({ windowId });
    if (sameSequence(idsInTabOrder(fresh, ids), ids)) continue;
    const base = Math.min(...fresh.filter(t => t.groupId === groupId).map(t => t.index));
    await browser.tabs.move(ids, { index: base });
    moved += ids.length;
  }

  const ungroupedIds = ungrouped.map(t => t.id).filter(id => id !== skipId);
  if (ungroupedIds.length > 0) {
    const fresh = await browser.tabs.query({ windowId });
    if (!sameSequence(idsInTabOrder(fresh, ungroupedIds), ungroupedIds)) {
      await browser.tabs.move(ungroupedIds, { index: -1 });
      moved += ungroupedIds.length;
    }
  }

  if (browser.tabGroups?.move) {
    let index = tabs.filter(t => t.pinned).length;
    for (const groupId of groupOrder) {
      const fresh = await browser.tabs.query({ windowId });
      const start = Math.min(...fresh.filter(t => t.groupId === groupId).map(t => t.index));
      if (start !== index) await browser.tabGroups.move(groupId, { index });
      index += groupedTabs.get(groupId).length;
    }
  }

  if (activeTab && !keepActiveInPlace) {
    await browser.tabs.update(activeTab.id, { active: true });
  }
  return moved;
}

async function closeDuplicateTabs() {
  const settings = await readSettings();
  const { tabs } = await currentWindowTabs();
  const toClose = new Set(findDuplicates(tabs, settings.dedupeIgnoreQuery));
  if (toClose.size === 0) return 0;

  const closing = tabs.filter(t => toClose.has(t.id));
  await browser.tabs.remove(closing.map(t => t.id));
  lastClosed = {
    at: Date.now(),
    tabs: closing.map(t => ({ url: t.url, index: t.index, windowId: t.windowId, pinned: false }))
  };
  return closing.length;
}

async function undoLastClose() {
  if (!lastClosed) return 0;
  const { tabs } = lastClosed;
  lastClosed = null;
  let restored = 0;
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    try {
      await browser.tabs.create({
        url: tab.url,
        index: tab.index,
        windowId: tab.windowId,
        pinned: tab.pinned,
        active: false
      });
      restored++;
    } catch (e) {
      console.error("Better Tabs: restore error", tab.url, e);
    }
  }
  return restored;
}

function getLastClosed() {
  return { count: lastClosed ? lastClosed.tabs.length : 0, at: lastClosed ? lastClosed.at : null };
}

function scheduleLiveCleanup() {
  if (liveRunning) {
    liveRerun = true;
    return;
  }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runLiveCleanup, LIVE_DEBOUNCE_MS);
}

async function runLivePass(settings) {
  await closeDuplicateTabs();
  if (settings.liveAutoGroup) await groupTabsByDomain();
  if (settings.liveSort) await sortTabsAlphabetically({ keepActiveInPlace: true });
}

async function runLiveCleanup() {
  liveTimer = null;
  if (liveRunning) {
    liveRerun = true;
    return;
  }
  liveRunning = true;
  try {
    do {
      liveRerun = false;
      const settings = await readSettings();
      if (!settings.liveMode) return;
      await runLivePass(settings);
    } while (liveRerun);
  } catch (e) {
    console.error("Better Tabs: live cleanup error", e);
  } finally {
    liveRunning = false;
  }
}

function onTabUpdated(tabId, changeInfo) {
  if (changeInfo.url) scheduleLiveCleanup();
}
