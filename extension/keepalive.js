const ALARM_PREFIX = "keepalive:";

async function onAlarm(alarm) {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    await pingSites([alarm.name.slice(ALARM_PREFIX.length)]);
  }
}

async function scheduleKeepalive() {
  const alarms = await browser.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith(ALARM_PREFIX)) await browser.alarms.clear(alarm.name);
  }
  const settings = await readSettings();
  const sites = await readSites();
  for (const site of sites.filter(s => s.enabled)) {
    browser.alarms.create(ALARM_PREFIX + site.domain, {
      periodInMinutes: effectiveInterval(site, settings)
    });
  }
}

async function updateBadge() {
  const [sites, statuses] = await Promise.all([readSites(), readSiteStatus()]);
  const failing = hasFailingSite(sites, statuses);
  await browser.browserAction.setBadgeText({ text: failing ? "!" : "" });
  if (failing) await browser.browserAction.setBadgeBackgroundColor({ color: "#f85149" });
}

function notifySessionLost(domain, status) {
  if (!browser.notifications) return;
  browser.notifications.create(`session-lost:${domain}`, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icon.png"),
    title: "Better Tabs — session at risk",
    message: `Ping for ${domain} returned "${status}". You may have been logged out.`
  });
}

async function getSettings() {
  return readSettings();
}

async function updateSettings(patch) {
  const { settings, intervalChanged } = await withStorageLock(async () => {
    const current = await readSettings();
    const merged = mergeSettings(sanitizeSettingsPatch(patch), current);
    await store.set({ settings: merged });
    return { settings: merged, intervalChanged: merged.interval !== current.interval };
  });
  if (intervalChanged) await scheduleKeepalive();
  return settings;
}

async function mutateSites(mutate) {
  await withStorageLock(async () => {
    const sites = await readSites();
    await store.set({ sites: mutate(sites) || sites });
  });
  await scheduleKeepalive();
  await updateBadge();
  return describeSites();
}

async function addSite(domain, url) {
  return mutateSites(sites => {
    if (sites.some(s => s.domain === domain)) return sites;
    return [...sites, buildSiteEntry(domain, url)];
  });
}

async function removeSite(domain) {
  const result = await mutateSites(sites => sites.filter(s => s.domain !== domain));
  await withStorageLock(async () => {
    const statuses = await readSiteStatus();
    delete statuses[domain];
    await browser.storage.local.set({ siteStatus: statuses });
  });
  try {
    await browser.permissions.remove({ origins: [siteOrigin(domain)] });
  } catch {}
  await updateBadge();
  return result;
}

async function toggleSite(domain, enabled) {
  return mutateSites(sites => sites.map(s => s.domain === domain ? { ...s, enabled: Boolean(enabled) } : s));
}

async function importSites(imported) {
  return mutateSites(sites => mergeSites(sites, Array.isArray(imported) ? imported : []));
}

async function updateSite(domain, fields) {
  return mutateSites(sites => sites.map(site => {
    if (site.domain !== domain) return site;
    const next = { ...site };
    if (typeof fields.url === "string" && fields.url) next.url = fields.url;
    if ("interval" in fields) {
      next.interval = Number.isFinite(fields.interval) && fields.interval > 0 ? fields.interval : null;
    }
    return next;
  }));
}

async function fetchSiteStatus(site) {
  if (!(await hasSiteAccess(site.domain))) return "no-access";
  try {
    const res = await fetch(site.url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow"
    });
    return classifyPing(site.domain, res.ok, res.status, res.url);
  } catch {
    return "error";
  }
}

async function recordSiteStatus(domain, status) {
  const previous = await withStorageLock(async () => {
    const sites = await readSites();
    if (!sites.some(s => s.domain === domain)) return undefined;
    const statuses = await readSiteStatus();
    const before = statuses[domain]?.lastStatus ?? null;
    statuses[domain] = { lastPing: Date.now(), lastStatus: status };
    await browser.storage.local.set({ siteStatus: statuses });
    return before;
  });
  if (previous === "ok" && status !== "ok" && status !== "no-access") notifySessionLost(domain, status);
}

async function pingSites(domains) {
  const targets = (await readSites()).filter(s => s.enabled && (!domains || domains.includes(s.domain)));
  await Promise.all(targets.map(async site => {
    await recordSiteStatus(site.domain, await fetchSiteStatus(site));
  }));
  await updateBadge();
}
