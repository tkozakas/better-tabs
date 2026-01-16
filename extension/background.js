const GROUP_COLORS = ["blue", "cyan", "green", "yellow", "orange", "red", "pink", "purple"];
const POLL_URL = "http://localhost:19222/prs";
const POLL_INTERVAL_MS = 1000;

const api = typeof browser !== "undefined" ? browser : chrome;

async function pollForPRs() {
  try {
    const existingTabs = await api.tabs.query({});
    const openUrls = existingTabs.map(t => t.url).filter(Boolean);

    const response = await fetch(POLL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openUrls })
    });
    if (!response.ok) return;

    const data = await response.json();

    if (data.toClose && data.toClose.length > 0) {
      await closeUrls(existingTabs, data.toClose);
    }

    if (data.groups) {
      for (const group of data.groups) {
        if (group.urls && group.urls.length > 0) {
          await openUrlsInGroup(group.urls, group.groupName);
        }
      }
    }
  } catch (e) {}
}

async function closeUrls(tabs, urlsToClose) {
  const normalized = new Set(urlsToClose.map(normalizeUrl));
  const tabsToClose = tabs.filter(t => normalized.has(normalizeUrl(t.url)));
  if (tabsToClose.length > 0) {
    await api.tabs.remove(tabsToClose.map(t => t.id));
  }
}

async function openUrlsInGroup(urls, groupName) {
  const currentWindow = await api.windows.getCurrent();
  const existingGroups = await api.tabGroups.query({ windowId: currentWindow.id });
  const targetGroup = existingGroups.find(g => g.title === groupName);

  const newTabs = [];
  for (const url of urls) {
    const tab = await api.tabs.create({
      url,
      active: false,
      windowId: currentWindow.id
    });
    newTabs.push(tab);
  }

  if (newTabs.length === 0) return newTabs;

  const tabIds = newTabs.map(t => t.id);

  if (targetGroup) {
    await api.tabs.group({ tabIds, groupId: targetGroup.id });
  } else {
    const groupId = await api.tabs.group({ tabIds, createProperties: { windowId: currentWindow.id } });
    const colorIndex = existingGroups.length % GROUP_COLORS.length;
    await api.tabGroups.update(groupId, {
      title: groupName,
      color: GROUP_COLORS[colorIndex]
    });
  }

  return newTabs;
}

function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/\/$/, "").replace(/\/(files|commits)$/, "");
}

setInterval(pollForPRs, POLL_INTERVAL_MS);
pollForPRs();
