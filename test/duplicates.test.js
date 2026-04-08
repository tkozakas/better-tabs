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
