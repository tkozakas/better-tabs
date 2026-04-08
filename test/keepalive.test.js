const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { filterPingTargets, buildSiteEntry, mergeSettings } = require("../extension/lib.js");

describe("filterPingTargets", () => {
  const sites = [
    { domain: "a.com", enabled: true },
    { domain: "b.com", enabled: false },
    { domain: "c.com", enabled: true }
  ];

  it("excludes disabled sites", () => {
    const result = filterPingTargets(sites, { onlyWithOpenTab: false }, new Set());

    assert.equal(result.length, 2);
    assert.ok(result.every(s => s.enabled));
  });

  it("excludes sites without open tab when setting is on", () => {
    const openDomains = new Set(["a.com"]);
    const result = filterPingTargets(sites, { onlyWithOpenTab: true }, openDomains);

    assert.equal(result.length, 1);
    assert.equal(result[0].domain, "a.com");
  });

  it("includes all enabled sites when setting is off", () => {
    const result = filterPingTargets(sites, { onlyWithOpenTab: false }, new Set());

    assert.equal(result.length, 2);
  });

  it("returns empty when no sites match", () => {
    const result = filterPingTargets(sites, { onlyWithOpenTab: true }, new Set(["x.com"]));

    assert.equal(result.length, 0);
  });

  it("handles empty sites array", () => {
    assert.deepEqual(filterPingTargets([], { onlyWithOpenTab: false }, new Set()), []);
  });
});

describe("buildSiteEntry", () => {
  it("creates entry with provided url", () => {
    const entry = buildSiteEntry("example.com", "https://example.com/dashboard");

    assert.equal(entry.domain, "example.com");
    assert.equal(entry.url, "https://example.com/dashboard");
    assert.equal(entry.enabled, true);
    assert.equal(entry.lastPing, null);
    assert.equal(entry.lastStatus, null);
  });

  it("defaults url to https origin when not provided", () => {
    const entry = buildSiteEntry("example.com");

    assert.equal(entry.url, "https://example.com/");
  });

  it("defaults url when passed null", () => {
    const entry = buildSiteEntry("example.com", null);

    assert.equal(entry.url, "https://example.com/");
  });
});

describe("mergeSettings", () => {
  const defaults = { interval: 5, onlyWithOpenTab: true };

  it("returns defaults when saved is empty", () => {
    const result = mergeSettings({}, defaults);

    assert.deepEqual(result, defaults);
  });

  it("overrides defaults with saved values", () => {
    const result = mergeSettings({ interval: 10 }, defaults);

    assert.equal(result.interval, 10);
    assert.equal(result.onlyWithOpenTab, true);
  });

  it("preserves extra saved keys", () => {
    const result = mergeSettings({ extra: "value" }, defaults);

    assert.equal(result.extra, "value");
    assert.equal(result.interval, 5);
  });
});
