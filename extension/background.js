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

// GitHub API
async function graphql(token, query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    if (res.status === 401) {
      await browser.storage.local.remove("token");
      console.log("Tab Grouper: token expired");
    }
    return null;
  }
  return (await res.json()).data;
}

async function fetchMyPRs(token) {
  const query = `{ viewer { pullRequests(first: 100, states: OPEN) { nodes { url repository { isArchived } } } } }`;
  const data = await graphql(token, query);
  return (data?.viewer?.pullRequests?.nodes || [])
    .filter(pr => pr.url && !pr.repository?.isArchived)
    .map(pr => pr.url);
}

async function fetchReviewPRs(token) {
  const query = `{ search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 100) { nodes { ... on PullRequest { url repository { isArchived } } } } }`;
  const data = await graphql(token, query);
  return (data?.search?.nodes || [])
    .filter(pr => pr.url && !pr.repository?.isArchived)
    .map(pr => pr.url);
}

async function fetchMyIssues(token) {
  const query = `{ search(query: "is:issue is:open assignee:@me", type: ISSUE, first: 100) { nodes { ... on Issue { url repository { isArchived } } } } }`;
  const data = await graphql(token, query);
  return (data?.search?.nodes || [])
    .filter(issue => issue.url && !issue.repository?.isArchived)
    .map(issue => issue.url);
}

async function openUrls(urls, groupName) {
  if (!urls?.length) return;
  
  const win = await browser.windows.getCurrent();
  const existingTabs = await browser.tabs.query({});
  const existingUrls = new Set(existingTabs.map(t => normalizeUrl(t.url)));
  const tabIds = [];

  for (const url of urls) {
    if (!existingUrls.has(normalizeUrl(url))) {
      const tab = await browser.tabs.create({ url, active: false, windowId: win.id });
      tabIds.push(tab.id);
    } else {
      const existing = existingTabs.find(t => normalizeUrl(t.url) === normalizeUrl(url));
      if (existing) tabIds.push(existing.id);
    }
  }

  if (tabIds.length > 0 && browser.tabs.group && groupName) {
    try {
      const groups = await browser.tabGroups.query({ windowId: win.id });
      const existing = groups.find(g => g.title === groupName);
      if (existing) {
        await browser.tabs.group({ tabIds, groupId: existing.id });
      } else {
        const groupId = await browser.tabs.group({ tabIds, createProperties: { windowId: win.id } });
        await browser.tabGroups.update(groupId, { title: groupName });
      }
    } catch (e) {
      console.error("Tab Grouper: group error", e);
    }
  }
}

// PR handling for daemon
async function handlePRs(groups) {
  if (!groups) return;
  const tabs = await browser.tabs.query({});
  for (const group of groups) {
    if (group.urls?.length > 0) {
      await openUrls(group.urls, group.groupName);
    }
  }
  sendTabsUpdate();
}

async function closeTabs(urls) {
  if (!urls?.length) return;
  const tabs = await browser.tabs.query({});
  const normalized = new Set(urls.map(normalizeUrl));
  const toClose = tabs.filter(t => normalized.has(normalizeUrl(t.url)));
  if (toClose.length > 0) await browser.tabs.remove(toClose.map(t => t.id));
}

// Tab Actions (no GitHub needed)
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

async function ungroupAllTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const groupedTabs = tabs.filter(t => t.groupId && t.groupId !== -1 && t.groupId !== browser.tabs.TAB_ID_NONE);
  
  if (groupedTabs.length === 0) {
    console.log("Tab Grouper: no grouped tabs found");
    return;
  }

  if (browser.tabs.ungroup) {
    try {
      await browser.tabs.ungroup(groupedTabs.map(t => t.id));
      console.log("Tab Grouper: ungrouped", groupedTabs.length, "tabs");
    } catch (e) {
      console.error("Tab Grouper: ungroup error", e);
    }
  } else {
    // Fallback: move tabs outside their groups
    for (const tab of groupedTabs) {
      try {
        await browser.tabs.move(tab.id, { index: -1 });
      } catch (e) {}
    }
    console.log("Tab Grouper: moved", groupedTabs.length, "tabs out of groups");
  }
}

async function sortTabsAlphabetically() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const sortable = tabs.filter(t => !t.pinned && t.url);
  
  sortable.sort((a, b) => {
    const hostA = new URL(a.url).hostname;
    const hostB = new URL(b.url).hostname;
    return hostA.localeCompare(hostB) || a.url.localeCompare(b.url);
  });

  for (let i = 0; i < sortable.length; i++) {
    await browser.tabs.move(sortable[i].id, { index: -1 });
  }
  console.log("Tab Grouper: sorted", sortable.length, "tabs");
}

async function closeDuplicateTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const seen = new Set();
  const toClose = [];

  for (const tab of tabs) {
    const normalized = normalizeUrl(tab.url);
    if (seen.has(normalized)) {
      toClose.push(tab.id);
    } else {
      seen.add(normalized);
    }
  }

  if (toClose.length > 0) {
    await browser.tabs.remove(toClose);
  }
  console.log("Tab Grouper: closed", toClose.length, "duplicates");
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

// Message handler
browser.runtime.onMessage.addListener(async (msg) => {
  // GitHub auth
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
  
  // Tab actions (no GitHub needed)
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
  
  // GitHub actions (need token)
  const { token } = await browser.storage.local.get("token");
  if (!token) return { error: "Not logged in" };
  
  if (msg.type === "openMyPRs") {
    const prs = await fetchMyPRs(token);
    await openUrls(prs, "My PRs");
    return { ok: true, count: prs.length };
  }
  if (msg.type === "openReviewPRs") {
    const prs = await fetchReviewPRs(token);
    await openUrls(prs, "Review PRs");
    return { ok: true, count: prs.length };
  }
  if (msg.type === "openMyIssues") {
    const issues = await fetchMyIssues(token);
    await openUrls(issues, "My Issues");
    return { ok: true, count: issues.length };
  }
  if (msg.type === "openNotifications") {
    await browser.tabs.create({ url: "https://github.com/notifications" });
    return { ok: true };
  }
});

async function startDeviceFlow() {
  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${GITHUB_CLIENT_ID}&scope=repo read:org`
  });
  const { device_code, user_code, verification_uri, interval, error } = await codeRes.json();
  
  if (error) {
    return { error };
  }
  
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
