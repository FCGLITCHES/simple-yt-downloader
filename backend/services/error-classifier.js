"use strict";

const ERROR_CATEGORIES = Object.freeze({
  auth: "auth",
  cookies: "cookies",
  download: "download",
  network: "network",
  rateLimit: "rate_limit",
  state: "state",
  tooling: "tooling",
  unknown: "unknown",
});

const ERROR_CODES = Object.freeze({
  authRequired: "AUTH_REQUIRED",
  circuitOpen: "CIRCUIT_OPEN",
  cookieExpired: "COOKIE_EXPIRED",
  cookieInvalid: "COOKIE_INVALID",
  downloadEmpty: "DOWNLOAD_EMPTY",
  downloadMissing: "DOWNLOAD_MISSING",
  network: "NETWORK",
  rateLimited: "RATE_LIMITED",
  stateCorrupt: "STATE_CORRUPT",
  tooling: "TOOLING",
  unknown: "UNKNOWN",
});

function normalizeMessage(value) {
  return String(value || "").trim();
}

function includesAny(message, patterns) {
  return patterns.some((pattern) => message.includes(pattern));
}

function classifyRuntimeError({
  message,
  stderr,
  code,
  hasCookies = false,
  siteKey = "generic",
} = {}) {
  const normalizedMessage = normalizeMessage(message);
  const normalizedStderr = normalizeMessage(stderr);
  const combined = `${normalizedMessage}\n${normalizedStderr}`.toLowerCase();

  const baseResult = {
    category: ERROR_CATEGORIES.unknown,
    code: code || ERROR_CODES.unknown,
    retryable: false,
    shouldBackoff: false,
    shouldOpenCircuit: false,
    userMessage:
      normalizedMessage || "The request failed for an unknown reason.",
  };

  if (!combined) {
    return baseResult;
  }

  if (
    includesAny(combined, [
      "yt_circuit_open",
      "rate-limit protection is active",
      "circuit is open",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.rateLimit,
      code: ERROR_CODES.circuitOpen,
      retryable: false,
      userMessage:
        "YouTube rate-limit protection is active. Wait for the cooldown before retrying.",
    };
  }

  if (
    includesAny(combined, [
      "invalid netscape format",
      "no valid cookies",
      "cookiejar.loaderror",
      "cookies file found but appears invalid",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.cookies,
      code: ERROR_CODES.cookieInvalid,
      retryable: false,
      userMessage:
        "The imported cookies file is invalid. Re-import a fresh cookies.txt file.",
    };
  }

  if (
    includesAny(combined, [
      "sign in to confirm",
      "requires authentication",
      "account username missing",
      "authentication failed despite cookies",
      "cookies appear to be expired",
    ])
  ) {
    return {
      ...baseResult,
      category: hasCookies
        ? ERROR_CATEGORIES.cookies
        : ERROR_CATEGORIES.auth,
      code: hasCookies ? ERROR_CODES.cookieExpired : ERROR_CODES.authRequired,
      retryable: false,
      userMessage: hasCookies
        ? "The imported cookies appear to be expired. Import fresh cookies before retrying."
        : "This media requires login. Import cookies before retrying.",
    };
  }

  if (
    includesAny(combined, [
      "429",
      "too many requests",
      "rate limit",
      "throttled",
      "temporarily unavailable",
      "requested content is not available from your location due to rate limiting",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.rateLimit,
      code: ERROR_CODES.rateLimited,
      retryable: siteKey === "youtube",
      shouldBackoff: siteKey === "youtube",
      shouldOpenCircuit: siteKey === "youtube",
      userMessage:
        "Rate limiting was detected. The backend will slow down and retry conservatively.",
    };
  }

  if (
    includesAny(combined, [
      "did not get any data blocks",
      "network is unreachable",
      "timed out",
      "timeout",
      "connection reset",
      "remote end closed connection",
      "unable to download webpage",
      "temporary failure in name resolution",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.network,
      code: ERROR_CODES.network,
      retryable: true,
      userMessage:
        "A network error interrupted the request. Check connectivity and retry.",
    };
  }

  if (
    includesAny(combined, [
      "no such option",
      "unrecognized arguments",
      "process failed to start",
      "enoent",
      "spawn",
      "ffmpeg conversion failed",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.tooling,
      code: ERROR_CODES.tooling,
      retryable: false,
      userMessage:
        "The yt-dlp or FFmpeg toolchain failed. Update tools and retry.",
    };
  }

  if (includesAny(combined, ["output file not found", "download missing"])) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.download,
      code: ERROR_CODES.downloadMissing,
      retryable: true,
      userMessage:
        "yt-dlp reported success, but the final file was not created.",
    };
  }

  if (includesAny(combined, ["file is empty", "0 bytes", "download empty"])) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.download,
      code: ERROR_CODES.downloadEmpty,
      retryable: true,
      userMessage:
        "The output file was created but is empty. The download is not valid.",
    };
  }

  if (
    includesAny(combined, [
      "unexpected token",
      "failed to load history index",
      "state_corrupt",
    ])
  ) {
    return {
      ...baseResult,
      category: ERROR_CATEGORIES.state,
      code: ERROR_CODES.stateCorrupt,
      retryable: false,
      userMessage:
        "Saved backend state is corrupt or incompatible. Reset the stored state before retrying.",
    };
  }

  return baseResult;
}

function createClassifiedError({
  message,
  stderr,
  code,
  hasCookies = false,
  siteKey = "generic",
} = {}) {
  const classification = classifyRuntimeError({
    message,
    stderr,
    code,
    hasCookies,
    siteKey,
  });
  const error = new Error(message || classification.userMessage);
  error.classification = classification;
  return error;
}

module.exports = {
  ERROR_CATEGORIES,
  ERROR_CODES,
  classifyRuntimeError,
  createClassifiedError,
};
