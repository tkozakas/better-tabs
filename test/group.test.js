const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { groupByDomain, baseDomain, findSingleTabDomainGroups } = require("../extension/lib.js");

describe("groupByDomain", () => {
  it("groups tabs by hostname", () => {
    const tabs = [
      { id: 1, url: "https://example.com/a", pinned: false },
      { id: 2, url: "https://example.com/b", pinned: false },
      { id: 3, url: "https://other.com/c", pinned: false }
    ];

    const result = groupByDomain(tabs);

    assert.equal(result.size, 2);
    assert.equal(result.get("example.com").length, 2);
    assert.equal(result.get("other.com").length, 1);
  });

  it("skips pinned tabs", () => {
    const tabs = [
      { id: 1, url: "https://example.com/a", pinned: true },
      { id: 2, url: "https://example.com/b", pinned: false }
    ];

    const result = groupByDomain(tabs);

    assert.equal(result.get("example.com").length, 1);
    assert.equal(result.get("example.com")[0].id, 2);
  });

  it("skips tabs without url", () => {
    const tabs = [
      { id: 1, url: null, pinned: false },
      { id: 2, url: undefined, pinned: false },
      { id: 3, url: "https://example.com", pinned: false }
    ];

    const result = groupByDomain(tabs);

    assert.equal(result.size, 1);
    assert.equal(result.get("example.com").length, 1);
  });

  it("returns empty map for empty input", () => {
    assert.equal(groupByDomain([]).size, 0);
  });

  it("skips tabs with invalid urls", () => {
    const tabs = [
      { id: 1, url: "not-a-url", pinned: false },
      { id: 2, url: "https://valid.com", pinned: false }
    ];

    const result = groupByDomain(tabs);

    assert.equal(result.size, 1);
    assert.ok(result.has("valid.com"));
  });
});

describe("baseDomain", () => {
  it("returns eTLD+1 for subdomains", () => {
    assert.equal(baseDomain("mail.google.com"), "google.com");
    assert.equal(baseDomain("a.b.c.example.org"), "example.org");
  });

  it("returns bare domains unchanged", () => {
    assert.equal(baseDomain("example.com"), "example.com");
    assert.equal(baseDomain("localhost"), "localhost");
  });

  it("handles two-level public suffixes", () => {
    assert.equal(baseDomain("shop.amazon.co.uk"), "amazon.co.uk");
    assert.equal(baseDomain("news.bbc.co.uk"), "bbc.co.uk");
  });

  it("leaves ip addresses alone", () => {
    assert.equal(baseDomain("192.168.0.1"), "192.168.0.1");
  });
});

describe("groupByDomain with base domains", () => {
  it("merges subdomains into one group", () => {
    const tabs = [
      { id: 1, url: "https://mail.google.com/", pinned: false },
      { id: 2, url: "https://docs.google.com/", pinned: false },
      { id: 3, url: "https://other.com/", pinned: false }
    ];

    const result = groupByDomain(tabs, true);

    assert.equal(result.size, 2);
    assert.equal(result.get("google.com").length, 2);
  });

  it("keeps subdomains separate by default", () => {
    const tabs = [
      { id: 1, url: "https://mail.google.com/", pinned: false },
      { id: 2, url: "https://docs.google.com/", pinned: false }
    ];

    const result = groupByDomain(tabs);

    assert.equal(result.size, 2);
  });
});

describe("findSingleTabDomainGroups", () => {
  const groups = [
    { id: 10, title: "example.com" },
    { id: 20, title: "github.com" },
    { id: 30, title: "My stuff" }
  ];

  it("returns the tab left alone in a domain group", () => {
    const tabs = [
      { id: 1, groupId: 10 },
      { id: 2, groupId: 20 },
      { id: 3, groupId: 20 }
    ];

    assert.deepEqual(findSingleTabDomainGroups(tabs, groups, ["example.com", "github.com"]), [1]);
  });

  it("leaves user-named groups with one tab alone", () => {
    const tabs = [{ id: 1, groupId: 30 }];

    assert.deepEqual(findSingleTabDomainGroups(tabs, groups, ["example.com"]), []);
  });
});
