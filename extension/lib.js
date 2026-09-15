const TWO_LEVEL_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "or.jp", "ne.jp",
  "com.br", "com.mx", "co.in", "co.za",
  "com.sg", "com.tr", "com.cn", "com.hk"
]);

function normalizeUrl(url, ignoreQuery = false) {
  if (!url) return "";
  let normalized = url;
  if (ignoreQuery) {
    const cut = normalized.search(/[?#]/);
    if (cut !== -1) normalized = normalized.slice(0, cut);
  }
  return normalized.replace(/\/$/, "");
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function baseDomain(hostname) {
  if (!hostname || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return hostname;
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  const take = TWO_LEVEL_TLDS.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-take).join(".");
}

function groupByDomain(tabs, useBaseDomain = false) {
  const domainTabs = new Map();

  for (const tab of tabs) {
    if (!tab.url || tab.pinned) continue;
    try {
      const host = new URL(tab.url).hostname;
      const domain = useBaseDomain ? baseDomain(host) : host;
      if (!domainTabs.has(domain)) domainTabs.set(domain, []);
      domainTabs.get(domain).push(tab);
    } catch {}
  }

  return domainTabs;
}

function findDuplicates(tabs, ignoreQuery = false) {
  const seen = new Set();
  const toClose = [];

  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.audible) {
      seen.add(normalizeUrl(tab.url, ignoreQuery));
    }
  }

  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.audible) continue;
    const normalized = normalizeUrl(tab.url, ignoreQuery);
    if (seen.has(normalized)) {
      toClose.push(tab.id);
    } else {
      seen.add(normalized);
    }
  }

  return toClose;
}

function hostSortKey(url) {
  return new URL(url).hostname.split(".").reverse().join(".");
}

function sortTabs(tabs) {
  const sortable = tabs.filter(t => !t.pinned && t.url);

  sortable.sort((a, b) =>
    hostSortKey(a.url).localeCompare(hostSortKey(b.url)) ||
    (a.title || "").localeCompare(b.title || "") ||
    a.url.localeCompare(b.url)
  );

  return sortable;
}

function planGroupedSort(tabs, groups) {
  const groupedTabs = new Map();
  const ungrouped = [];

  for (const tab of tabs) {
    if (tab.pinned || !tab.url) continue;
    if (tab.groupId != null && tab.groupId !== -1) {
      if (!groupedTabs.has(tab.groupId)) groupedTabs.set(tab.groupId, []);
      groupedTabs.get(tab.groupId).push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  const titles = new Map(groups.map(g => [g.id, g.title || ""]));
  const groupOrder = [...groupedTabs.keys()].sort((a, b) =>
    (titles.get(a) || "").localeCompare(titles.get(b) || "")
  );

  for (const id of groupOrder) groupedTabs.set(id, sortTabs(groupedTabs.get(id)));
  return { groupOrder, groupedTabs, ungrouped: sortTabs(ungrouped) };
}

function planSortedOrder(tabs, groups) {
  const { groupOrder, groupedTabs, ungrouped } = planGroupedSort(tabs, groups);
  const ordered = [];
  for (const id of groupOrder) ordered.push(...groupedTabs.get(id));
  ordered.push(...ungrouped);
  return ordered;
}

function filterPingTargets(sites) {
  return sites.filter(site => site.enabled);
}

function classifyPing(domain, ok, status, finalUrl) {
  if (!ok) return status ? String(status) : "error";
  try {
    const final = new URL(finalUrl);
    if (baseDomain(final.hostname) !== baseDomain(domain)) return "redirected";
    if (/(^|\/)(log-?in|sign-?in|sso|auth)(\/|$)/i.test(final.pathname)) return "redirected";
  } catch {}
  return "ok";
}

function effectiveInterval(site, settings) {
  return site.interval || settings.interval;
}

function buildSiteEntry(domain, url) {
  return {
    domain,
    url: url || `https://${domain}/`,
    enabled: true,
    interval: null,
    lastPing: null,
    lastStatus: null
  };
}

function sanitizeSiteEntry(raw) {
  if (!raw || typeof raw.domain !== "string" || !raw.domain) return null;
  const entry = buildSiteEntry(raw.domain, typeof raw.url === "string" && raw.url ? raw.url : null);
  entry.enabled = raw.enabled !== false;
  if (Number.isFinite(raw.interval) && raw.interval > 0) entry.interval = raw.interval;
  return entry;
}

function mergeSites(existing, imported) {
  const known = new Set(existing.map(s => s.domain));
  const merged = [...existing];
  for (const raw of imported) {
    const entry = sanitizeSiteEntry(raw);
    if (!entry || known.has(entry.domain)) continue;
    known.add(entry.domain);
    merged.push(entry);
  }
  return merged;
}

function mergeSettings(saved, defaults) {
  return { ...defaults, ...saved };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeUrl,
    extractDomain,
    baseDomain,
    groupByDomain,
    findDuplicates,
    sortTabs,
    planGroupedSort,
    planSortedOrder,
    filterPingTargets,
    classifyPing,
    effectiveInterval,
    buildSiteEntry,
    sanitizeSiteEntry,
    mergeSites,
    mergeSettings
  };
}
