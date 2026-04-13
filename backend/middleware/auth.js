"use strict";

const crypto = require("crypto");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidToken(expectedToken, providedToken) {
  if (!expectedToken || !providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(String(expectedToken), "utf8");
  const providedBuffer = Buffer.from(String(providedToken), "utf8");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function extractRequestToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return req.headers["x-server-token"] || null;
}

function createAuthMiddleware(token) {
  const publicPaths = new Set([
    "/",
    "/index.html",
    "/script.js",
    "/style.css",
    "/public/content-filter-client.js",
    "/public/local-api-auth.js",
  ]);
  const publicPrefixes = ["/public/", "/assets/", "/downloads/"];

  return function authMiddleware(req, res, next) {
    if (
      req.headers.upgrade &&
      String(req.headers.upgrade).toLowerCase() === "websocket"
    ) {
      return next();
    }

    if (req.method === "GET") {
      if (publicPaths.has(req.path)) {
        return next();
      }

      if (publicPrefixes.some((prefix) => req.path.startsWith(prefix))) {
        return next();
      }
    }

    if (isValidToken(token, extractRequestToken(req))) {
      return next();
    }

    res.status(401).json({ error: "Unauthorized" });
  };
}

module.exports = {
  createAuthMiddleware,
  extractRequestToken,
  generateToken,
  isValidToken,
};
