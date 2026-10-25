const DEFAULT_INTERVAL = 5;
const DEFAULT_SETTINGS = {
  interval: DEFAULT_INTERVAL,
  dedupeIgnoreQuery: false,
  groupByBaseDomain: false,
  liveMode: false,
  liveSort: true,
  liveAutoGroup: false
};

const store = browser.storage.sync || browser.storage.local;

let storageLock = Promise.resolve();

function withStorageLock(task) {
  const run = storageLock.then(task);
  storageLock = run.catch(() => {});
  return run;
}

async function migrateToSyncStorage() {
  if (store === browser.storage.local) return;
  try {
    const synced = await store.get(["sites", "settings"]);
    if (synced.sites || synced.settings) return;
    const local = await browser.storage.local.get(["sites", "settings"]);
    if (local.sites || local.settings) await store.set(local);
  } catch {}
}

async function migrateSiteStatus() {
  const { sites } = await store.get("sites");
  if (!Array.isArray(sites)) return;
  const { siteStatus } = await browser.storage.local.get("siteStatus");
  const result = splitSiteStatus(sites, siteStatus || {});
  if (!result.changed) return;
  await browser.storage.local.set({ siteStatus: result.statuses });
  await store.set({ sites: result.sites });
}

async function migrateStorage() {
  await migrateToSyncStorage();
  await migrateSiteStatus();
}

async function readSites() {
  const { sites } = await store.get("sites");
  return sites || [];
}

async function readSiteStatus() {
  const { siteStatus } = await browser.storage.local.get("siteStatus");
  return siteStatus || {};
}

async function readSettings() {
  const { settings } = await store.get("settings");
  return mergeSettings(settings || {}, DEFAULT_SETTINGS);
}

function siteOrigin(domain) {
  return `*://${domain}/*`;
}

async function hasSiteAccess(domain) {
  try {
    return await browser.permissions.contains({ origins: [siteOrigin(domain)] });
  } catch {
    return false;
  }
}

async function describeSites() {
  const [sites, statuses] = await Promise.all([readSites(), readSiteStatus()]);
  return Promise.all(sites.map(async site => ({
    ...site,
    lastPing: statuses[site.domain]?.lastPing ?? null,
    lastStatus: statuses[site.domain]?.lastStatus ?? null,
    hasAccess: await hasSiteAccess(site.domain)
  })));
}
