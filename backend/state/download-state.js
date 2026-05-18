"use strict";

const path = require("path");
const { readJsonFile, writeJsonAtomic } = require("../utils/json-file");

const DOWNLOAD_STATE_VERSION = 1;

function cloneSerializable(value) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return null;
  }
}

function createPersistentMap(onChange) {
  const map = new Map();
  const originalSet = map.set.bind(map);
  const originalDelete = map.delete.bind(map);
  const originalClear = map.clear.bind(map);

  map.set = (key, value) => {
    const result = originalSet(key, value);
    onChange();
    return result;
  };

  map.delete = (key) => {
    const result = originalDelete(key);
    if (result) {
      onChange();
    }
    return result;
  };

  map.clear = () => {
    if (map.size > 0) {
      originalClear();
      onChange();
    }
  };

  return map;
}

function createDownloadState({
  pausedJobsFile,
  scheduledJobsFile = null,
  failedJobsFile = null,
  stateFile = path.join(
    path.dirname(pausedJobsFile || process.cwd()),
    "data",
    "download-state.json",
  ),
  logger = require("../utils/logger").logger,
} = {}) {
  let suppressPersist = false;
  let persistPromise = Promise.resolve();
  let persistTimer = null;

  function schedulePersist() {
    if (suppressPersist) {
      return;
    }

    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistPromise = saveRuntimeState();
    }, 75);
  }

  const state = {
    clients: new Map(),
    activeProcesses: createPersistentMap(schedulePersist),
    downloadQueue: createPersistentMap(schedulePersist),
    failedDownloads: createPersistentMap(schedulePersist),
    pausedDownloads: createPersistentMap(schedulePersist),
    scheduledDownloads: createPersistentMap(schedulePersist),
    clientAutoUpdateSettings: new Map(),
  };

  function serializeQueueItem(itemId, value) {
    return {
      itemId,
      value: cloneSerializable(value),
    };
  }

  function serializePausedItem(itemId, value) {
    return {
      itemId,
      value: cloneSerializable(value),
    };
  }

  function serializeActiveItem(itemId, value) {
    return {
      itemId,
      value: {
        cancelled: value?.cancelled === true,
        format: value?.format || value?.itemData?.format || null,
        itemData: cloneSerializable(value?.itemData),
        outputTemplate: value?.outputTemplate || value?.itemData?.outputTemplate || null,
        paused: value?.paused === true,
        pausedByUser: value?.pausedByUser === true,
        quality: value?.quality || value?.itemData?.quality || null,
        settings: cloneSerializable(value?.settings || value?.itemData?.settings),
        source: value?.source || value?.itemData?.source || null,
        thumbnail: value?.thumbnail || null,
        title: value?.title || value?.itemData?.title || "Interrupted download",
        videoUrl: value?.videoUrl || value?.itemData?.videoUrl || null,
      },
    };
  }

  function buildSnapshot() {
    return {
      updatedAt: new Date().toISOString(),
      version: DOWNLOAD_STATE_VERSION,
      activeProcesses: Array.from(state.activeProcesses.entries()).map(
        ([itemId, value]) => serializeActiveItem(itemId, value),
      ),
      downloadQueue: Array.from(state.downloadQueue.entries()).map(([itemId, value]) =>
        serializeQueueItem(itemId, value),
      ),
      failedDownloads: Array.from(state.failedDownloads.entries()).map(([itemId, value]) =>
        serializeQueueItem(itemId, value),
      ),
      pausedDownloads: Array.from(state.pausedDownloads.entries()).map(
        ([itemId, value]) => serializePausedItem(itemId, value),
      ),
      scheduledDownloads: Array.from(state.scheduledDownloads.entries()).map(
        ([itemId, value]) => serializeQueueItem(itemId, value),
      ),
    };
  }

  function restoreInterruptedActiveEntry(itemId, entry) {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const itemData = {
      ...(entry.itemData || {}),
      clientId: entry.itemData?.clientId || "default",
      format: entry.itemData?.format || entry.format || null,
      outputTemplate:
        entry.itemData?.outputTemplate || entry.outputTemplate || null,
      quality: entry.itemData?.quality || entry.quality || null,
      resumed: true,
      settings: entry.itemData?.settings || entry.settings || {},
      source: entry.itemData?.source || entry.source || "youtube",
      title: entry.itemData?.title || entry.title || "Interrupted download",
      videoUrl: entry.itemData?.videoUrl || entry.videoUrl || null,
    };

    state.pausedDownloads.set(itemId, {
      ...itemData,
      interrupted: true,
      pausedAt: Date.now(),
      resumeAttempts: 0,
      title: itemData.title || "Interrupted download",
    });
  }

  async function savePausedJobs() {
    if (!pausedJobsFile) {
      return;
    }

    const pausedJobs = {};
    for (const [itemId, jobData] of state.pausedDownloads.entries()) {
      pausedJobs[itemId] = cloneSerializable(jobData);
    }

    try {
      await writeJsonAtomic(pausedJobsFile, pausedJobs);
      logger.log(
        `[PausedJobs] Saved ${state.pausedDownloads.size} paused jobs to disk`,
      );
    } catch (error) {
      logger.error("[PausedJobs] Error saving paused jobs:", error);
    }
  }

  async function saveNamedMap(filePath, map, label) {
    if (!filePath) {
      return;
    }

    const payload = {};
    for (const [itemId, jobData] of map.entries()) {
      payload[itemId] = cloneSerializable(jobData);
    }

    try {
      await writeJsonAtomic(filePath, payload);
      logger.log(`[${label}] Saved ${map.size} entries to disk`);
    } catch (error) {
      logger.error(`[${label}] Error saving entries:`, error);
    }
  }

  async function saveScheduledJobs() {
    await saveNamedMap(
      scheduledJobsFile,
      state.scheduledDownloads,
      "ScheduledJobs",
    );
  }

  async function saveFailedJobs() {
    await saveNamedMap(failedJobsFile, state.failedDownloads, "FailedJobs");
  }

  async function saveRuntimeState() {
    if (!stateFile) {
      await savePausedJobs();
      await saveScheduledJobs();
      await saveFailedJobs();
      return;
    }

    const snapshot = buildSnapshot();

    try {
      await writeJsonAtomic(stateFile, snapshot);
      await savePausedJobs();
      await saveScheduledJobs();
      await saveFailedJobs();
    } catch (error) {
      logger.error("[DownloadState] Error saving runtime state:", error);
    }
  }

  async function loadLegacyNamedMap(filePath, map) {
    const legacyData = await readJsonFile(filePath, {});
    if (!legacyData || typeof legacyData !== "object") {
      return;
    }

    for (const [itemId, jobData] of Object.entries(legacyData)) {
      if (!map.has(itemId)) {
        map.set(itemId, jobData);
      }
    }
  }

  async function loadLegacyPausedJobs() {
    await loadLegacyNamedMap(pausedJobsFile, state.pausedDownloads);
  }

  async function loadScheduledJobs() {
    suppressPersist = true;
    try {
      await loadLegacyNamedMap(scheduledJobsFile, state.scheduledDownloads);
    } finally {
      suppressPersist = false;
    }
  }

  async function loadFailedJobs() {
    suppressPersist = true;
    try {
      await loadLegacyNamedMap(failedJobsFile, state.failedDownloads);
    } finally {
      suppressPersist = false;
    }
  }

  async function loadPausedJobs() {
    suppressPersist = true;
    try {
      const runtimeState = await readJsonFile(stateFile, null);
      if (
        runtimeState &&
        typeof runtimeState === "object" &&
        runtimeState.version === DOWNLOAD_STATE_VERSION
      ) {
        for (const entry of runtimeState.downloadQueue || []) {
          if (entry?.itemId) {
            state.downloadQueue.set(entry.itemId, entry.value || {});
          }
        }

        for (const entry of runtimeState.pausedDownloads || []) {
          if (entry?.itemId) {
            state.pausedDownloads.set(entry.itemId, entry.value || {});
          }
        }

        for (const entry of runtimeState.scheduledDownloads || []) {
          if (entry?.itemId) {
            state.scheduledDownloads.set(entry.itemId, entry.value || {});
          }
        }

        for (const entry of runtimeState.failedDownloads || []) {
          if (entry?.itemId) {
            state.failedDownloads.set(entry.itemId, entry.value || {});
          }
        }

        for (const entry of runtimeState.activeProcesses || []) {
          if (entry?.itemId) {
            restoreInterruptedActiveEntry(entry.itemId, entry.value || {});
          }
        }
      }

      await loadLegacyPausedJobs();
      await loadLegacyNamedMap(scheduledJobsFile, state.scheduledDownloads);
      await loadLegacyNamedMap(failedJobsFile, state.failedDownloads);

      logger.log(
        `[DownloadState] Restored ${state.downloadQueue.size} queued, ${state.pausedDownloads.size} paused, ${state.scheduledDownloads.size} scheduled, ${state.failedDownloads.size} failed downloads`,
      );
    } catch (error) {
      logger.error("[DownloadState] Error loading persisted state:", error);
    } finally {
      suppressPersist = false;
    }
  }

  function markDirty() {
    schedulePersist();
  }

  return {
    ...state,
    loadFailedJobs,
    loadPausedJobs,
    loadScheduledJobs,
    markDirty,
    saveFailedJobs,
    savePausedJobs,
    saveScheduledJobs,
    saveRuntimeState,
    waitForPersistence: () => persistPromise,
  };
}

module.exports = {
  createDownloadState,
};
