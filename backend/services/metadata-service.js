"use strict";

const {
  detectSiteKeyFromUrl,
  resolveDownloadConcurrency,
} = require("../config/download-config");
const { readJsonFile, writeJsonAtomic } = require("../utils/json-file");

const CACHE_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 250;

function createMetadataService({
  runYtDlpCommand,
  sendMessageToClient,
  pLimitFactory,
  cacheFilePath = null,
  fsModule = null,
  logger = require("../utils/logger").logger,
  initialConcurrency = {},
  ttlMs = DEFAULT_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
}) {
  const videoInfoCache = new Map();
  const pendingVideoInfoRequests = new Map();

  let cachePersistTimer = null;
  let limitFactory = pLimitFactory;
  let concurrency = resolveDownloadConcurrency(initialConcurrency);
  let singlePrefetchLimit = limitFactory
    ? limitFactory(concurrency.metadataSingles)
    : null;
  let playlistPrefetchLimit = limitFactory
    ? limitFactory(concurrency.metadataPlaylists)
    : null;

  async function loadCache() {
    if (!cacheFilePath) {
      return;
    }

    try {
      const raw = await readJsonFile(cacheFilePath, null);
      if (!raw || raw.version !== CACHE_VERSION || !Array.isArray(raw.entries)) {
        return;
      }

      const now = Date.now();
      for (const entry of raw.entries) {
        if (
          !entry ||
          typeof entry.url !== "string" ||
          !entry.data ||
          typeof entry.timestamp !== "number"
        ) {
          continue;
        }

        if (now - entry.timestamp >= ttlMs) {
          continue;
        }

        videoInfoCache.set(entry.url, {
          data: entry.data,
          timestamp: entry.timestamp,
        });
      }
    } catch (error) {
      logger.error("[MetadataService] Failed to load metadata cache:", error);
    }
  }

  function scheduleCachePersist() {
    if (!cacheFilePath) {
      return;
    }

    clearTimeout(cachePersistTimer);
    cachePersistTimer = setTimeout(async () => {
      try {
        const entries = Array.from(videoInfoCache.entries()).map(
          ([url, value]) => ({
            url,
            timestamp: value.timestamp,
            data: value.data,
          }),
        );
        await writeJsonAtomic(cacheFilePath, {
          version: CACHE_VERSION,
          entries,
        });
      } catch (error) {
        logger.error(
          "[MetadataService] Failed to persist metadata cache:",
          error,
        );
      }
    }, 100);
  }

  const ready = loadCache();

  function configureConcurrency(overrides = {}) {
    concurrency = resolveDownloadConcurrency(
      {
        ...concurrency,
        ...overrides,
      },
      concurrency,
    );

    if (limitFactory) {
      singlePrefetchLimit = limitFactory(concurrency.metadataSingles);
      playlistPrefetchLimit = limitFactory(concurrency.metadataPlaylists);
    }

    return concurrency;
  }

  function setLimitFactory(nextFactory) {
    limitFactory = nextFactory;
    configureConcurrency();
  }

  function getConcurrency() {
    return { ...concurrency };
  }

  function getCachedVideoInfo(videoUrl) {
    const cacheKey = videoUrl;
    const cached = videoInfoCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp >= ttlMs) {
      videoInfoCache.delete(cacheKey);
      scheduleCachePersist();
      return null;
    }

    return cached.data;
  }

  async function getVideoInfo(clientId, videoUrl, itemId) {
    await ready;

    const cacheKey = videoUrl;
    const cached = getCachedVideoInfo(cacheKey);
    if (cached) {
      logger.log(`[${itemId}] 📦 Using cached video info for ${cacheKey}`);
      return cached;
    }

    const pendingRequest = pendingVideoInfoRequests.get(cacheKey);
    if (pendingRequest) {
      logger.log(
        `[${itemId}] ⏳ Waiting for in-flight video info for ${cacheKey}`,
      );
      return pendingRequest;
    }

    const requestPromise = (async () => {
      try {
        const { stdout } = await runYtDlpCommand(
          clientId,
          ["--no-playlist", "--skip-download", "--print-json", videoUrl],
          `info_${itemId}`,
          true,
        );
        const info = JSON.parse(stdout.trim());
        const uploader =
          info.uploader || info.channel || info.creator || info.artist || null;
        const result = {
          availableQualities: extractAvailableQualities(info.formats),
          siteKey: detectSiteKeyFromUrl(videoUrl, info.extractor_key || null),
          creator: info.creator || uploader,
          channel: info.channel || null,
          thumbnail: info.thumbnail || null,
          title: info.title || "video",
          uploadDate: info.upload_date || null,
          uploader,
        };

        videoInfoCache.set(cacheKey, { data: result, timestamp: Date.now() });
        pruneCache();
        scheduleCachePersist();
        return result;
      } catch (error) {
        logger.error(
          `[${itemId}] getVideoInfo Error for ${videoUrl}: ${error.message}`,
        );
        sendMessageToClient(clientId, {
          type: "status",
          message:
            "Could not fetch detailed video info, proceeding with defaults.",
          itemId,
        });
        return {
          availableQualities: [],
          creator: null,
          channel: null,
          siteKey: detectSiteKeyFromUrl(videoUrl),
          thumbnail: null,
          title: "video",
          uploadDate: null,
          uploader: null,
        };
      } finally {
        pendingVideoInfoRequests.delete(cacheKey);
      }
    })();

    pendingVideoInfoRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  function pruneCache() {
    const now = Date.now();
    for (const [key, value] of videoInfoCache.entries()) {
      if (now - value.timestamp > ttlMs) {
        videoInfoCache.delete(key);
      }
    }

    if (videoInfoCache.size <= maxCacheEntries) {
      return;
    }

    const oldestEntries = Array.from(videoInfoCache.entries()).sort(
      (left, right) => left[1].timestamp - right[1].timestamp,
    );
    while (videoInfoCache.size > maxCacheEntries && oldestEntries.length > 0) {
      const [key] = oldestEntries.shift();
      videoInfoCache.delete(key);
    }
  }

  function schedulePrefetch(kind, itemId, task) {
    const limit =
      kind === "playlist" ? playlistPrefetchLimit : singlePrefetchLimit;
    if (!limit) {
      logger.log(
        `[${itemId}] Metadata prefetch limiter not ready, skipping eager metadata fetch.`,
      );
      return;
    }

    limit(task).catch((error) => {
      logger.log(
        `[${itemId}] Failed to schedule ${kind} metadata: ${error.message}`,
      );
    });
  }

  function scheduleSinglePrefetch(itemId, task) {
    schedulePrefetch("single", itemId, task);
  }

  function schedulePlaylistPrefetch(itemId, task) {
    schedulePrefetch("playlist", itemId, task);
  }

  function extractAvailableQualities(formats) {
    if (!Array.isArray(formats)) {
      return [];
    }

    const qualities = new Set();
    for (const format of formats) {
      if (format.height && format.height >= 240) {
        qualities.add(format.height);
      }
    }

    return Array.from(qualities).sort((a, b) => b - a);
  }

  return {
    configureConcurrency,
    getConcurrency,
    getCachedVideoInfo,
    getVideoInfo,
    loadPersistedCache: () => ready,
    ready,
    scheduleSinglePrefetch,
    schedulePlaylistPrefetch,
    setLimitFactory,
    extractAvailableQualities,
  };
}

module.exports = {
  createMetadataService,
};
