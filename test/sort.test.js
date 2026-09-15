const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sortTabs, planSortedOrder } = require("../extension/lib.js");

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

describe("planSortedOrder", () => {
  const groups = [
    { id: 10, title: "work" },
    { id: 20, title: "news" }
  ];

  it("puts grouped tabs before ungrouped tabs", () => {
    const tabs = [
      { id: 1, url: "https://a.com/", title: "A", pinned: false, groupId: -1 },
      { id: 2, url: "https://b.com/", title: "B", pinned: false, groupId: 10 }
    ];

    const result = planSortedOrder(tabs, groups);

    assert.deepEqual(result.map(t => t.id), [2, 1]);
  });

  it("orders groups by title and sorts tabs within each group", () => {
    const tabs = [
      { id: 1, url: "https://z.com/", title: "Z", pinned: false, groupId: 10 },
      { id: 2, url: "https://a.com/", title: "A", pinned: false, groupId: 10 },
      { id: 3, url: "https://m.com/", title: "M", pinned: false, groupId: 20 },
      { id: 4, url: "https://b.com/", title: "B", pinned: false, groupId: -1 },
      { id: 5, url: "https://a.com/", title: "A", pinned: false, groupId: -1 }
    ];

    const result = planSortedOrder(tabs, groups);

    assert.deepEqual(result.map(t => t.id), [3, 2, 1, 5, 4]);
  });

  it("treats missing groupId as ungrouped", () => {
    const tabs = [
      { id: 1, url: "https://b.com/", title: "B", pinned: false },
      { id: 2, url: "https://a.com/", title: "A", pinned: false, groupId: 10 }
    ];

    const result = planSortedOrder(tabs, groups);

    assert.deepEqual(result.map(t => t.id), [2, 1]);
  });

  it("excludes pinned tabs and tabs without url", () => {
    const tabs = [
      { id: 1, url: "https://a.com/", title: "A", pinned: true, groupId: -1 },
      { id: 2, url: null, pinned: false, groupId: -1 },
      { id: 3, url: "https://b.com/", title: "B", pinned: false, groupId: -1 }
    ];

    const result = planSortedOrder(tabs, groups);

    assert.deepEqual(result.map(t => t.id), [3]);
  });

  it("handles unknown group ids without titles", () => {
    const tabs = [
      { id: 1, url: "https://a.com/", title: "A", pinned: false, groupId: 99 },
      { id: 2, url: "https://b.com/", title: "B", pinned: false, groupId: -1 }
    ];

    const result = planSortedOrder(tabs, []);

    assert.deepEqual(result.map(t => t.id), [1, 2]);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(planSortedOrder([], []), []);
  });
});
