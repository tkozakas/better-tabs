const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { findDuplicates } = require("../extension/lib.js");

describe("findDuplicates", () => {
  it("finds duplicate tabs by normalized url", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: true },
      { id: 2, url: "https://example.com", active: false },
      { id: 3, url: "https://other.com", active: false }
    ];

    const result = findDuplicates(tabs);

    assert.deepEqual(result, [2]);
  });

  it("treats trailing slash as duplicate", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: true },
      { id: 2, url: "https://example.com/", active: false }
    ];

    const result = findDuplicates(tabs);

    assert.deepEqual(result, [2]);
  });

  it("never closes the active tab", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: true },
      { id: 2, url: "https://example.com", active: false },
      { id: 3, url: "https://example.com", active: false }
    ];

    const result = findDuplicates(tabs);

    assert.deepEqual(result, [2, 3]);
    assert.ok(!result.includes(1));
  });

  it("returns empty array when no duplicates", () => {
    const tabs = [
      { id: 1, url: "https://a.com", active: true },
      { id: 2, url: "https://b.com", active: false },
      { id: 3, url: "https://c.com", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs), []);
  });

  it("handles empty input", () => {
    assert.deepEqual(findDuplicates([]), []);
  });

  it("handles all inactive tabs with duplicates", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: false },
      { id: 2, url: "https://example.com", active: false }
    ];

    const result = findDuplicates(tabs);

    assert.deepEqual(result, [2]);
  });
});

describe("findDuplicates with ignoreQuery", () => {
  it("treats urls differing only by query as duplicates", () => {
    const tabs = [
      { id: 1, url: "https://example.com/page?utm=1", active: true },
      { id: 2, url: "https://example.com/page?utm=2", active: false },
      { id: 3, url: "https://example.com/page", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs, true), [2, 3]);
  });

  it("treats urls differing only by hash as duplicates", () => {
    const tabs = [
      { id: 1, url: "https://example.com/page#a", active: true },
      { id: 2, url: "https://example.com/page#b", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs, true), [2]);
  });

  it("keeps query-distinct urls when flag is off", () => {
    const tabs = [
      { id: 1, url: "https://example.com/page?utm=1", active: true },
      { id: 2, url: "https://example.com/page?utm=2", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs), []);
  });

  it("still distinguishes different paths", () => {
    const tabs = [
      { id: 1, url: "https://example.com/a?x=1", active: true },
      { id: 2, url: "https://example.com/b?x=1", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs, true), []);
  });
});

describe("findDuplicates safety", () => {
  it("never closes pinned tabs", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: false, pinned: true },
      { id: 2, url: "https://example.com", active: false, pinned: true }
    ];

    assert.deepEqual(findDuplicates(tabs), []);
  });

  it("never closes audible tabs", () => {
    const tabs = [
      { id: 1, url: "https://media.com/video", active: true },
      { id: 2, url: "https://media.com/video", active: false, audible: true }
    ];

    assert.deepEqual(findDuplicates(tabs), []);
  });

  it("closes normal duplicate of a pinned tab", () => {
    const tabs = [
      { id: 1, url: "https://example.com", active: false, pinned: true },
      { id: 2, url: "https://example.com", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs), [2]);
  });

  it("closes normal duplicate of an audible tab", () => {
    const tabs = [
      { id: 1, url: "https://media.com/video", active: false, audible: true },
      { id: 2, url: "https://media.com/video", active: false }
    ];

    assert.deepEqual(findDuplicates(tabs), [2]);
  });
});
