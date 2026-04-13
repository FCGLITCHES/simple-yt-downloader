"use strict";

/**
 * @typedef {Object} RateLimiterOptions
 * @property {number} [windowMs=60000] - Time window in milliseconds
 * @property {number} [maxRequests=30] - Maximum requests per window per client
 */

/**
 * Create a rate limiting Express middleware.
 *
 * Tracks request counts per client (identified by IP address or X-Client-ID header)
 * within a sliding time window. Sets standard rate-limit response headers and
 * returns 429 when the limit is exceeded.
 *
 * @param {RateLimiterOptions} [options={}]
 * @returns {import('express').RequestHandler} Express middleware
 */
function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs) || 60000;
  const maxRequests = Number(options.maxRequests) || 30;

  /** @type {Map<string, {count: number, resetTime: number}>} */
  const clients = new Map();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clients) {
      if (now > entry.resetTime) {
        clients.delete(key);
      }
    }
  }, windowMs);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const ip =
      req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
    const clientId = req.headers["x-client-id"] || ip;

    let entry = clients.get(clientId);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      clients.set(clientId, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetTimeSeconds = Math.ceil((entry.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(entry.resetTime / 1000)),
    );

    if (entry.count > maxRequests) {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: resetTimeSeconds,
      });
      return;
    }

    next();
  };
}

/** @type {import('express').RequestHandler} Strict rate limiter: 15 req/min */
const strictLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 15 });

/** @type {import('express').RequestHandler} Standard rate limiter: 60 req/min */
const standardLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 60 });

/** @type {import('express').RequestHandler} Loose rate limiter: 120 req/min */
const looseLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 120 });

module.exports = {
  createRateLimiter,
  strictLimiter,
  standardLimiter,
  looseLimiter,
};
