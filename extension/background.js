const GROUP_COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
const POLL_URL = "http://localhost:19222/prs";
const POLL_INTERVAL = 1000;

async function pollForPRs() {
  try {
    const response = await fetch(POLL_URL);
    if (!response.ok) return;
    
    const data = await response.json();
    if (!data.urls || data.urls.length === 0) return;
    
    await openUrlsInGroup(data.urls, data.groupName || "PRs");
    
    await fetch(POLL_URL, { method: "DELETE" });
  } catch (e) {
  }
}

async function openUrlsInGroup(urls, groupName) {
  const currentWindow = await browser.windows.getCurrent();
  const existingTabs = await browser.tabs.query({});
  const existingUrls = new Set(existingTabs.map(t => normalizeUrl(t.url)));
  
  const urlsToOpen = urls.filter(url => !existingUrls.has(normalizeUrl(url)));
  
  if (urlsToOpen.length === 0) {
    return [];
  }

  const existingGroups = await browser.tabGroups.query({ windowId: currentWindow.id });
  let targetGroup = existingGroups.find(g => g.title === groupName);
  
  const newTabs = [];
  for (const url of urlsToOpen) {
    const tab = await browser.tabs.create({ 
      url, 
      active: false,
      windowId: currentWindow.id
    });
    newTabs.push(tab);
  }

  if (newTabs.length > 0) {
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
  }

  return newTabs;
}

function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/\/$/, "").replace(/\/(files|commits)$/, "");
}

setInterval(pollForPRs, POLL_INTERVAL);
pollForPRs();
