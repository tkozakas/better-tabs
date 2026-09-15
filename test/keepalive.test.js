const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  filterPingTargets,
  classifyPing,
  effectiveInterval,
  buildSiteEntry,
  sanitizeSiteEntry,
  mergeSites,
  mergeSettings
} = require("../extension/lib.js");

describe("filterPingTargets", () => {
  const sites = [
    { domain: "a.com", enabled: true },
    { domain: "b.com", enabled: false },
    { domain: "c.com", enabled: true }
  ];

  it("includes every enabled site", () => {
    const result = filterPingTargets(sites);

    assert.deepEqual(result.map(s => s.domain), ["a.com", "c.com"]);
  });

  it("excludes disabled sites", () => {
    const result = filterPingTargets(sites);

    assert.ok(result.every(s => s.enabled));
  });

  it("handles empty sites array", () => {
    assert.deepEqual(filterPingTargets([]), []);
  });
});

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
      interval: null,
      lastPing: null,
      lastStatus: null
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
      interval: 2,
      lastPing: null,
      lastStatus: null
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
  const existing = [{ domain: "a.com", url: "https://a.com/", enabled: true, interval: null, lastPing: 1, lastStatus: "ok" }];

  it("appends new imported sites", () => {
    const result = mergeSites(existing, [{ domain: "b.com" }]);

    assert.equal(result.length, 2);
    assert.equal(result[1].domain, "b.com");
  });

  it("keeps existing entry on domain conflict", () => {
    const result = mergeSites(existing, [{ domain: "a.com", url: "https://a.com/other" }]);

    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://a.com/");
    assert.equal(result[0].lastPing, 1);
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
