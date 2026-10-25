const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPing,
  effectiveInterval,
  buildSiteEntry,
  sanitizeSiteEntry,
  splitSiteStatus,
  hasFailingSite,
  sanitizeSettingsPatch,
  mergeSites,
  mergeSettings
} = require("../extension/lib.js");

describe("classifyPing", () => {
  it("returns ok for a successful same-site response", () => {
    assert.equal(classifyPing("app.example.com", true, 200, "https://app.example.com/dash"), "ok");
  });

  it("treats a sibling subdomain as the same site", () => {
    assert.equal(classifyPing("app.example.com", true, 200, "https://cdn.example.com/x"), "ok");
  });

  it("flags redirect to a different site", () => {
    assert.equal(classifyPing("app.example.com", true, 200, "https://sso.okta.com/login"), "redirected");
  });

  it("flags redirect to a login path on the same site", () => {
    assert.equal(classifyPing("app.example.com", true, 200, "https://app.example.com/login"), "redirected");
    assert.equal(classifyPing("app.example.com", true, 200, "https://app.example.com/sign-in"), "redirected");
    assert.equal(classifyPing("app.example.com", true, 200, "https://app.example.com/sso/start"), "redirected");
  });

  it("does not flag paths merely containing login-like substrings", () => {
    assert.equal(classifyPing("app.example.com", true, 200, "https://app.example.com/blog/logins-explained"), "ok");
  });

  it("returns http status for failed responses", () => {
    assert.equal(classifyPing("a.com", false, 401, "https://a.com/"), "401");
    assert.equal(classifyPing("a.com", false, 503, "https://a.com/"), "503");
  });

  it("returns error when status is missing", () => {
    assert.equal(classifyPing("a.com", false, undefined, "https://a.com/"), "error");
  });

  it("returns ok when final url is unparseable", () => {
    assert.equal(classifyPing("a.com", true, 200, "not-a-url"), "ok");
  });
});

describe("effectiveInterval", () => {
  const settings = { interval: 5 };

  it("uses the site override when set", () => {
    assert.equal(effectiveInterval({ interval: 1 }, settings), 1);
  });

  it("falls back to the global interval", () => {
    assert.equal(effectiveInterval({ interval: null }, settings), 5);
    assert.equal(effectiveInterval({}, settings), 5);
  });
});

describe("buildSiteEntry", () => {
  it("creates entry with provided url", () => {
    const entry = buildSiteEntry("example.com", "https://example.com/dashboard");

    assert.deepEqual(entry, {
      domain: "example.com",
      url: "https://example.com/dashboard",
      enabled: true,
      interval: null
    });
  });

  it("defaults url to https origin when not provided", () => {
    assert.equal(buildSiteEntry("example.com").url, "https://example.com/");
  });

  it("defaults url when passed null", () => {
    assert.equal(buildSiteEntry("example.com", null).url, "https://example.com/");
  });
});

describe("sanitizeSiteEntry", () => {
  it("builds a fresh entry from imported data", () => {
    const entry = sanitizeSiteEntry({ domain: "a.com", url: "https://a.com/app", enabled: false, interval: 2, lastPing: 123 });

    assert.deepEqual(entry, {
      domain: "a.com",
      url: "https://a.com/app",
      enabled: false,
      interval: 2
    });
  });

  it("defaults enabled to true", () => {
    assert.equal(sanitizeSiteEntry({ domain: "a.com" }).enabled, true);
  });

  it("rejects invalid intervals", () => {
    assert.equal(sanitizeSiteEntry({ domain: "a.com", interval: -1 }).interval, null);
    assert.equal(sanitizeSiteEntry({ domain: "a.com", interval: "5" }).interval, null);
    assert.equal(sanitizeSiteEntry({ domain: "a.com" }).interval, null);
  });

  it("defaults url when missing or not a string", () => {
    assert.equal(sanitizeSiteEntry({ domain: "a.com" }).url, "https://a.com/");
    assert.equal(sanitizeSiteEntry({ domain: "a.com", url: 42 }).url, "https://a.com/");
  });

  it("rejects entries without a domain", () => {
    assert.equal(sanitizeSiteEntry(null), null);
    assert.equal(sanitizeSiteEntry({}), null);
    assert.equal(sanitizeSiteEntry({ domain: "" }), null);
    assert.equal(sanitizeSiteEntry({ domain: 42 }), null);
  });
});

describe("mergeSites", () => {
  const existing = [{ domain: "a.com", url: "https://a.com/", enabled: true, interval: null }];

  it("appends new imported sites", () => {
    const result = mergeSites(existing, [{ domain: "b.com" }]);

    assert.equal(result.length, 2);
    assert.equal(result[1].domain, "b.com");
  });

  it("keeps existing entry on domain conflict", () => {
    const result = mergeSites(existing, [{ domain: "a.com", url: "https://a.com/other" }]);

    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://a.com/");
  });

  it("skips invalid imported entries", () => {
    const result = mergeSites(existing, [null, {}, { domain: "b.com" }]);

    assert.equal(result.length, 2);
  });

  it("deduplicates within the imported list", () => {
    const result = mergeSites([], [{ domain: "b.com" }, { domain: "b.com" }]);

    assert.equal(result.length, 1);
  });

  it("does not mutate the existing list", () => {
    mergeSites(existing, [{ domain: "b.com" }]);

    assert.equal(existing.length, 1);
  });
});

describe("mergeSettings", () => {
  const defaults = { interval: 5, dedupeIgnoreQuery: false, liveMode: false, liveAutoGroup: false, groupByBaseDomain: false };

  it("returns defaults when saved is empty", () => {
    assert.deepEqual(mergeSettings({}, defaults), defaults);
  });

  it("overrides defaults with saved values", () => {
    const result = mergeSettings({ interval: 10, liveMode: true }, defaults);

    assert.equal(result.interval, 10);
    assert.equal(result.liveMode, true);
    assert.equal(result.dedupeIgnoreQuery, false);
  });

  it("preserves extra saved keys", () => {
    const result = mergeSettings({ extra: "value" }, defaults);

    assert.equal(result.extra, "value");
    assert.equal(result.interval, 5);
  });
});

describe("splitSiteStatus", () => {
  it("moves status fields out of site entries", () => {
    const sites = [{ domain: "a.com", url: "u", enabled: true, interval: null, lastPing: 5, lastStatus: "ok" }];

    const result = splitSiteStatus(sites, {});

    assert.equal(result.changed, true);
    assert.deepEqual(result.sites, [{ domain: "a.com", url: "u", enabled: true, interval: null }]);
    assert.deepEqual(result.statuses, { "a.com": { lastPing: 5, lastStatus: "ok" } });
  });

  it("keeps existing local status", () => {
    const sites = [{ domain: "a.com", lastPing: 5, lastStatus: "ok" }];

    const result = splitSiteStatus(sites, { "a.com": { lastPing: 9, lastStatus: "500" } });

    assert.deepEqual(result.statuses["a.com"], { lastPing: 9, lastStatus: "500" });
  });

  it("reports no change for clean sites", () => {
    assert.equal(splitSiteStatus([{ domain: "a.com" }], {}).changed, false);
  });
});

describe("hasFailingSite", () => {
  const sites = [{ domain: "a.com", enabled: true }, { domain: "b.com", enabled: false }];

  it("is false when statuses are ok or unknown", () => {
    assert.equal(hasFailingSite(sites, { "a.com": { lastStatus: "ok" } }), false);
    assert.equal(hasFailingSite(sites, {}), false);
  });

  it("is true for a failing enabled site", () => {
    assert.equal(hasFailingSite(sites, { "a.com": { lastStatus: "no-access" } }), true);
  });

  it("ignores disabled sites", () => {
    assert.equal(hasFailingSite(sites, { "b.com": { lastStatus: "500" } }), false);
  });
});

describe("sanitizeSettingsPatch", () => {
  it("keeps only valid known keys", () => {
    const patch = { interval: 7, liveMode: true, liveSort: "yes", bogus: 1 };

    assert.deepEqual(sanitizeSettingsPatch(patch), { interval: 7, liveMode: true });
  });

  it("rejects bad intervals and non-objects", () => {
    assert.deepEqual(sanitizeSettingsPatch({ interval: 0 }), {});
    assert.deepEqual(sanitizeSettingsPatch(null), {});
  });
});
