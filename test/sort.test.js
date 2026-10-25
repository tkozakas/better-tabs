const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sortTabs } = require("../extension/lib.js");

describe("sortTabs", () => {
  it("sorts by hostname then title", () => {
    const tabs = [
      { id: 1, url: "https://z.com/b", title: "Zeta", pinned: false },
      { id: 2, url: "https://a.com/c", title: "Beta", pinned: false },
      { id: 3, url: "https://a.com/a", title: "Alpha", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.deepEqual(result.map(t => t.id), [3, 2, 1]);
  });

  it("keeps subdomains of the same site together", () => {
    const tabs = [
      { id: 1, url: "https://mail.example.com/", title: "Mail", pinned: false },
      { id: 2, url: "https://a.zzz.com/", title: "Zzz", pinned: false },
      { id: 3, url: "https://docs.example.com/", title: "Docs", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.deepEqual(result.map(t => t.id), [3, 1, 2]);
  });

  it("falls back to url when titles match", () => {
    const tabs = [
      { id: 1, url: "https://a.com/b", title: "Same", pinned: false },
      { id: 2, url: "https://a.com/a", title: "Same", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.deepEqual(result.map(t => t.id), [2, 1]);
  });

  it("excludes pinned tabs", () => {
    const tabs = [
      { id: 1, url: "https://a.com", pinned: true },
      { id: 2, url: "https://b.com", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
  });

  it("excludes tabs without url", () => {
    const tabs = [
      { id: 1, url: null, pinned: false },
      { id: 2, url: "https://a.com", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.equal(result.length, 1);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(sortTabs([]), []);
  });

  it("does not mutate original array", () => {
    const tabs = [
      { id: 1, url: "https://z.com", pinned: false },
      { id: 2, url: "https://a.com", pinned: false }
    ];
    const original = [...tabs];

    sortTabs(tabs);

    assert.equal(tabs[0].id, original[0].id);
  });
});
