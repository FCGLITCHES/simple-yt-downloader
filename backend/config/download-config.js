"use strict";

const DEFAULT_DOWNLOAD_CONCURRENCY = Object.freeze({
  singleDownloads: 1,
  playlistDownloads: 3,
  metadataSingles: 2,
  metadataPlaylists: 2,
});

const SITE_DOWNLOAD_PROFILES = Object.freeze({
  generic: Object.freeze({
    ...DEFAULT_DOWNLOAD_CONCURRENCY,
    backoffBaseMs: 1000,
    backoffJitterMs: 250,
    backoffMaxMs: 6000,
    circuitBreakerCooldownMs: 0,
    circuitBreakerFailureThreshold: Number.MAX_SAFE_INTEGER,
    cookieBurstThreshold: 0,
    metadataCacheTtlMs: 10 * 60 * 1000,
    playlistCacheTtlMs: 10 * 60 * 1000,
    prefetchVisiblePlaylistItems: 6,
  }),
  instagram: Object.freeze({
    singleDownloads: 2,
    playlistDownloads: 2,
    metadataSingles: 2,
    metadataPlaylists: 1,
    backoffBaseMs: 1000,
    backoffJitterMs: 250,
    backoffMaxMs: 6000,
    circuitBreakerCooldownMs: 0,
    circuitBreakerFailureThreshold: Number.MAX_SAFE_INTEGER,
    cookieBurstThreshold: 0,
    metadataCacheTtlMs: 10 * 60 * 1000,
    playlistCacheTtlMs: 10 * 60 * 1000,
    prefetchVisiblePlaylistItems: 4,
  }),
  youtube: Object.freeze({
    singleDownloads: 1,
    playlistDownloads: 2,
    metadataSingles: 1,
    metadataPlaylists: 1,
    backoffBaseMs: 1500,
    backoffJitterMs: 1200,
    backoffMaxMs: 20000,
    circuitBreakerCooldownMs: 2 * 60 * 1000,
    circuitBreakerFailureThreshold: 3,
    cookieBurstThreshold: 8,
    metadataCacheTtlMs: 15 * 60 * 1000,
    playlistCacheTtlMs: 15 * 60 * 1000,
    prefetchVisiblePlaylistItems: 4,
  }),
});

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function detectSiteKeyFromUrl(videoUrl = "", explicitSource = "") {
  const source = String(explicitSource || "").trim().toLowerCase();
  if (SITE_DOWNLOAD_PROFILES[source]) {
    return source;
  }

  const normalizedUrl = String(videoUrl || "").toLowerCase();
  if (
    normalizedUrl.includes("youtube.com") ||
    normalizedUrl.includes("youtu.be") ||
    normalizedUrl.includes("youtube-nocookie.com")
  ) {
    return "youtube";
  }

  if (normalizedUrl.includes("instagram.com")) {
    return "instagram";
  }

  return "generic";
}

function getSiteDownloadProfile(siteKey = "generic") {
  return SITE_DOWNLOAD_PROFILES[siteKey] || SITE_DOWNLOAD_PROFILES.generic;
}

function resolveDownloadConcurrency(overrides = {}, baseProfile = null) {
  const base = baseProfile || DEFAULT_DOWNLOAD_CONCURRENCY;
  return {
    singleDownloads: toPositiveInt(
      overrides.singleDownloads,
      base.singleDownloads,
    ),
    playlistDownloads: toPositiveInt(
      overrides.playlistDownloads,
      base.playlistDownloads,
    ),
    metadataSingles: toPositiveInt(
      overrides.metadataSingles,
      base.metadataSingles,
    ),
    metadataPlaylists: toPositiveInt(
      overrides.metadataPlaylists,
      base.metadataPlaylists,
    ),
  };
}

function resolveSiteConcurrency({
  videoUrl = "",
  source = "",
  overrides = {},
  adaptiveConcurrency = null,
} = {}) {
  const siteKey = detectSiteKeyFromUrl(videoUrl, source);
  const profile = getSiteDownloadProfile(siteKey);
  const requested = resolveDownloadConcurrency(overrides, profile);
  const effective = adaptiveConcurrency
    ? resolveDownloadConcurrency(adaptiveConcurrency, requested)
    : requested;

  return {
    siteKey,
    profile,
    concurrency: effective,
    prefetchVisiblePlaylistItems: toPositiveInt(
      overrides.prefetchVisiblePlaylistItems,
      profile.prefetchVisiblePlaylistItems,
    ),
    cookieBurstThreshold: toPositiveInt(
      overrides.cookieBurstThreshold,
      profile.cookieBurstThreshold,
    ),
  };
}

module.exports = {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  SITE_DOWNLOAD_PROFILES,
  detectSiteKeyFromUrl,
  getSiteDownloadProfile,
  resolveDownloadConcurrency,
  resolveSiteConcurrency,
  toPositiveInt,
};
