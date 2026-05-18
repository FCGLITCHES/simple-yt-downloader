"use strict";

const {
  detectSiteKeyFromUrl,
  getSiteDownloadProfile,
} = require("../config/download-config");

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createSiteRequestGuard({
  logger = require("../utils/logger").logger,
  now = () => Date.now(),
  sleep = wait,
} = {}) {
  const siteState = new Map();

  function ensureSiteState(siteKey) {
    if (!siteState.has(siteKey)) {
      siteState.set(siteKey, {
        adaptivePenalty: 0,
        backoffUntil: 0,
        circuitOpenUntil: 0,
        consecutiveThrottleFailures: 0,
      });
    }
    return siteState.get(siteKey);
  }

  function getSiteHealth(siteKey) {
    const state = ensureSiteState(siteKey);
    return {
      adaptivePenalty: state.adaptivePenalty,
      backoffUntil: state.backoffUntil,
      circuitOpenUntil: state.circuitOpenUntil,
      consecutiveThrottleFailures: state.consecutiveThrottleFailures,
      isCircuitOpen: state.circuitOpenUntil > now(),
    };
  }

  function getAdaptiveConcurrency(siteKey, concurrency) {
    if (siteKey !== "youtube") {
      return { ...concurrency };
    }

    const state = ensureSiteState(siteKey);
    if (state.circuitOpenUntil > now()) {
      return {
        ...concurrency,
        singleDownloads: 1,
        playlistDownloads: 1,
        metadataSingles: 1,
        metadataPlaylists: 1,
      };
    }

    const clamp = (value) =>
      Math.max(1, value - Math.min(state.adaptivePenalty, value - 1));

    return {
      ...concurrency,
      singleDownloads: clamp(concurrency.singleDownloads),
      playlistDownloads: clamp(concurrency.playlistDownloads),
      metadataSingles: clamp(concurrency.metadataSingles),
      metadataPlaylists: clamp(concurrency.metadataPlaylists),
    };
  }

  function getOpenCircuitError(siteKey) {
    const state = ensureSiteState(siteKey);
    const retryInMs = Math.max(0, state.circuitOpenUntil - now());
    const error = new Error(
      `YT_CIRCUIT_OPEN: ${siteKey} protection active for ${Math.ceil(retryInMs / 1000)}s`,
    );
    error.classification = {
      category: "rate_limit",
      code: "CIRCUIT_OPEN",
      retryable: false,
      shouldBackoff: false,
      shouldOpenCircuit: false,
      userMessage:
        "YouTube rate-limit protection is active. Wait for the cooldown before retrying.",
    };
    return error;
  }

  function assertRequestAllowed(siteKey) {
    if (siteKey !== "youtube") {
      return;
    }

    const state = ensureSiteState(siteKey);
    if (state.circuitOpenUntil > now()) {
      throw getOpenCircuitError(siteKey);
    }
  }

  async function waitForBackoff(siteKey, itemId) {
    if (siteKey !== "youtube") {
      return;
    }

    const state = ensureSiteState(siteKey);
    const delayMs = Math.max(0, state.backoffUntil - now());
    if (delayMs <= 0) {
      return;
    }

    logger.info(
      `[${itemId}] Waiting ${delayMs}ms for ${siteKey} backoff before retrying.`,
    );
    await sleep(delayMs);
  }

  function recordSuccess(siteKey) {
    const state = ensureSiteState(siteKey);
    state.consecutiveThrottleFailures = 0;
    state.backoffUntil = 0;
    state.adaptivePenalty = Math.max(0, state.adaptivePenalty - 1);
    if (state.circuitOpenUntil <= now()) {
      state.circuitOpenUntil = 0;
    }
  }

  function recordFailure(siteKey, classification) {
    const profile = getSiteDownloadProfile(siteKey);
    const state = ensureSiteState(siteKey);

    if (!classification?.shouldBackoff || siteKey !== "youtube") {
      return {
        retryDelayMs: 0,
        openedCircuit: false,
      };
    }

    state.consecutiveThrottleFailures += 1;
    state.adaptivePenalty = Math.min(
      3,
      state.adaptivePenalty + 1,
    );

    const exponentialFactor = Math.max(0, state.consecutiveThrottleFailures - 1);
    const jitter = Math.floor(Math.random() * profile.backoffJitterMs);
    const retryDelayMs = Math.min(
      profile.backoffMaxMs,
      profile.backoffBaseMs * 2 ** exponentialFactor + jitter,
    );
    state.backoffUntil = now() + retryDelayMs;

    let openedCircuit = false;
    if (
      classification.shouldOpenCircuit &&
      state.consecutiveThrottleFailures >= profile.circuitBreakerFailureThreshold
    ) {
      state.circuitOpenUntil = now() + profile.circuitBreakerCooldownMs;
      openedCircuit = true;
    }

    return {
      retryDelayMs,
      openedCircuit,
      siteHealth: getSiteHealth(siteKey),
    };
  }

  function resolveSiteContext({ videoUrl, source, concurrency }) {
    const siteKey = detectSiteKeyFromUrl(videoUrl, source);
    return {
      siteKey,
      profile: getSiteDownloadProfile(siteKey),
      concurrency: getAdaptiveConcurrency(siteKey, concurrency),
    };
  }

  return {
    assertRequestAllowed,
    getAdaptiveConcurrency,
    getSiteHealth,
    recordFailure,
    recordSuccess,
    resolveSiteContext,
    waitForBackoff,
  };
}

module.exports = {
  createSiteRequestGuard,
};
