"use strict";

const fs = require("fs");

function createDownloadState({
  pausedJobsFile,
  logger = require("../utils/logger").logger,
} = {}) {
  const state = {
    clients: new Map(),
    activeProcesses: new Map(),
    downloadQueue: new Map(),
    pausedDownloads: new Map(),
    clientAutoUpdateSettings: new Map(),
  };

  async function loadPausedJobs() {
    if (!pausedJobsFile) {
      return;
    }

    try {
      let exists;
      try {
        await fs.promises.access(pausedJobsFile);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists) {
        return;
      }

      const data = JSON.parse(
        await fs.promises.readFile(pausedJobsFile, "utf8"),
      );
      if (!data || typeof data !== "object") {
        return;
      }

      for (const [itemId, jobData] of Object.entries(data)) {
        state.pausedDownloads.set(itemId, jobData);
      }

      logger.log(
        `[PausedJobs] Loaded ${state.pausedDownloads.size} paused jobs from disk`,
      );
    } catch (error) {
      logger.error("[PausedJobs] Error loading paused jobs:", error);
    }
  }

  async function savePausedJobs() {
    if (!pausedJobsFile) {
      return;
    }

    try {
      const data = {};
      for (const [itemId, jobData] of state.pausedDownloads.entries()) {
        data[itemId] = jobData;
      }

      await fs.promises.writeFile(
        pausedJobsFile,
        JSON.stringify(data, null, 2),
      );
      logger.log(
        `[PausedJobs] Saved ${state.pausedDownloads.size} paused jobs to disk`,
      );
    } catch (error) {
      logger.error("[PausedJobs] Error saving paused jobs:", error);
    }
  }

  return {
    ...state,
    loadPausedJobs,
    savePausedJobs,
  };
}

module.exports = {
  createDownloadState,
};
