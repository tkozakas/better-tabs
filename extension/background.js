const GROUP_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
const POLL_URL = "http://localhost:19222/prs";
const POLL_INTERVAL_MS = 1000;
const CONTENT_TYPE_JSON = "application/json";

async function pollForPRs() {
  try {
    const existingTabs = await browser.tabs.query({});
    const openUrls = existingTabs.map(t => t.url).filter(Boolean);

    const response = await fetch(POLL_URL, {
      method: "POST",
      headers: { "Content-Type": CONTENT_TYPE_JSON },
      body: JSON.stringify({ openUrls })
    });
    if (!response.ok) return;

    const data = await response.json();

    if (data.groups) {
      for (const group of data.groups) {
        if (group.urls && group.urls.length > 0) {
          await openUrlsInGroup(group.urls, group.groupName);
        }
      }
      return;
    }

    if (data.urls && data.urls.length > 0) {
      await openUrlsInGroup(data.urls, data.groupName || "PRs");
    }
  } catch (e) {}
}

async function openUrlsInGroup(urls, groupName) {
  const currentWindow = await browser.windows.getCurrent();
  const existingGroups = await browser.tabGroups.query({ windowId: currentWindow.id });
  const targetGroup = existingGroups.find(g => g.title === groupName);

  const newTabs = [];
  for (const url of urls) {
    const tab = await browser.tabs.create({
      url,
      active: false,
      windowId: currentWindow.id
    });
    newTabs.push(tab);
  }

  if (newTabs.length === 0) return newTabs;

  const tabIds = newTabs.map(t => t.id);

  if (targetGroup) {
    await browser.tabs.group({ tabIds, groupId: targetGroup.id });
  } else {
    const groupId = await browser.tabs.group({ tabIds });
    const colorIndex = existingGroups.length % GROUP_COLORS.length;
    await browser.tabGroups.update(groupId, {
      title: groupName,
      color: GROUP_COLORS[colorIndex]
    });
  }

  return newTabs;
}

setInterval(pollForPRs, POLL_INTERVAL_MS);
pollForPRs();
