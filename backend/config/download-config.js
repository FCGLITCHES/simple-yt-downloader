'use strict';

const DEFAULT_DOWNLOAD_CONCURRENCY = Object.freeze({
    singleDownloads: 1,
    playlistDownloads: 3,
    metadataSingles: 2,
    metadataPlaylists: 2
});

function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return parsed;
}

function resolveDownloadConcurrency(overrides = {}) {
    return {
        singleDownloads: toPositiveInt(overrides.singleDownloads, DEFAULT_DOWNLOAD_CONCURRENCY.singleDownloads),
        playlistDownloads: toPositiveInt(overrides.playlistDownloads, DEFAULT_DOWNLOAD_CONCURRENCY.playlistDownloads),
        metadataSingles: toPositiveInt(overrides.metadataSingles, DEFAULT_DOWNLOAD_CONCURRENCY.metadataSingles),
        metadataPlaylists: toPositiveInt(overrides.metadataPlaylists, DEFAULT_DOWNLOAD_CONCURRENCY.metadataPlaylists)
    };
}

module.exports = {
    DEFAULT_DOWNLOAD_CONCURRENCY,
    resolveDownloadConcurrency,
    toPositiveInt
};
