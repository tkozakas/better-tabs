const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sortTabs } = require("../extension/lib.js");

describe("sortTabs", () => {
  it("sorts by hostname then url", () => {
    const tabs = [
      { id: 1, url: "https://z.com/b", pinned: false },
      { id: 2, url: "https://a.com/c", pinned: false },
      { id: 3, url: "https://a.com/a", pinned: false }
    ];

    const result = sortTabs(tabs);

    assert.equal(result[0].url, "https://a.com/a");
    assert.equal(result[1].url, "https://a.com/c");
    assert.equal(result[2].url, "https://z.com/b");
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
