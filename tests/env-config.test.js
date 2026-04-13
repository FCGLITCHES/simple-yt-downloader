const test = require("node:test");
const assert = require("node:assert/strict");

const { loadEnv } = require("../backend/config/env");

test("loadEnv applies defaults for missing values", () => {
  const env = loadEnv({});

  assert.equal(env.PORT, 9875);
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.RESEND_API_KEY, "");
});

test("loadEnv trims optional string values", () => {
  const env = loadEnv({
    SUPPORT_EMAIL: "  hello@example.com  ",
    NODE_BINARY: "  C:/node.exe  ",
  });

  assert.equal(env.SUPPORT_EMAIL, "hello@example.com");
  assert.equal(env.NODE_BINARY, "C:/node.exe");
});

test("loadEnv falls back when PORT is invalid", () => {
  const warnings = [];
  const env = loadEnv(
    { PORT: "invalid" },
    { warn(message) { warnings.push(message); } },
  );

  assert.equal(env.PORT, 9875);
  assert.equal(warnings.length, 1);
});

test("loadEnv accepts a valid numeric PORT", () => {
  const env = loadEnv({ PORT: "3456", NODE_ENV: "development" });

  assert.equal(env.PORT, 3456);
  assert.equal(env.NODE_ENV, "development");
});
