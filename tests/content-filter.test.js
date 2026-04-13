const test = require("node:test");
const assert = require("node:assert/strict");

const {
  contentFilter_isBlockedUrl,
} = require("../backend/shared/content-filter");

test("content filter blocks explicit pornography domains", () => {
  assert.deepEqual(contentFilter_isBlockedUrl("https://www.pornhub.com/view"), {
    blocked: true,
    reason: "pornography",
  });
});

test("content filter blocks gambling paths", () => {
  assert.deepEqual(contentFilter_isBlockedUrl("https://example.com/casino/live"), {
    blocked: true,
    reason: "gambling",
  });
});

test("content filter allows safe video sites", () => {
  assert.deepEqual(
    contentFilter_isBlockedUrl("https://www.youtube.com/watch?v=abc123"),
    { blocked: false },
  );
});

test("content filter fallback protects malformed blocked urls", () => {
  assert.deepEqual(contentFilter_isBlockedUrl("not-a-url bet365.com/live"), {
    blocked: true,
    reason: "gambling",
  });
});
