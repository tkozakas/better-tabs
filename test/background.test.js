const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("./helpers/fake-browser.js");

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const okResponse = domain => ({ ok: true, status: 200, url: `https://${domain}/` });
const site = (domain, extra = {}) => ({ domain, url: `https://${domain}/`, enabled: true, interval: null, ...extra });
const tab = (id, url, extra = {}) => ({ id, url, title: url, ...extra });
const access = (...domains) => domains.map(d => `*://${d}/*`);

describe("storage migration", () => {
  it("moves lastPing and lastStatus out of synced sites into local siteStatus", async () => {
    const bg = loadBackground({
      sync: { sites: [site("a.com", { lastPing: 100, lastStatus: "ok" }), site("b.com")] }
    });
    await bg.ready;

    assert.deepEqual(bg.browser.storage.sync.data.sites, [site("a.com"), site("b.com")]);
    assert.deepEqual(bg.browser.storage.local.data.siteStatus, { "a.com": { lastPing: 100, lastStatus: "ok" } });
  });

  it("is idempotent and keeps newer local status", async () => {
    const bg = loadBackground({
      sync: { sites: [site("a.com", { lastPing: 1, lastStatus: "ok" })] },
      local: { siteStatus: { "a.com": { lastPing: 9, lastStatus: "500" } } }
    });
    await bg.ready;

    assert.deepEqual(bg.browser.storage.local.data.siteStatus, { "a.com": { lastPing: 9, lastStatus: "500" } });
    assert.equal("lastPing" in bg.browser.storage.sync.data.sites[0], false);
  });

  it("copies legacy local config to sync before stripping status", async () => {
    const bg = loadBackground({ local: { sites: [site("a.com", { lastPing: 3, lastStatus: "ok" })] } });
    await bg.ready;

    assert.deepEqual(bg.browser.storage.sync.data.sites, [site("a.com")]);
    assert.equal(bg.browser.storage.local.data.siteStatus["a.com"].lastStatus, "ok");
  });
});

describe("pinging", () => {
  it("records status for sites with granted access", async () => {
    const bg = loadBackground({ sync: { sites: [site("a.com")] }, permissions: access("a.com"), fetch: async () => okResponse("a.com") });
    await bg.ready;

    const sites = await bg.send({ type: "pingNow" });

    assert.equal(sites[0].lastStatus, "ok");
    assert.equal(sites[0].hasAccess, true);
    assert.equal(bg.state.badge.text, "");
  });

  it("skips sites without access and flags them", async () => {
    const bg = loadBackground({ sync: { sites: [site("a.com")] } });
    await bg.ready;

    const sites = await bg.send({ type: "pingNow" });

    assert.equal(bg.fetchCalls.length, 0);
    assert.equal(sites[0].lastStatus, "no-access");
    assert.equal(sites[0].hasAccess, false);
    assert.equal(bg.state.badge.text, "!");
  });

  it("keeps a site removed during a ping removed", async () => {
    const gate = deferred();
    const bg = loadBackground({
      sync: { sites: [site("a.com")] },
      permissions: access("a.com"),
      fetch: async () => { await gate.promise; return okResponse("a.com"); }
    });
    await bg.ready;

    const ping = bg.send({ type: "pingNow" });
    while (bg.fetchCalls.length === 0) await new Promise(r => setImmediate(r));
    await bg.send({ type: "removeSite", domain: "a.com" });
    gate.resolve();
    await ping;

    assert.deepEqual(await bg.send({ type: "getSites" }), []);
    assert.deepEqual(bg.browser.storage.local.data.siteStatus, {});
    assert.deepEqual(bg.browser.storage.sync.data.sites, []);
  });

  it("keeps config edits made during a ping", async () => {
    const gate = deferred();
    const bg = loadBackground({
      sync: { sites: [site("a.com")] },
      permissions: access("a.com"),
      fetch: async () => { await gate.promise; return okResponse("a.com"); }
    });
    await bg.ready;

    const ping = bg.send({ type: "pingNow" });
    while (bg.fetchCalls.length === 0) await new Promise(r => setImmediate(r));
    await bg.send({ type: "updateSite", domain: "a.com", fields: { interval: 15 } });
    await bg.send({ type: "addSite", domain: "b.com" });
    gate.resolve();
    await ping;

    const sites = await bg.send({ type: "getSites" });
    assert.deepEqual(sites.map(s => [s.domain, s.interval]), [["a.com", 15], ["b.com", null]]);
    assert.equal(sites[0].lastStatus, "ok");
  });

  it("records the results of concurrent pings", async () => {
    const gates = { "https://a.com/": deferred(), "https://b.com/": deferred() };
    const bg = loadBackground({
      sync: { sites: [site("a.com"), site("b.com")] },
      permissions: access("a.com", "b.com"),
      fetch: async url => {
        await gates[url].promise;
        return { ok: true, status: 200, url };
      }
    });
    await bg.ready;

    const alarms = bg.browser.alarms.onAlarm.emit({ name: "keepalive:a.com" }).concat(
      bg.browser.alarms.onAlarm.emit({ name: "keepalive:b.com" })
    );
    while (bg.fetchCalls.length < 2) await new Promise(r => setImmediate(r));
    gates["https://b.com/"].resolve();
    gates["https://a.com/"].resolve();
    await Promise.all(alarms);

    const status = bg.browser.storage.local.data.siteStatus;
    assert.equal(status["a.com"].lastStatus, "ok");
    assert.equal(status["b.com"].lastStatus, "ok");
  });

  it("notifies when a previously ok site fails", async () => {
    let status = 200;
    const bg = loadBackground({
      sync: { sites: [site("a.com")] },
      permissions: access("a.com"),
      fetch: async () => ({ ok: status === 200, status, url: "https://a.com/" })
    });
    await bg.ready;

    await bg.send({ type: "pingNow" });
    status = 500;
    await bg.send({ type: "pingNow" });

    assert.equal(bg.state.notifications.length, 1);
    assert.equal(bg.state.badge.text, "!");
  });
});

describe("settings and sites", () => {
  it("merges a settings patch and returns full settings", async () => {
    const bg = loadBackground({ sync: { settings: { interval: 5, liveMode: true } } });
    await bg.ready;

    const settings = await bg.send({ type: "updateSettings", patch: { dedupeIgnoreQuery: true } });

    assert.equal(settings.liveMode, true);
    assert.equal(settings.dedupeIgnoreQuery, true);
    assert.equal(settings.liveSort, true);
  });

  it("reschedules alarms only when interval changes", async () => {
    const bg = loadBackground({ sync: { sites: [site("a.com")] } });
    await bg.ready;
    bg.state.alarms.clear();

    await bg.send({ type: "updateSettings", patch: { liveMode: true } });
    assert.equal(bg.state.alarms.size, 0);

    await bg.send({ type: "updateSettings", patch: { interval: 9 } });
    assert.equal(bg.state.alarms.get("keepalive:a.com").periodInMinutes, 9);
  });

  it("revokes the origin and status when a site is removed", async () => {
    const bg = loadBackground({
      sync: { sites: [site("a.com")] },
      local: { siteStatus: { "a.com": { lastPing: 1, lastStatus: "ok" } } },
      permissions: access("a.com")
    });
    await bg.ready;

    await bg.send({ type: "removeSite", domain: "a.com" });

    assert.equal(bg.state.permissions.size, 0);
    assert.deepEqual(bg.browser.storage.local.data.siteStatus, {});
  });

  it("reports the current tab and whether it is protected", async () => {
    const bg = loadBackground({
      sync: { sites: [site("a.com")] },
      tabs: [tab(1, "https://a.com/x", { active: true })]
    });
    await bg.ready;
    assert.deepEqual(await bg.send({ type: "getCurrentTab" }), { domain: "a.com", url: "https://a.com/x", protected: true });

    const other = loadBackground({ tabs: [tab(1, "about:blank", { active: true })] });
    await other.ready;
    assert.deepEqual(await other.send({ type: "getCurrentTab" }), { domain: null, url: null, protected: false });
  });
});

describe("undo close", () => {
  it("reopens the exact closed urls at their indexes", async () => {
    const bg = loadBackground({
      tabs: [
        tab(1, "https://a.com/x", { active: true }),
        tab(2, "https://a.com/x"),
        tab(3, "https://b.com/"),
        tab(4, "https://a.com/x")
      ]
    });
    await bg.ready;
    assert.deepEqual(await bg.send({ type: "getLastClosed" }), { count: 0, at: null });

    const closed = await bg.send({ type: "closeDuplicates" });
    const last = await bg.send({ type: "getLastClosed" });
    const undone = await bg.send({ type: "undoClose" });

    assert.deepEqual(closed, { ok: true, closed: 2 });
    assert.equal(last.count, 2);
    assert.ok(last.at > 0);
    assert.deepEqual(undone, { ok: true, restored: 2 });
    assert.deepEqual(bg.state.calls.create.map(c => [c.url, c.index, c.windowId, c.pinned]), [
      ["https://a.com/x", 1, 1, false],
      ["https://a.com/x", 3, 1, false]
    ]);
    assert.deepEqual(await bg.send({ type: "getLastClosed" }), { count: 0, at: null });
  });
});

describe("live mode", () => {
  const unsorted = () => [
    tab(1, "https://m.com/", { active: true }),
    tab(2, "https://z.com/"),
    tab(3, "https://a.com/")
  ];

  it("sorts without moving the active tab", async () => {
    const bg = loadBackground({ sync: { settings: { liveMode: true } }, tabs: unsorted() });
    await bg.ready;

    await bg.call("runLiveCleanup()");

    assert.ok(bg.state.calls.move.length > 0);
    assert.ok(bg.state.calls.move.every(m => !m.ids.includes(1)));
    assert.equal(bg.state.tabs.find(t => t.id === 1).index, 0);
    assert.deepEqual(bg.state.tabs.slice(1).map(t => t.id), [3, 2]);
  });

  it("does not sort when liveSort is off", async () => {
    const bg = loadBackground({ sync: { settings: { liveMode: true, liveSort: false } }, tabs: unsorted() });
    await bg.ready;

    await bg.call("runLiveCleanup()");

    assert.equal(bg.state.calls.move.length, 0);
  });

  it("does nothing when live mode is off", async () => {
    const bg = loadBackground({ tabs: [tab(1, "https://a.com/", { active: true }), tab(2, "https://a.com/")] });
    await bg.ready;

    await bg.call("runLiveCleanup()");

    assert.equal(bg.state.calls.remove.length, 0);
  });

  it("runs another pass when triggered during a run", async () => {
    const bg = loadBackground({ sync: { settings: { liveMode: true } }, tabs: unsorted() });
    await bg.ready;
    const originalQuery = bg.browser.tabs.query;
    let queries = 0;
    bg.browser.tabs.query = async q => {
      queries++;
      if (queries === 1) bg.browser.tabs.onCreated.emit({ id: 99 });
      return originalQuery(q);
    };

    await bg.call("runLiveCleanup()");

    assert.ok(queries >= 2 * 2);
  });

  it("triggers on url changes only", async () => {
    const bg = loadBackground({ sync: { settings: { liveMode: true } } });
    await bg.ready;

    bg.browser.tabs.onUpdated.emit(1, { status: "complete" });
    assert.equal(await bg.call("liveTimer"), null);

    bg.browser.tabs.onUpdated.emit(1, { url: "https://a.com/" });
    assert.notEqual(await bg.call("liveTimer !== null ? 1 : null"), null);
    await bg.call("clearTimeout(liveTimer)");
  });
});

describe("manual sort", () => {
  it("batches grouped tabs and uses fresh group positions", async () => {
    const bg = loadBackground({
      groups: [{ id: 10, title: "g" }],
      tabs: [
        tab(1, "https://c.com/"),
        tab(2, "https://z.com/", { groupId: 10 }),
        tab(3, "https://a.com/", { groupId: 10 }),
        tab(4, "https://b.com/", { active: true })
      ]
    });
    await bg.ready;

    const result = await bg.send({ type: "sortTabs" });

    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(bg.state.calls.move[0])), { ids: [3, 2], index: 1 });
    assert.equal(bg.state.calls.move.length, 2);
    assert.deepEqual(bg.state.tabs.map(t => t.id), [3, 2, 4, 1]);
  });
});
