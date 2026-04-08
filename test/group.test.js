const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { groupByDomain } = require("../extension/lib.js");

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
