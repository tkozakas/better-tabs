const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUrl, extractDomain } = require("../extension/lib.js");

describe("normalizeUrl", () => {
  it("strips trailing slash", () => {
    assert.equal(normalizeUrl("https://example.com/"), "https://example.com");
  });

  it("returns unchanged url without trailing slash", () => {
    assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  });

  it("handles path with trailing slash", () => {
    assert.equal(normalizeUrl("https://example.com/path/"), "https://example.com/path");
  });

  it("returns empty string for null", () => {
    assert.equal(normalizeUrl(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(normalizeUrl(undefined), "");
  });

  it("returns empty string for empty string", () => {
    assert.equal(normalizeUrl(""), "");
  });
});

describe("extractDomain", () => {
  it("extracts hostname from https url", () => {
    assert.equal(extractDomain("https://example.com/path"), "example.com");
  });

  it("extracts hostname from http url", () => {
    assert.equal(extractDomain("http://sub.example.com"), "sub.example.com");
  });

  it("returns null for invalid url", () => {
    assert.equal(extractDomain("not-a-url"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(extractDomain(""), null);
  });
});
