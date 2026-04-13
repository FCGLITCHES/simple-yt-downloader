"use strict";

const { resolveDownloadConcurrency } = require("../config/download-config");

function createMetadataService({
  runYtDlpCommand,
  sendMessageToClient,
  pLimitFactory,
  logger = require("../utils/logger").logger,
  initialConcurrency = {},
}) {
  const videoInfoCache = new Map();
  const pendingVideoInfoRequests = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  let limitFactory = pLimitFactory;
  let concurrency = resolveDownloadConcurrency(initialConcurrency);
  let singlePrefetchLimit = limitFactory
    ? limitFactory(concurrency.metadataSingles)
    : null;
  let playlistPrefetchLimit = limitFactory
    ? limitFactory(concurrency.metadataPlaylists)
    : null;

  function configureConcurrency(overrides = {}) {
    concurrency = resolveDownloadConcurrency({
      ...concurrency,
      ...overrides,
    });

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

    if (Date.now() - cached.timestamp >= CACHE_TTL) {
      videoInfoCache.delete(cacheKey);
      return null;
    }

    return cached.data;
  }

  async function getVideoInfo(clientId, videoUrl, itemId) {
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
        const result = {
          title: info.title || "video",
          thumbnail: info.thumbnail || null,
          availableQualities: extractAvailableQualities(info.formats),
        };

        videoInfoCache.set(cacheKey, { data: result, timestamp: Date.now() });
        pruneCache();
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
        return { title: "video", thumbnail: null, availableQualities: [] };
      } finally {
        pendingVideoInfoRequests.delete(cacheKey);
      }
    })();

    pendingVideoInfoRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  function pruneCache() {
    if (videoInfoCache.size <= 100) {
      return;
    }

    const now = Date.now();
    for (const [key, value] of videoInfoCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        videoInfoCache.delete(key);
      }
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
    scheduleSinglePrefetch,
    schedulePlaylistPrefetch,
    setLimitFactory,
    extractAvailableQualities,
  };
}

module.exports = {
  createMetadataService,
};
