function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/\/$/, "");
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function groupByDomain(tabs) {
  const domainTabs = new Map();

  for (const tab of tabs) {
    if (!tab.url || tab.pinned) continue;
    try {
      const domain = new URL(tab.url).hostname;
      if (!domainTabs.has(domain)) domainTabs.set(domain, []);
      domainTabs.get(domain).push(tab);
    } catch {}
  }

  return domainTabs;
}

function findDuplicates(tabs) {
  const seen = new Set();
  const toClose = [];

  const activeTab = tabs.find(t => t.active);
  if (activeTab) {
    seen.add(normalizeUrl(activeTab.url));
  }

  for (const tab of tabs) {
    if (tab.active) continue;
    const normalized = normalizeUrl(tab.url);
    if (seen.has(normalized)) {
      toClose.push(tab.id);
    } else {
      seen.add(normalized);
    }
  }

  return toClose;
}

function sortTabs(tabs) {
  const sortable = tabs.filter(t => !t.pinned && t.url);

  sortable.sort((a, b) => {
    const hostA = new URL(a.url).hostname;
    const hostB = new URL(b.url).hostname;
    return hostA.localeCompare(hostB) || a.url.localeCompare(b.url);
  });

  return sortable;
}

function filterPingTargets(sites, settings, openDomains) {
  return sites.filter(site => {
    if (!site.enabled) return false;
    if (settings.onlyWithOpenTab && !openDomains.has(site.domain)) return false;
    return true;
  });
}

function buildSiteEntry(domain, url) {
  return {
    domain,
    url: url || `https://${domain}/`,
    enabled: true,
    lastPing: null,
    lastStatus: null
  };
}

function mergeSettings(saved, defaults) {
  return { ...defaults, ...saved };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeUrl,
    extractDomain,
    groupByDomain,
    findDuplicates,
    sortTabs,
    filterPingTargets,
    buildSiteEntry,
    mergeSettings
  };
}
