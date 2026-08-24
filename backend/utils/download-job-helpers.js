"use strict";

const path = require("path");

const VIDEO_QUALITY_HEIGHTS = Object.freeze({
  "8k": 4320,
  "4320p": 4320,
  "4k": 2160,
  "2160p": 2160,
  "2k": 1440,
  "1440p": 1440,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
  "240p": 240,
});

function normalizeVideoTargetHeight(quality, invalidFallback = null) {
  const normalizedQuality = String(quality || "")
    .toLowerCase()
    .trim();

  if (normalizedQuality === "highest" || normalizedQuality === "") {
    return 4320;
  }

  if (VIDEO_QUALITY_HEIGHTS[normalizedQuality]) {
    return VIDEO_QUALITY_HEIGHTS[normalizedQuality];
  }

  const parsedHeight = Number.parseInt(normalizedQuality, 10);
  if (
    Number.isFinite(parsedHeight) &&
    parsedHeight >= 144 &&
    parsedHeight <= 8640
  ) {
    return parsedHeight;
  }

  if (Number.isFinite(invalidFallback)) {
    return invalidFallback;
  }

  throw new RangeError(
    `Invalid quality value: "${quality}". Expected a resolution from 144p to 8640p or a preset such as 8K, 4K, 2K, or highest.`,
  );
}

function getHdrFormatSortKey(settings = {}) {
  return settings.preferHdr === true ? "hdr:12" : "+hdr";
}

function createTransferSpeedEstimator({
  smoothingAlpha = 0.2,
  spikeMultiplier = 2.5,
  sustainedSpikeSamples = 2,
  staleAfterMs = 2500,
} = {}) {
  let activeFilePath = null;
  let lastFileSize = 0;
  let lastObservedAt = null;
  let speedEma = null;
  let highSampleStreak = 0;

  function reset(filePath, fileSize, observedAt) {
    activeFilePath = filePath;
    lastFileSize = fileSize;
    lastObservedAt = observedAt;
    speedEma = null;
    highSampleStreak = 0;
  }

  function observe({ filePath, fileSize, observedAt = Date.now() }) {
    if (
      !filePath ||
      !Number.isFinite(fileSize) ||
      fileSize < 0 ||
      !Number.isFinite(observedAt)
    ) {
      return null;
    }

    if (
      activeFilePath !== filePath ||
      lastObservedAt === null ||
      observedAt <= lastObservedAt ||
      fileSize < lastFileSize
    ) {
      reset(filePath, fileSize, observedAt);
      return null;
    }

    const elapsedSeconds = (observedAt - lastObservedAt) / 1000;
    const bytesPerSecond = (fileSize - lastFileSize) / elapsedSeconds;
    lastFileSize = fileSize;
    lastObservedAt = observedAt;

    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) {
      return speedEma;
    }

    if (speedEma === null || speedEma === 0) {
      speedEma = bytesPerSecond;
      return speedEma;
    }

    if (bytesPerSecond > speedEma * spikeMultiplier) {
      highSampleStreak += 1;
      if (highSampleStreak < sustainedSpikeSamples) {
        return speedEma;
      }
    } else {
      highSampleStreak = 0;
    }

    speedEma =
      speedEma * (1 - smoothingAlpha) + bytesPerSecond * smoothingAlpha;
    highSampleStreak = 0;
    return speedEma;
  }

  function getSpeed({ now = Date.now(), fallbackSpeed = null } = {}) {
    if (
      speedEma === null ||
      lastObservedAt === null ||
      now - lastObservedAt > staleAfterMs
    ) {
      return fallbackSpeed;
    }

    if (
      Number.isFinite(fallbackSpeed) &&
      fallbackSpeed > 0 &&
      (speedEma <= 0 ||
        speedEma > fallbackSpeed * 8 ||
        fallbackSpeed > speedEma * 8)
    ) {
      return fallbackSpeed;
    }

    return speedEma;
  }

  return {
    getSpeed,
    observe,
  };
}

function sanitizePathSegment(value, fallback = "unknown") {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.substring(0, 120);
}

function getSiteKeyFromUrl(videoUrl) {
  try {
    const parsed = new URL(String(videoUrl || ""));
    return (
      parsed.hostname.replace(/^www\./i, "").toLowerCase() || "unknown-site"
    );
  } catch {
    return "unknown-site";
  }
}

function formatDateFolder(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "unknown-date";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCreatorLabel(videoInfo = {}) {
  return (
    videoInfo.creator ||
    videoInfo.uploader ||
    videoInfo.channel ||
    videoInfo.artist ||
    ""
  );
}

function getAutoOrganizeSegments({
  videoUrl,
  videoInfo = {},
  playlistTitle,
  isPlaylistItem,
  settings = {},
}) {
  const organizeMode = settings.autoOrganizeMode || "off";
  if (organizeMode === "off") {
    return [];
  }

  const siteKey = sanitizePathSegment(
    videoInfo.siteKey || videoInfo.extractorKey || getSiteKeyFromUrl(videoUrl),
    "site",
  );
  const creator = sanitizePathSegment(getCreatorLabel(videoInfo), "creator");
  const uploadDateFolder =
    typeof videoInfo.uploadDate === "string" &&
    videoInfo.uploadDate.length === 8
      ? formatDateFolder(
          `${videoInfo.uploadDate.slice(0, 4)}-${videoInfo.uploadDate.slice(
            4,
            6,
          )}-${videoInfo.uploadDate.slice(6, 8)}`,
        )
      : null;
  const dateFolder = sanitizePathSegment(
    videoInfo.dateFolder || uploadDateFolder || formatDateFolder(),
    "date",
  );
  const playlist = sanitizePathSegment(playlistTitle, "playlist");

  if (organizeMode === "site") return [siteKey];
  if (organizeMode === "creator") return [creator];
  if (organizeMode === "date") return [dateFolder];
  if (organizeMode === "site-date") return [siteKey, dateFolder];
  if (organizeMode === "creator-date") return [creator, dateFolder];
  if (organizeMode === "site-creator-date")
    return [siteKey, creator, dateFolder];
  if (organizeMode === "site-playlist") {
    return isPlaylistItem || playlistTitle ? [siteKey, playlist] : [siteKey];
  }
  if (organizeMode === "creator-playlist-date") {
    if (isPlaylistItem || playlistTitle) {
      return [creator, playlist, dateFolder];
    }
    return [creator, dateFolder];
  }

  return [];
}

async function ensureOrganizedTargetDir({
  fs,
  baseDir,
  videoUrl,
  videoInfo,
  playlistTitle,
  isPlaylistItem,
  settings,
}) {
  const segments = getAutoOrganizeSegments({
    videoUrl,
    videoInfo,
    playlistTitle,
    isPlaylistItem,
    settings,
  });

  if (segments.length === 0) {
    return baseDir;
  }

  const organizedDir = path.join(baseDir, ...segments);
  await fs.promises.mkdir(organizedDir, { recursive: true });
  return organizedDir;
}

function buildSubtitleArgs(settings = {}, containerFormat = "") {
  const subtitleMode = settings.subtitleMode || "none";
  const subtitleLanguages =
    String(settings.subtitleLanguages || "").trim() || "en.*,en";
  const includeAutoCaptions = settings.includeAutoCaptions === true;

  if (subtitleMode === "none") {
    return [];
  }

  const args = ["--write-subs", "--sub-langs", subtitleLanguages];
  if (includeAutoCaptions) {
    args.push("--write-auto-subs");
  }

  const normalizedContainer = String(containerFormat || "").toLowerCase();
  if (
    subtitleMode === "embed" &&
    ["mp4", "mkv", "webm"].includes(normalizedContainer)
  ) {
    args.push("--embed-subs");
  }

  return args;
}

function isRetryableDownloadError(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("timed out") ||
    normalized.includes("network error") ||
    normalized.includes("did not get any data blocks") ||
    normalized.includes("try again later") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("connection reset") ||
    normalized.includes("remote end closed connection")
  );
}

function computeSiteRetryDelayMs({ siteKey, attempt = 1, siteFailures = 0 }) {
  const normalizedSite = String(siteKey || "").toLowerCase();
  const baseDelayMs = normalizedSite.includes("youtube") ? 12000 : 7000;
  const cappedAttempt = Math.max(1, Math.min(Number(attempt) || 1, 6));
  const failureFactor = Math.max(0, Math.min(Number(siteFailures) || 0, 4));
  return Math.round(
    baseDelayMs * 2 ** (cappedAttempt - 1) + failureFactor * 3000,
  );
}

function shouldSmartRetry({
  message,
  attempt = 0,
  maxAttempts = 3,
  smartRetryEnabled = true,
}) {
  if (!smartRetryEnabled) {
    return false;
  }

  if (attempt >= maxAttempts) {
    return false;
  }

  return isRetryableDownloadError(message);
}

module.exports = {
  buildSubtitleArgs,
  computeSiteRetryDelayMs,
  createTransferSpeedEstimator,
  ensureOrganizedTargetDir,
  formatDateFolder,
  getAutoOrganizeSegments,
  getHdrFormatSortKey,
  getSiteKeyFromUrl,
  isRetryableDownloadError,
  normalizeVideoTargetHeight,
  sanitizePathSegment,
  shouldSmartRetry,
};
