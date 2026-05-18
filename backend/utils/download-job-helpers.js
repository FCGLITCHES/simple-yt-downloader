"use strict";

const path = require("path");

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
    return parsed.hostname.replace(/^www\./i, "").toLowerCase() || "unknown-site";
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
    typeof videoInfo.uploadDate === "string" && videoInfo.uploadDate.length === 8
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
  if (organizeMode === "site-creator-date") return [siteKey, creator, dateFolder];
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
  return Math.round(baseDelayMs * 2 ** (cappedAttempt - 1) + failureFactor * 3000);
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
  ensureOrganizedTargetDir,
  formatDateFolder,
  getAutoOrganizeSegments,
  getSiteKeyFromUrl,
  isRetryableDownloadError,
  sanitizePathSegment,
  shouldSmartRetry,
};
