const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createAuthMiddleware,
  extractRequestToken,
  generateToken,
  isValidToken,
} = require("../backend/middleware/auth");

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("generateToken creates a 64 character hex token", () => {
  const token = generateToken();
  assert.match(token, /^[a-f0-9]{64}$/);
});

test("extractRequestToken prefers Bearer authorization", () => {
  const req = {
    headers: {
      authorization: "Bearer secret-token",
      "x-server-token": "fallback-token",
    },
  };

  assert.equal(extractRequestToken(req), "secret-token");
});

test("isValidToken uses exact token matching", () => {
  assert.equal(isValidToken("abc123", "abc123"), true);
  assert.equal(isValidToken("abc123", "abc124"), false);
  assert.equal(isValidToken("abc123", null), false);
});

test("auth middleware allows public static GET requests", async () => {
  const middleware = createAuthMiddleware("expected-token");
  const req = { method: "GET", path: "/index.html", headers: {} };
  const res = createResponseRecorder();

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test("auth middleware blocks protected requests without a token", async () => {
  const middleware = createAuthMiddleware("expected-token");
  const req = { method: "POST", path: "/shutdown", headers: {} };
  const res = createResponseRecorder();

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: "Unauthorized" });
});

test("auth middleware allows protected requests with X-Server-Token", async () => {
  const middleware = createAuthMiddleware("expected-token");
  const req = {
    method: "POST",
    path: "/update-tools",
    headers: { "x-server-token": "expected-token" },
  };
  const res = createResponseRecorder();

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
