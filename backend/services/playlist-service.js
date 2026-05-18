"use strict";

const {
  detectSiteKeyFromUrl,
  getSiteDownloadProfile,
} = require("../config/download-config");
const { readJsonFile, writeJsonAtomic } = require("../utils/json-file");

const CACHE_VERSION = 1;

function createPlaylistService({
  runYtDlpCommand,
  sendMessageToClient,
  cacheFilePath = null,
  logger = require("../utils/logger").logger,
}) {
  const playlistContextCache = new Map();
  const playlistProbeCache = new Map();
  const pendingPlaylistContext = new Map();
  const pendingPlaylistProbe = new Map();
  let persistTimer = null;

  function getPlaylistTtl(playlistUrl) {
    const siteKey = detectSiteKeyFromUrl(playlistUrl);
    const profile = getSiteDownloadProfile(siteKey);
    return profile.playlistCacheTtlMs;
  }

  async function loadCache() {
    if (!cacheFilePath) {
      return;
    }

    try {
      const raw = await readJsonFile(cacheFilePath, null);
      if (!raw || raw.version !== CACHE_VERSION) {
        return;
      }

      const now = Date.now();
      for (const entry of raw.contexts || []) {
        if (!entry?.url || !entry?.value || typeof entry.timestamp !== "number") {
          continue;
        }

        if (now - entry.timestamp < getPlaylistTtl(entry.url)) {
          playlistContextCache.set(entry.url, {
            timestamp: entry.timestamp,
            value: entry.value,
          });
        }
      }

      for (const entry of raw.probes || []) {
        if (!entry?.url || !entry?.value || typeof entry.timestamp !== "number") {
          continue;
        }

        if (now - entry.timestamp < getPlaylistTtl(entry.url)) {
          playlistProbeCache.set(entry.url, {
            timestamp: entry.timestamp,
            value: entry.value,
          });
        }
      }
    } catch (error) {
      logger.error("[PlaylistService] Failed to load cache:", error);
    }
  }

  function schedulePersist() {
    if (!cacheFilePath) {
      return;
    }

    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      try {
        await writeJsonAtomic(cacheFilePath, {
          version: CACHE_VERSION,
          contexts: Array.from(playlistContextCache.entries()).map(
            ([url, entry]) => ({
              url,
              timestamp: entry.timestamp,
              value: entry.value,
            }),
          ),
          probes: Array.from(playlistProbeCache.entries()).map(
            ([url, entry]) => ({
              url,
              timestamp: entry.timestamp,
              value: entry.value,
            }),
          ),
        });
      } catch (error) {
        logger.error("[PlaylistService] Failed to persist cache:", error);
      }
    }, 100);
  }

  const ready = loadCache();

  function getCachedContext(playlistUrl) {
    const cached = playlistContextCache.get(playlistUrl);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp >= getPlaylistTtl(playlistUrl)) {
      playlistContextCache.delete(playlistUrl);
      schedulePersist();
      return null;
    }

    return cached.value;
  }

  function getCachedProbe(playlistUrl) {
    const cached = playlistProbeCache.get(playlistUrl);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.timestamp >= getPlaylistTtl(playlistUrl)) {
      playlistProbeCache.delete(playlistUrl);
      schedulePersist();
      return null;
    }

    return cached.value;
  }

  async function probeCollection(clientId, playlistUrl, playlistMetaId) {
    await ready;

    const cached = getCachedProbe(playlistUrl);
    if (cached) {
      return cached;
    }

    const pending = pendingPlaylistProbe.get(playlistUrl);
    if (pending) {
      return pending;
    }

    const requestPromise = (async () => {
      try {
        const { stdout } = await runYtDlpCommand(
          clientId,
          ["--flat-playlist", "--playlist-items", "1", "--dump-single-json", playlistUrl],
          `playlist_probe_${playlistMetaId}`,
          true,
        );
        const info = JSON.parse(stdout.trim());
        const value = {
          isPlaylist:
            info?._type === "playlist" ||
            (Array.isArray(info?.entries) && info.entries.length > 0),
          playlistTitle:
            info?.playlist_title || info?.title || info?.channel || null,
          siteKey: detectSiteKeyFromUrl(
            playlistUrl,
            info?.extractor_key || info?.extractor || null,
          ),
        };

        playlistProbeCache.set(playlistUrl, {
          timestamp: Date.now(),
          value,
        });
        schedulePersist();
        return value;
      } catch (error) {
        logger.error(
          `[${playlistMetaId}] Error probing playlist content: ${error.message}`,
        );
        const fallback = {
          isPlaylist: false,
          playlistTitle: null,
          siteKey: detectSiteKeyFromUrl(playlistUrl),
        };
        playlistProbeCache.set(playlistUrl, {
          timestamp: Date.now(),
          value: fallback,
        });
        schedulePersist();
        return fallback;
      } finally {
        pendingPlaylistProbe.delete(playlistUrl);
      }
    })();

    pendingPlaylistProbe.set(playlistUrl, requestPromise);
    return requestPromise;
  }

  async function fetchFreshPlaylistContext(clientId, playlistUrl, playlistMetaId) {
    const itemsArgs = [
      "--flat-playlist",
      "--print",
      "%(id)s\t%(title)s",
      playlistUrl,
    ];
    const titleArgs = ["--flat-playlist", "--print", "%(playlist_title)s", playlistUrl];

    const [itemsResult, titleResult] = await Promise.all([
      runYtDlpCommand(
        clientId,
        itemsArgs,
        `playlist_info_${playlistMetaId}`,
        true,
      ),
      runYtDlpCommand(
        clientId,
        titleArgs,
        `playlist_title_${playlistMetaId}`,
        true,
      ),
    ]);

    const lines = itemsResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "" && line.includes("\t"));
    const items = lines.map((line) => {
      const parts = line.split("\t");
      return {
        id: parts[0],
        title: parts[1] || "Untitled Video",
      };
    });

    if (
      items.length === 0 &&
      itemsResult.stdout.trim() !== "" &&
      !itemsResult.stdout.toLowerCase().includes("error")
    ) {
      sendMessageToClient(clientId, {
        type: "status",
        itemId: playlistMetaId,
        message:
          "Playlist seems empty or contains no downloadable video items.",
      });
    }

    return {
      items,
      siteKey: detectSiteKeyFromUrl(playlistUrl),
      title: titleResult.stdout.trim().split("\n")[0] || null,
    };
  }

  async function fetchPlaylistContext(clientId, playlistUrl, playlistMetaId) {
    await ready;

    const cached = getCachedContext(playlistUrl);
    if (cached) {
      return cached;
    }

    const pending = pendingPlaylistContext.get(playlistUrl);
    if (pending) {
      return pending;
    }

    const requestPromise = (async () => {
      try {
        const context = await fetchFreshPlaylistContext(
          clientId,
          playlistUrl,
          playlistMetaId,
        );
        playlistContextCache.set(playlistUrl, {
          timestamp: Date.now(),
          value: context,
        });
        playlistProbeCache.set(playlistUrl, {
          timestamp: Date.now(),
          value: {
            isPlaylist: context.items.length > 0,
            playlistTitle: context.title,
            siteKey: context.siteKey,
          },
        });
        schedulePersist();
        return context;
      } catch (error) {
        logger.error(
          `[${playlistMetaId}] Error fetching playlist context: ${error.message}`,
        );
        sendMessageToClient(clientId, {
          type: "error",
          message: `Failed to get playlist items: ${error.message.substring(0, 100)}`,
          itemId: playlistMetaId,
        });
        throw error;
      } finally {
        pendingPlaylistContext.delete(playlistUrl);
      }
    })();

    pendingPlaylistContext.set(playlistUrl, requestPromise);
    return requestPromise;
  }

  async function getPlaylistItems(clientId, playlistUrl, playlistMetaId) {
    const context = await fetchPlaylistContext(clientId, playlistUrl, playlistMetaId);
    return context.items;
  }

  async function getPlaylistTitle(clientId, playlistUrl, playlistMetaId) {
    const context = await fetchPlaylistContext(clientId, playlistUrl, playlistMetaId);
    return context.title;
  }

  return {
    fetchPlaylistContext,
    getPlaylistItems,
    getPlaylistTitle,
    probeCollection,
    ready,
  };
}

module.exports = {
  createPlaylistService,
};
