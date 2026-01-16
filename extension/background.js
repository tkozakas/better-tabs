const GITHUB_CLIENT_ID = "Ov23liY8IFluEgbiTfhC";
const WS_URL = "ws://localhost:19222/ws";
const SYNC_INTERVAL = 300000;
const RECONNECT_DELAY = 3000;

let ws = null;
let reconnectTimer = null;
let syncTimer = null;
let daemonConnected = false;

async function init() {
  tryConnectDaemon();
}

function tryConnectDaemon() {
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    daemonConnected = true;
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    console.log("Tab Grouper: daemon connected");
    sendTabsUpdate();
  };
  
  ws.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "prs") await handlePRs(data.groups);
    else if (data.type === "close") await closeTabs(data.toClose);
    else if (data.type === "group") await groupTabsByDomain();
  };
  
  ws.onclose = () => {
    daemonConnected = false;
    scheduleReconnect();
    fallbackToStandalone();
  };
  
  ws.onerror = () => ws.close();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    tryConnectDaemon();
  }, RECONNECT_DELAY);
}

async function fallbackToStandalone() {
  const { token } = await browser.storage.local.get("token");
  if (token && !syncTimer) {
    startStandaloneSync();
  }
}

function startStandaloneSync() {
  if (syncTimer) clearInterval(syncTimer);
  fetchAndSyncPRs();
  syncTimer = setInterval(fetchAndSyncPRs, SYNC_INTERVAL);
  console.log("Tab Grouper: standalone mode");
}

async function fetchAndSyncPRs() {
  if (daemonConnected) return;
  
  const { token } = await browser.storage.local.get("token");
  if (!token) return;

  const myPRs = await fetchMyPRs(token);
  const tabs = await browser.tabs.query({});
  
  await handlePRs([{ urls: myPRs, groupName: "My PRs" }]);
  await autoCloseMergedPRs(tabs, myPRs);
  
  console.log(`Tab Grouper: ${myPRs.length} PRs`);
}

async function fetchMyPRs(token) {
  const query = `{ viewer { pullRequests(first: 100, states: OPEN) { nodes { url repository { isArchived } } } } }`;
  const data = await graphql(token, query);
  return (data?.viewer?.pullRequests?.nodes || [])
    .filter(pr => pr.url && !pr.repository?.isArchived)
    .map(pr => pr.url);
}

async function graphql(token, query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    if (res.status === 401) {
      await browser.storage.local.remove("token");
      console.log("Tab Grouper: token expired, please re-login");
    }
    return null;
  }
  return (await res.json()).data;
}

async function handlePRs(groups) {
  if (!groups) return;
  const tabs = await browser.tabs.query({});
  for (const group of groups) {
    if (group.urls?.length > 0) await organizeGroup(tabs, group.urls, group.groupName);
  }
  sendTabsUpdate();
}

async function organizeGroup(existingTabs, urls, groupName) {
  const win = await browser.windows.getCurrent();
  const urlToTab = new Map(existingTabs.filter(t => t.url).map(t => [normalizeUrl(t.url), t]));
  const tabsToGroup = [];

  for (const url of urls) {
    const tab = urlToTab.get(normalizeUrl(url));
    if (tab) {
      tabsToGroup.push(tab.id);
    } else {
      const newTab = await browser.tabs.create({ url, active: false, windowId: win.id });
      tabsToGroup.push(newTab.id);
    }
  }

  if (tabsToGroup.length === 0 || !browser.tabs.group) return;

  try {
    const groups = await browser.tabGroups.query({ windowId: win.id });
    const existing = groups.find(g => g.title === groupName);
    if (existing) {
      await browser.tabs.group({ tabIds: tabsToGroup, groupId: existing.id });
    } else {
      const groupId = await browser.tabs.group({ tabIds: tabsToGroup, createProperties: { windowId: win.id } });
      await browser.tabGroups.update(groupId, { title: groupName });
    }
  } catch (e) {
    console.error("Tab Grouper: group error", e);
  }
}

async function autoCloseMergedPRs(tabs, activePRs) {
  const activeSet = new Set(activePRs.map(normalizeUrl));
  const toClose = tabs.filter(t => 
    t.url?.includes("github.com") && 
    t.url?.includes("/pull/") && 
    !activeSet.has(normalizeUrl(t.url))
  );
  if (toClose.length > 0) {
    await browser.tabs.remove(toClose.map(t => t.id));
  }
}

async function closeTabs(urls) {
  if (!urls?.length) return;
  const tabs = await browser.tabs.query({});
  const normalized = new Set(urls.map(normalizeUrl));
  const toClose = tabs.filter(t => normalized.has(normalizeUrl(t.url)));
  if (toClose.length > 0) await browser.tabs.remove(toClose.map(t => t.id));
}

async function groupTabsByDomain() {
  if (!browser.tabs.group) {
    console.log("Tab Grouper: tabs.group API not available");
    return;
  }

  const tabs = await browser.tabs.query({ currentWindow: true });
  const win = await browser.windows.getCurrent();
  const groups = await browser.tabGroups.query({ windowId: win.id });
  const domainTabs = new Map();

  for (const tab of tabs) {
    if (!tab.url || tab.pinned) continue;
    try {
      const domain = new URL(tab.url).hostname;
      if (!domainTabs.has(domain)) domainTabs.set(domain, []);
      domainTabs.get(domain).push(tab);
    } catch {}
  }

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
      console.error("Tab Grouper: domain group error", domain, e);
    }
  }
  console.log("Tab Grouper: grouped", domainTabs.size, "domains");
}

function sendTabsUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  browser.tabs.query({}).then(tabs => {
    ws.send(JSON.stringify({ type: "tabs", openUrls: tabs.map(t => t.url).filter(Boolean) }));
  });
}

function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/\/$/, "").replace(/\/(files|commits)$/, "");
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "login") return startDeviceFlow();
  if (msg.type === "logout") {
    await browser.storage.local.remove("token");
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    return { ok: true };
  }
  if (msg.type === "getStatus") {
    const { token } = await browser.storage.local.get("token");
    return { loggedIn: !!token, daemonConnected };
  }
  if (msg.type === "refresh") {
    if (daemonConnected) return { ok: true };
    await fetchAndSyncPRs();
    return { ok: true };
  }
  if (msg.type === "groupByDomain") {
    await groupTabsByDomain();
    return { ok: true };
  }
});

async function startDeviceFlow() {
  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${GITHUB_CLIENT_ID}&scope=repo read:org`
  });
  const { device_code, user_code, verification_uri, interval } = await codeRes.json();
  
  browser.tabs.create({ url: verification_uri });
  
  const pollForToken = async () => {
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, (interval || 5) * 1000));
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${GITHUB_CLIENT_ID}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
      });
      const data = await tokenRes.json();
      if (data.access_token) {
        await browser.storage.local.set({ token: data.access_token });
        if (!daemonConnected) startStandaloneSync();
        return { ok: true };
      }
      if (data.error === "expired_token") return { error: "expired" };
      if (data.error !== "authorization_pending" && data.error !== "slow_down") {
        return { error: data.error };
      }
    }
    return { error: "timeout" };
  };
  
  return { user_code, verification_uri, pollPromise: pollForToken() };
}

browser.tabs.onCreated.addListener(sendTabsUpdate);
browser.tabs.onRemoved.addListener(sendTabsUpdate);
browser.tabs.onUpdated.addListener((_, c) => { if (c.url) sendTabsUpdate(); });

init();
