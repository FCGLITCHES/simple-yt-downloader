"use strict";

require("dotenv").config();

// Set UTF-8 encoding for proper Unicode support (Arabic, etc.)
process.env.PYTHONIOENCODING = "utf-8";
if (process.platform === "win32") process.env.LANG = "en_US.UTF-8";

const { logger } = require("./backend/utils/logger");
const express = require("express");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const url = require("url");
const os = require("os");
const { promisify } = require("util");
const AdmZip = require("adm-zip");
const globAsync = promisify(require("glob"));
const { loadEnv } = require("./backend/config/env");
const {
  detectSiteKeyFromUrl,
  getSiteDownloadProfile,
  resolveDownloadConcurrency,
  resolveSiteConcurrency,
} = require("./backend/config/download-config");
const { createDownloadState } = require("./backend/state/download-state");
const { HistoryIndex } = require("./backend/state/history-index");
const {
  createMetadataService,
} = require("./backend/services/metadata-service");
const {
  createPlaylistService,
} = require("./backend/services/playlist-service");
const {
  createDownloadCompletionService,
  getUniqueFolderPath,
  sanitizeFilename,
} = require("./backend/services/download-runner");
const {
  classifyRuntimeError,
  createClassifiedError,
} = require("./backend/services/error-classifier");
const {
  createSiteRequestGuard,
} = require("./backend/services/site-request-guard");
const {
  buildSubtitleArgs,
  computeSiteRetryDelayMs,
  ensureOrganizedTargetDir,
  getSiteKeyFromUrl,
  shouldSmartRetry,
} = require("./backend/utils/download-job-helpers");
const { createWebSocketHub } = require("./backend/websocket/client-hub");
const { registerApiRoutes } = require("./backend/routes/api-routes");
const {
  contentFilter_isBlockedUrl,
} = require("./backend/shared/content-filter");
const {
  generateToken,
  createAuthMiddleware,
  isValidToken,
} = require("./backend/middleware/auth");
const {
  createRateLimiter,
  strictLimiter,
  standardLimiter,
  looseLimiter,
} = require("./backend/middleware/rate-limit");

logger.info("[server.js] Server process started.");
logger.info(
  "[server.js] Received YTDLP_PATH from env: ",
  process.env.YTDLP_PATH,
);
logger.info(
  "[server.js] Received FFMPEG_PATH from env: ",
  process.env.FFMPEG_PATH,
);
logger.info(
  "[server.js] Received NODE_BINARY from env: ",
  process.env.NODE_BINARY,
);

const env = loadEnv(process.env);

(async () => {
  // Dynamically import ESM modules
  const open = (await import("open")).default;
  const getPort = (await import("get-port")).default;

  const preferredPort = env.PORT;
  const PORT = await getPort({
    port: preferredPort,
    host: "127.0.0.1",
  });
  const fallbackUserDataRoot =
    process.platform === "win32"
      ? path.join(process.env.APPDATA || os.homedir(), "GetVideosLocally")
      : path.join(os.homedir(), ".getvideoslocally");
  let writableDataRoot =
    env.USER_DATA_PATH || process.env.USER_DATA_PATH || __dirname;
  if (writableDataRoot.includes("app.asar")) {
    writableDataRoot = fallbackUserDataRoot;
  }
  const runtimeDataDir = path.join(writableDataRoot, "data");
  let DOWNLOAD_DIR = path.join(writableDataRoot, "downloads");

  // Safety: Never allow app.asar in the path
  if (DOWNLOAD_DIR.includes("app.asar") || DOWNLOAD_DIR.includes("app.asa")) {
    DOWNLOAD_DIR = path.join(fallbackUserDataRoot, "downloads");
  }

  if (!fs.existsSync(runtimeDataDir)) {
    fs.mkdirSync(runtimeDataDir, { recursive: true });
  }

  logger.info("[server.js] FINAL DOWNLOAD_DIR:", DOWNLOAD_DIR);
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  const PAUSED_JOBS_FILE = path.join(writableDataRoot, "paused_jobs.json");
  const SCHEDULED_JOBS_FILE = path.join(writableDataRoot, "scheduled_jobs.json");
  const FAILED_JOBS_FILE = path.join(writableDataRoot, "failed_jobs.json");
  const HISTORY_INDEX_FILE = path.join(runtimeDataDir, "history-index.json");
  const METADATA_CACHE_FILE = path.join(
    runtimeDataDir,
    "metadata-cache.json",
  );
  const PLAYLIST_CACHE_FILE = path.join(runtimeDataDir, "playlist-cache.json");
  const downloadState = createDownloadState({
    pausedJobsFile: PAUSED_JOBS_FILE,
    scheduledJobsFile: SCHEDULED_JOBS_FILE,
    failedJobsFile: FAILED_JOBS_FILE,
    logger: logger,
  });
  const {
    clients,
    activeProcesses,
    downloadQueue,
    pausedDownloads,
    scheduledDownloads,
    failedDownloads,
    clientAutoUpdateSettings,
    loadFailedJobs,
    loadPausedJobs,
    loadScheduledJobs,
    markDirty,
    saveFailedJobs,
    savePausedJobs,
    saveScheduledJobs,
    saveRuntimeState,
  } = downloadState;
  const historyIndex = new HistoryIndex({
    filePath: HISTORY_INDEX_FILE,
    logger: logger,
  });
  await loadPausedJobs();
  await loadScheduledJobs();
  await loadFailedJobs();
  await historyIndex._loadPromise;

  // Set up executables with unified env var reading (support legacy names for compatibility)
  let ytdlpExecutable = process.env.YTDLP_PATH || process.env.YTDLPPATH;
  let ffmpegExecutable = process.env.FFMPEG_PATH || process.env.FFMPEGPATH;
  let nodeExecutable = process.env.NODE_BINARY;

  // Fallback to local bin directory for dev mode
  if (
    !ytdlpExecutable &&
    fs.existsSync(path.join(__dirname, "bin", "yt-dlp.exe"))
  ) {
    ytdlpExecutable = path.join(__dirname, "bin", "yt-dlp.exe");
  } else if (!ytdlpExecutable) {
    ytdlpExecutable = "yt-dlp";
  }

  if (
    !ffmpegExecutable &&
    fs.existsSync(path.join(__dirname, "bin", "ffmpeg.exe"))
  ) {
    ffmpegExecutable = path.join(__dirname, "bin", "ffmpeg.exe");
  } else if (!ffmpegExecutable) {
    ffmpegExecutable = "ffmpeg";
  }

  if (
    !nodeExecutable &&
    fs.existsSync(path.join(__dirname, "bin", "node.exe"))
  ) {
    nodeExecutable = path.join(__dirname, "bin", "node.exe");
  } else if (
    !nodeExecutable &&
    fs.existsSync(path.join(__dirname, "bin", "node"))
  ) {
    nodeExecutable = path.join(__dirname, "bin", "node");
  }

  let ffprobeExecutable = "ffprobe";
  if (ffmpegExecutable && fs.existsSync(ffmpegExecutable)) {
    const ffmpegDirectory = path.dirname(ffmpegExecutable);
    const ffprobeCandidate =
      process.platform === "win32"
        ? path.join(ffmpegDirectory, "ffprobe.exe")
        : path.join(ffmpegDirectory, "ffprobe");
    if (fs.existsSync(ffprobeCandidate)) {
      ffprobeExecutable = ffprobeCandidate;
    }
  }

  global.ytdlpExecutable = ytdlpExecutable;
  global.ffmpegExecutable = ffmpegExecutable;
  global.ffprobeExecutable = ffprobeExecutable;
  global.nodeExecutable = nodeExecutable;

  logger.info("[server.js] Effective ytdlpExecutable: ", ytdlpExecutable);
  logger.info("[server.js] Effective ffmpegExecutable: ", ffmpegExecutable);
  logger.info("[server.js] Effective ffprobeExecutable: ", ffprobeExecutable);
  logger.info(
    "[server.js] Effective nodeExecutable: ",
    nodeExecutable || "NOT SET - 4K may fail",
  );

  // ==================== AUTO-UPDATE SYSTEM ====================
  async function checkAndUpdateTools(
    forceCheck = false,
    notifyClients = false,
  ) {
    logger.info("🔄 Starting tool updates...");
    try {
      const ytdlpResult = await updateYtDlp(forceCheck);
      const ffmpegResult = await updateFFmpeg(forceCheck);

      logger.info("✅ Tool update check completed");

      if (notifyClients) {
        const updateMessage = {
          type: "tool_update_complete",
          ytdlp: {
            updated: ytdlpResult.updated || false,
            oldVersion: ytdlpResult.oldVersion,
            newVersion: ytdlpResult.newVersion,
          },
          ffmpeg: {
            updated: ffmpegResult.updated || false,
            oldVersion: ffmpegResult.oldVersion,
            newVersion: ffmpegResult.newVersion,
          },
        };

        wsHub.broadcast(updateMessage);
      }

      return { ytdlp: ytdlpResult, ffmpeg: ffmpegResult };
    } catch (error) {
      logger.error("❌ Error during tool updates:", error);
      return { error: error.message };
    }
  }

  async function checkYtDlpUpdateAvailable() {
    try {
      const currentVersion = await getToolVersion(ytdlpExecutable);
      const checkResult = await runToolUpdate(ytdlpExecutable, [
        "-U",
        "--verbose",
      ]);

      const output = (checkResult.output || "").toLowerCase();
      const errorOutput = (checkResult.error || "").toLowerCase();
      const combinedOutput = output + " " + errorOutput;

      if (checkResult.success) {
        const newVersion = await getToolVersion(ytdlpExecutable);

        if (newVersion !== currentVersion) {
          return { hasUpdate: true, updated: true, currentVersion, newVersion };
        }

        if (
          combinedOutput.includes("already up to date") ||
          combinedOutput.includes("no update") ||
          combinedOutput.includes("is up to date")
        ) {
          return {
            hasUpdate: false,
            currentVersion,
            reason: "Already up to date",
          };
        }

        return {
          hasUpdate: false,
          currentVersion,
          reason: "No update available",
        };
      }

      return {
        hasUpdate: false,
        error: checkResult.error || "Failed to check for updates",
      };
    } catch (error) {
      return { hasUpdate: false, error: error.message };
    }
  }

  async function updateYtDlp(forceCheck = false) {
    try {
      logger.info("🔄 Checking yt-dlp for updates...");
      const currentVersion = await getToolVersion(ytdlpExecutable);
      logger.info(`📋 Current yt-dlp version: ${currentVersion}`);

      if (!forceCheck) {
        const lastUpdateCheck = getLastUpdateCheck("ytdlp");
        const daysSinceLastCheck =
          (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);

        if (daysSinceLastCheck < 3) {
          logger.info(
            `⏰ yt-dlp update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`,
          );
          return {
            updated: false,
            currentVersion,
            reason: "Update check skipped (checked recently)",
          };
        }
      }

      logger.info("🔍 Checking for updates and updating if available...");
      const checkResult = await checkYtDlpUpdateAvailable();

      if (checkResult.error) {
        logger.info(`❌ yt-dlp update check failed: ${checkResult.error}`);
        setLastUpdateCheck("ytdlp");
        return {
          updated: false,
          currentVersion,
          error: checkResult.error || "Failed to check for updates",
        };
      }

      if (checkResult.updated && checkResult.newVersion) {
        logger.info(
          `✅ yt-dlp updated successfully! ${currentVersion} → ${checkResult.newVersion}`,
        );
        setLastUpdateCheck("ytdlp");
        global.ytdlpExecutable = ytdlpExecutable;
        return {
          updated: true,
          oldVersion: currentVersion,
          newVersion: checkResult.newVersion,
        };
      }

      logger.info(`ℹ️ yt-dlp: ${checkResult.reason || "No update available"}`);
      setLastUpdateCheck("ytdlp");
      return {
        updated: false,
        currentVersion: checkResult.currentVersion || currentVersion,
        reason: checkResult.reason || "No update available",
      };
    } catch (error) {
      logger.error("❌ Error updating yt-dlp:", error.message);
      return { updated: false, error: error.message };
    }
  }

  async function updateFFmpeg(forceCheck = false) {
    try {
      logger.info("🔄 Checking FFmpeg for updates...");
      let currentVersion = await getToolVersion(ffmpegExecutable);
      logger.info(`📋 Current FFmpeg version: ${currentVersion}`);

      if (currentVersion === "unknown" || currentVersion === "error") {
        logger.info(
          "🔄 FFmpeg version unknown, testing if executable works...",
        );
        const isWorking = await testFFmpegWorking();
        currentVersion = isWorking
          ? "Working (version unknown)"
          : "Not working";
        logger.info(
          isWorking
            ? "✅ FFmpeg is working but version detection failed"
            : "❌ FFmpeg executable is not working",
        );
      }

      if (!forceCheck) {
        const lastUpdateCheck = getLastUpdateCheck("ffmpeg");
        const daysSinceLastCheck =
          (Date.now() - lastUpdateCheck) / (1000 * 60 * 60 * 24);

        if (daysSinceLastCheck < 7) {
          logger.info(
            `⏰ FFmpeg update check skipped (last checked ${Math.round(daysSinceLastCheck)} days ago)`,
          );
          return {
            updated: false,
            currentVersion,
            reason: "Update check skipped (checked recently)",
          };
        }
      }

      logger.info("📥 Checking FFmpeg for new versions...");
      const ffmpegResult = await checkFFmpegUpdates();

      if (ffmpegResult.error) {
        logger.info(`❌ FFmpeg update check failed: ${ffmpegResult.error}`);
        setLastUpdateCheck("ffmpeg");
        return {
          updated: false,
          currentVersion,
          error: ffmpegResult.error,
        };
      }

      if (ffmpegResult.hasUpdate) {
        logger.info(
          `🔄 FFmpeg update available: ${ffmpegResult.latestVersion}. Downloading...`,
        );

        const downloadResult = await downloadAndInstallFFmpeg(
          ffmpegResult.downloadUrl,
          ffmpegResult.latestVersion,
        );

        if (downloadResult.success) {
          const newVersion = await getToolVersion(ffmpegExecutable);
          logger.info(
            `✅ FFmpeg updated successfully! ${currentVersion} → ${newVersion}`,
          );
          setLastUpdateCheck("ffmpeg");
          return {
            updated: true,
            oldVersion: currentVersion,
            newVersion: newVersion,
          };
        } else {
          logger.error(
            `❌ FFmpeg download/install failed: ${downloadResult.error}`,
          );
          setLastUpdateCheck("ffmpeg");
          return {
            updated: false,
            currentVersion,
            hasUpdate: true,
            latestVersion: ffmpegResult.latestVersion,
            reason: `Auto-update failed: ${downloadResult.error}`,
          };
        }
      } else {
        logger.info("✅ FFmpeg is up to date");
        setLastUpdateCheck("ffmpeg");
        return {
          updated: false,
          currentVersion,
          reason: ffmpegResult.reason || "Already up to date",
        };
      }
    } catch (error) {
      logger.error("❌ Error checking FFmpeg updates:", error.message);
      return { updated: false, error: error.message };
    }
  }

  async function getToolVersion(executable) {
    try {
      return await new Promise((resolve) => {
        logger.info(`🔍 Getting version for: ${executable}`);

        const versionProc = spawn(executable, ["--version"], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10000,
        });

        let stdout = "";
        let stderr = "";

        versionProc.stdout.on("data", (data) => {
          stdout += data;
        });

        versionProc.stderr.on("data", (data) => {
          stderr += data;
        });

        versionProc.on("close", (code) => {
          const output = stdout.trim() || stderr.trim();
          if (output) {
            if (executable.includes("ffmpeg")) {
              const match = output.match(
                /ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2}-git-[a-f0-9]+)/,
              );
              if (match) {
                resolve(`ffmpeg version ${match[1]}`);
              } else {
                const dateMatch = output.match(
                  /ffmpeg version ([0-9]{4}-[0-9]{2}-[0-9]{2})/,
                );
                resolve(
                  dateMatch
                    ? `ffmpeg version ${dateMatch[1]}`
                    : output.split("\n")[0],
                );
              }
            } else if (executable.includes("yt-dlp")) {
              const match = output.match(/yt-dlp ([0-9]+\.[0-9]+\.[0-9]+)/);
              resolve(match ? `yt-dlp ${match[1]}` : output.split("\n")[0]);
            } else {
              resolve(output.split("\n")[0]);
            }
          } else {
            resolve("unknown");
          }
        });

        versionProc.on("error", (error) => {
          logger.error(
            `❌ Error getting version for ${executable}:`,
            error.message,
          );
          resolve("error");
        });
      });
    } catch (error) {
      logger.error(
        `❌ Exception getting version for ${executable}:`,
        error.message,
      );
      return "error";
    }
  }

  async function runToolUpdate(executable, args) {
    return new Promise((resolve) => {
      const updateProc = spawn(executable, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });

      let updateOutput = "";
      let updateError = "";

      updateProc.stdout.on("data", (data) => {
        updateOutput += data;
      });

      updateProc.stderr.on("data", (data) => {
        updateError += data;
      });

      updateProc.on("close", (code) => {
        resolve(
          code === 0
            ? { success: true, output: updateOutput }
            : { success: false, error: updateError, code },
        );
      });

      updateProc.on("error", (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  async function checkFFmpegUpdates() {
    try {
      const currentVersion = await getToolVersion(ffmpegExecutable);

      logger.info("🌐 Fetching latest FFmpeg release info from GitHub...");
      const releaseInfo = await new Promise((resolve, reject) => {
        const options = {
          hostname: "api.github.com",
          path: "/repos/GyanD/codexffmpeg/releases/latest",
          headers: { "User-Agent": "GetVideosLocally-App" },
          timeout: 15000,
        };

        const req = https.get(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(
                new Error(`Failed to parse GitHub API response: ${e.message}`),
              );
            }
          });
        });

        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("GitHub API request timed out"));
        });
      });

      if (!releaseInfo.tag_name) {
        logger.warn("⚠️ Could not determine latest FFmpeg version from GitHub");
        return {
          hasUpdate: false,
          latestVersion: "unknown",
          error: "No tag_name in release info",
        };
      }

      const latestVersion = releaseInfo.tag_name.replace(/^v/, "");
      logger.info(`📦 Latest FFmpeg version from GitHub: ${latestVersion}`);

      let downloadUrl = null;
      if (Array.isArray(releaseInfo.assets)) {
        const essentialsAsset = releaseInfo.assets.find((a) =>
          /essentials_build\.zip$/.test(a.name),
        );
        if (essentialsAsset) {
          downloadUrl = essentialsAsset.browser_download_url;
        }
      }

      if (!downloadUrl) {
        logger.warn("⚠️ Could not find essentials build download URL");
        return {
          hasUpdate: false,
          latestVersion,
          error: "Could not find essentials build download URL",
        };
      }

      const currentVersionClean = currentVersion
        .replace(/^(ffmpeg version\s*)/i, "")
        .trim();
      const hasUpdate = compareVersions(currentVersionClean, latestVersion) < 0;

      return {
        hasUpdate,
        latestVersion,
        currentVersion: currentVersionClean,
        downloadUrl,
      };
    } catch (error) {
      logger.error("Error checking FFmpeg updates:", error);
      return {
        hasUpdate: false,
        latestVersion: "unknown",
        error: error.message,
      };
    }
  }

  async function downloadAndInstallFFmpeg(downloadUrl, version) {
    const tmpDir = path.join(os.tmpdir(), `ffmpeg-update-${Date.now()}`);
    const zipPath = path.join(tmpDir, "ffmpeg-essentials.zip");

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      logger.info(`📥 Downloading FFmpeg ${version} from ${downloadUrl}...`);

      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        const request = https.get(downloadUrl, (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            request.destroy();
            https
              .get(response.headers.location, (redirectRes) => {
                redirectRes.pipe(file);
                file.on("finish", () => file.close(resolve));
              })
              .on("error", reject);
            return;
          }
          response.pipe(file);
          file.on("finish", () => file.close(resolve));
        });
        request.on("error", reject);
        request.setTimeout(120000, () => {
          request.destroy();
          reject(new Error("Download timed out"));
        });
      });

      logger.info("📦 Extracting FFmpeg archive...");
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();

      const binDir = path.dirname(ffmpegExecutable);
      const binFiles = ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"];
      const extractedFiles = [];

      for (const entry of zipEntries) {
        const entryName = entry.entryName;
        const baseName = path.basename(entryName);

        if (binFiles.includes(baseName) && entryName.includes("/bin/")) {
          const destPath = path.join(binDir, baseName);
          const backupPath = destPath + ".bak";

          if (fs.existsSync(destPath)) {
            try {
              if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
              }
              fs.renameSync(destPath, backupPath);
            } catch (renameErr) {
              logger.warn(
                `⚠️ Could not backup ${baseName} (may be in use): ${renameErr.message}`,
              );
              try {
                fs.unlinkSync(destPath);
              } catch (delErr) {
                logger.error(
                  `❌ Could not remove old ${baseName}: ${delErr.message}`,
                );
                continue;
              }
            }
          }

          const entryData = entry.getData();
          fs.writeFileSync(destPath, entryData);
          extractedFiles.push(baseName);

          try {
            if (fs.existsSync(backupPath)) {
              fs.unlinkSync(backupPath);
            }
          } catch (_) {}
        }
      }

      if (extractedFiles.length === 0) {
        return { success: false, error: "No binaries found in archive" };
      }

      logger.info(`✅ Extracted: ${extractedFiles.join(", ")} to ${binDir}`);

      const isWorking = await testFFmpegWorking();
      if (!isWorking) {
        logger.error(
          "❌ FFmpeg binary not working after update, rolling back...",
        );
        for (const baseName of extractedFiles) {
          const destPath = path.join(binDir, baseName);
          const backupPath = destPath + ".bak";
          try {
            if (fs.existsSync(backupPath)) {
              fs.renameSync(backupPath, destPath);
            }
          } catch (_) {}
        }
        return {
          success: false,
          error: "FFmpeg binary not working after update",
        };
      }

      logger.info("✅ FFmpeg binary verified and working after update");
      return { success: true, extractedFiles };
    } catch (error) {
      logger.error(`❌ FFmpeg download/install error: ${error.message}`);

      for (const baseName of ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"]) {
        const destPath = path.join(path.dirname(ffmpegExecutable), baseName);
        const backupPath = destPath + ".bak";
        try {
          if (fs.existsSync(backupPath)) {
            if (!fs.existsSync(destPath)) {
              fs.renameSync(backupPath, destPath);
            } else {
              fs.unlinkSync(backupPath);
            }
          }
        } catch (_) {}
      }

      return { success: false, error: error.message };
    } finally {
      try {
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (_) {}
    }
  }

  function compareVersions(v1, v2) {
    if (v1 === "unknown" || v1 === "error") return 0;
    if (v2 === "unknown") return 0;

    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }

    return 0;
  }

  function getLastUpdateCheck(tool) {
    try {
      const checkFile = path.join(runtimeDataDir, `${tool}_last_check.json`);
      if (fs.existsSync(checkFile)) {
        const data = JSON.parse(fs.readFileSync(checkFile, "utf8"));
        return data.lastCheck || 0;
      }
    } catch (error) {
      logger.error(`Error reading last update check for ${tool}:`, error);
    }
    return 0;
  }

  function setLastUpdateCheck(tool) {
    try {
      const checkFile = path.join(runtimeDataDir, `${tool}_last_check.json`);
      const data = { lastCheck: Date.now() };
      fs.writeFileSync(checkFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error(`Error writing last update check for ${tool}:`, error);
    }
  }

  async function testFFmpegWorking() {
    try {
      return await new Promise((resolve) => {
        const testProc = spawn(
          ffmpegExecutable,
          [
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=1",
            "-f",
            "null",
            "-",
          ],
          {
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 10000,
          },
        );

        let stderr = "";
        testProc.stderr.on("data", (data) => (stderr += data));

        testProc.on("close", (code) => {
          const isWorking =
            stderr.includes("ffmpeg") ||
            stderr.includes("Input") ||
            stderr.includes("Output");
          resolve(isWorking);
        });

        testProc.on("error", (error) => {
          logger.error("FFmpeg test error:", error.message);
          resolve(false);
        });
      });
    } catch (error) {
      logger.error("Exception testing FFmpeg:", error.message);
      return false;
    }
  }

  // Dynamically import p-limit
  let pLimit;
  let singleVideoProcessingLimit;
  let playlistItemProcessingLimit;
  let concurrencySettings = resolveDownloadConcurrency();
  let currentSingleConcurrency = concurrencySettings.singleDownloads;
  let currentPlaylistConcurrency = concurrencySettings.playlistDownloads;
  let autoUpdateInterval = null; // For periodic auto-update checks
  let sendMessageToClient = () => {};
  const safeSendMessageToClient = (...args) => sendMessageToClient(...args);
  const scheduledDownloadTimers = new Map();
  const siteRetryState = new Map();
  const cookieBurstValidationCache = new Map();
  const siteRequestGuard = createSiteRequestGuard({
    logger: logger,
  });

  const metadataService = createMetadataService({
    runYtDlpCommand,
    sendMessageToClient: safeSendMessageToClient,
    pLimitFactory: null,
    logger: logger,
    initialConcurrency: concurrencySettings,
    cacheFilePath: METADATA_CACHE_FILE,
  });
  await metadataService.loadPersistedCache();

  const playlistService = createPlaylistService({
    runYtDlpCommand,
    sendMessageToClient: safeSendMessageToClient,
    logger: logger,
    cacheFilePath: PLAYLIST_CACHE_FILE,
  });
  await playlistService.ready;

  const wsHub = createWebSocketHub({
    WebSocket,
    urlParser: url,
    state: downloadState,
    logger: logger,
    onMessage: async (clientId, messageData) => {
      const { type, itemId } = messageData;

      if (type === "download_request") {
        await handleDownloadRequest(clientId, messageData);
      } else if (type === "cancel" && itemId) {
        await handleCancelRequest(clientId, itemId);
      } else if (type === "pause" && itemId) {
        await handlePauseRequest(clientId, itemId);
      } else if (type === "resume" && itemId) {
        await handleResumeRequest(clientId, itemId);
      } else if (type === "auto_update_preference") {
        const autoUpdateEnabled = messageData.enabled !== false;
        clientAutoUpdateSettings.set(clientId, autoUpdateEnabled);
        logger.info(
          `Client ${clientId} auto-update preference: ${autoUpdateEnabled ? "enabled" : "disabled"}`,
        );
      } else {
        logger.warn(`Unknown message type from ${clientId}: ${type}`);
      }
    },
  });

  sendMessageToClient = wsHub.sendMessageToClient;

  function applyQueueProfile(profileName) {
    const normalizedProfile = String(profileName || "balanced").toLowerCase();
    const profileOverrides =
      normalizedProfile === "aggressive"
        ? {
            singleDownloads: 2,
            playlistDownloads: 5,
            metadataSingles: 4,
            metadataPlaylists: 3,
          }
        : normalizedProfile === "conservative"
          ? {
              singleDownloads: 1,
              playlistDownloads: 2,
              metadataSingles: 1,
              metadataPlaylists: 1,
            }
          : {
              singleDownloads: 1,
              playlistDownloads: 3,
              metadataSingles: 3,
              metadataPlaylists: 2,
            };

    concurrencySettings = resolveDownloadConcurrency({
      ...concurrencySettings,
      ...profileOverrides,
    });
    currentSingleConcurrency = concurrencySettings.singleDownloads;
    currentPlaylistConcurrency = concurrencySettings.playlistDownloads;
    if (pLimit) {
      singleVideoProcessingLimit = pLimit(currentSingleConcurrency);
      playlistItemProcessingLimit = pLimit(currentPlaylistConcurrency);
    }
    metadataService.configureConcurrency(concurrencySettings);
    return concurrencySettings;
  }

  function buildRetrySummary(itemId, failedJob) {
    return {
      itemId,
      title: failedJob.title,
      source: failedJob.source,
      message: failedJob.message,
      failedAt: failedJob.failedAt,
      attempt: failedJob.attempt || 0,
      siteKey: failedJob.siteKey || getSiteKeyFromUrl(failedJob.videoUrl),
      videoUrl: failedJob.videoUrl,
      format: failedJob.format,
      quality: failedJob.quality,
    };
  }

  function getRecoverableDownloads(clientId) {
    return Array.from(pausedDownloads.entries())
      .filter(([, jobSpec]) => String(jobSpec.clientId) === String(clientId))
      .map(([itemId, jobSpec]) => ({
        itemId,
        title: jobSpec.title || "Recoverable download",
        source: jobSpec.source || "youtube",
        format: jobSpec.format || null,
        quality: jobSpec.quality || null,
        pausedAt: jobSpec.pausedAt || null,
        isPlaylistItem: jobSpec.isPlaylistItem || false,
        playlistTitle: jobSpec.playlistTitle || null,
      }));
  }

  function getScheduledDownloads(clientId) {
    return Array.from(scheduledDownloads.entries())
      .filter(([, jobSpec]) => String(jobSpec.clientId) === String(clientId))
      .map(([scheduleId, jobSpec]) => ({
        scheduleId,
        scheduledFor: jobSpec.scheduledFor,
        createdAt: jobSpec.createdAt,
        title: jobSpec.previewTitle || jobSpec.url,
        url: jobSpec.url,
        format: jobSpec.format,
        quality: jobSpec.quality,
        source: jobSpec.source || "youtube",
        playlistAction: jobSpec.playlistAction || "single",
      }));
  }

  function getFailedDownloads(clientId) {
    return Array.from(failedDownloads.entries())
      .filter(([, failedJob]) => String(failedJob.clientId) === String(clientId))
      .map(([itemId, failedJob]) => buildRetrySummary(itemId, failedJob));
  }

  async function queueFailedDownloadRetry(clientId, itemId) {
    const failedJob = failedDownloads.get(itemId);
    if (!failedJob) {
      throw new Error("Failed download not found.");
    }

    failedDownloads.delete(itemId);
    await saveFailedJobs();
    await handleDownloadRequest(clientId, {
      url: failedJob.videoUrl,
      format: failedJob.format,
      quality: failedJob.quality,
      source: failedJob.source,
      playlistAction: failedJob.playlistAction || "single",
      concurrency: failedJob.concurrency || 1,
      singleConcurrency: failedJob.singleConcurrency || 1,
      ...failedJob.settings,
    });

    return { success: true, itemId };
  }

  async function retryAllFailedDownloads(clientId) {
    const failedItems = getFailedDownloads(clientId);
    for (const item of failedItems) {
      await queueFailedDownloadRetry(clientId, item.itemId);
    }
    return { success: true, count: failedItems.length };
  }

  async function scheduleDownloadExecution(scheduleId) {
    const scheduledJob = scheduledDownloads.get(scheduleId);
    if (!scheduledJob) {
      return;
    }

    scheduledDownloads.delete(scheduleId);
    await saveScheduledJobs();
    scheduledDownloadTimers.delete(scheduleId);
    await handleDownloadRequest(scheduledJob.clientId, {
      url: scheduledJob.url,
      format: scheduledJob.format,
      quality: scheduledJob.quality,
      source: scheduledJob.source,
      playlistAction: scheduledJob.playlistAction,
      concurrency: scheduledJob.concurrency,
      singleConcurrency: scheduledJob.singleConcurrency,
      selectedPlaylistItems: scheduledJob.selectedPlaylistItems,
      ...scheduledJob.settings,
    });
  }

  function queueScheduledTimer(scheduleId, scheduledFor) {
    const scheduledTimeMs = new Date(scheduledFor).getTime();
    if (!Number.isFinite(scheduledTimeMs)) {
      throw new Error("Invalid scheduled time.");
    }

    const delayMs = Math.max(0, scheduledTimeMs - Date.now());
    const existingTimer = scheduledDownloadTimers.get(scheduleId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      scheduleDownloadExecution(scheduleId).catch((error) => {
        logger.error(
          `[Schedule] Failed to execute scheduled job ${scheduleId}:`,
          error,
        );
      });
    }, delayMs);
    scheduledDownloadTimers.set(scheduleId, timer);
  }

  async function createScheduledDownload(clientId, requestData) {
    const scheduledFor = requestData.scheduledFor;
    const scheduledTime = new Date(scheduledFor).getTime();
    if (!scheduledFor || !Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) {
      throw new Error("Scheduled time must be in the future.");
    }

    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const scheduledJob = {
      clientId,
      url: requestData.url,
      format: requestData.format,
      quality: requestData.quality,
      source: requestData.source || "youtube",
      playlistAction: requestData.playlistAction || "single",
      concurrency: requestData.concurrency || 1,
      singleConcurrency: requestData.singleConcurrency || 1,
      selectedPlaylistItems: Array.isArray(requestData.selectedPlaylistItems)
        ? requestData.selectedPlaylistItems
        : [],
      previewTitle: requestData.previewTitle || "",
      scheduledFor: new Date(scheduledTime).toISOString(),
      createdAt: new Date().toISOString(),
      settings: { ...requestData },
    };
    delete scheduledJob.settings.url;
    delete scheduledJob.settings.clientId;
    delete scheduledJob.settings.scheduledFor;
    delete scheduledJob.settings.previewTitle;

    scheduledDownloads.set(scheduleId, scheduledJob);
    await saveScheduledJobs();
    queueScheduledTimer(scheduleId, scheduledJob.scheduledFor);
    return {
      success: true,
      scheduleId,
      scheduledFor: scheduledJob.scheduledFor,
    };
  }

  async function deleteScheduledDownload(clientId, scheduleId) {
    const scheduledJob = scheduledDownloads.get(scheduleId);
    if (!scheduledJob || String(scheduledJob.clientId) !== String(clientId)) {
      throw new Error("Scheduled download not found.");
    }

    const timer = scheduledDownloadTimers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      scheduledDownloadTimers.delete(scheduleId);
    }
    scheduledDownloads.delete(scheduleId);
    await saveScheduledJobs();
    return { success: true, scheduleId };
  }

  async function previewPlaylist(clientId, playlistUrl) {
    const previewId = `playlist_preview_${Date.now()}`;
    const { items, title } = await playlistService.fetchPlaylistContext(
      clientId,
      playlistUrl,
      previewId,
    );
    return {
      title: title || "Playlist",
      items: items.map((item, index) => ({
        id: item.id,
        title: item.title,
        index,
      })),
    };
  }

  async function storeFailedDownload(itemId, failedJob) {
    failedDownloads.set(itemId, failedJob);
    await saveFailedJobs();
  }

  async function clearFailedDownload(itemId) {
    if (!failedDownloads.has(itemId)) {
      return;
    }
    failedDownloads.delete(itemId);
    await saveFailedJobs();
  }

  function buildRecoveryJobSpec(itemId, jobData, overrides = {}) {
    return {
      clientId: jobData.clientId,
      itemId,
      videoUrl: jobData.videoUrl,
      format: jobData.format,
      quality: jobData.quality,
      source: jobData.source || "youtube",
      settings: jobData.settings || {},
      isPlaylistItem: jobData.isPlaylistItem || false,
      playlistIndex: jobData.playlistIndex,
      playlistFolderPath: jobData.playlistFolderPath,
      playlistTitle: jobData.playlistTitle,
      title: jobData.title || "Recoverable download",
      outputTemplate: jobData.outputTemplate,
      pausedAt: Date.now(),
      resumeAttempts: jobData.resumeAttempts || 0,
      ...overrides,
    };
  }

  async function snapshotRecoverableDownloadsForShutdown() {
    for (const [itemId, queuedItem] of downloadQueue.entries()) {
      if (queuedItem?.isMeta) {
        continue;
      }
      pausedDownloads.set(itemId, buildRecoveryJobSpec(itemId, queuedItem));
    }

    for (const [itemId, procInfo] of activeProcesses.entries()) {
      const jobData = procInfo.itemData || procInfo;
      pausedDownloads.set(
        itemId,
        buildRecoveryJobSpec(itemId, jobData, {
          outputTemplate: procInfo.outputTemplate || jobData.outputTemplate,
        }),
      );
    }

    await saveRuntimeState();
  }

  for (const [scheduleId, scheduledJob] of scheduledDownloads.entries()) {
    try {
      queueScheduledTimer(scheduleId, scheduledJob.scheduledFor);
    } catch (error) {
      logger.warn(
        `[Schedule] Failed to restore scheduled job ${scheduleId}: ${error.message}`,
      );
    }
  }

  async function probeMediaFile(filePath) {
    if (!ffprobeExecutable) {
      return null;
    }

    return new Promise((resolve) => {
      const ffprobeProc = spawn(
        ffprobeExecutable,
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );

      let stdout = "";
      let stderr = "";

      ffprobeProc.stdout.setEncoding("utf8");
      ffprobeProc.stderr.setEncoding("utf8");
      ffprobeProc.stdout.on("data", (data) => {
        stdout += data;
      });
      ffprobeProc.stderr.on("data", (data) => {
        stderr += data;
      });
      ffprobeProc.on("error", () => resolve(null));
      ffprobeProc.on("close", (code) => {
        if (code !== 0 || !stdout.trim()) {
          if (stderr.trim()) {
            logger.warn(`[MediaProbe] ffprobe warning for ${filePath}: ${stderr.trim()}`);
          }
          return resolve(null);
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (_error) {
          resolve(null);
        }
      });
    });
  }

  async function verifyDownload({
    expectedFormat = null,
    filePath,
    itemId,
  }) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw createClassifiedError({
        code: "DOWNLOAD_MISSING",
        message: `Download missing: ${filePath || "unknown file path"}`,
      });
    }

    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw createClassifiedError({
        code: "DOWNLOAD_MISSING",
        message: `Download missing: ${filePath} is not a file`,
      });
    }

    if (stats.size <= 0) {
      throw createClassifiedError({
        code: "DOWNLOAD_EMPTY",
        message: `Download empty: ${filePath} is 0 bytes`,
      });
    }

    if (expectedFormat) {
      const expectedExtension = `.${String(expectedFormat).toLowerCase()}`;
      const actualExtension = path.extname(filePath).toLowerCase();
      if (actualExtension && actualExtension !== expectedExtension) {
        logger.warn(
          `[${itemId}] Output extension mismatch. Expected ${expectedExtension}, got ${actualExtension} for ${filePath}`,
        );
      }
    }

    const mediaProbe = await probeMediaFile(filePath);
    if (
      mediaProbe &&
      (!Array.isArray(mediaProbe.streams) || mediaProbe.streams.length === 0)
    ) {
      throw createClassifiedError({
        code: "DOWNLOAD_MISSING",
        message: `Download verification failed: ${filePath} has no readable media streams`,
      });
    }

    return {
      mediaProbe,
      stats,
    };
  }

  const downloadCompletionService = createDownloadCompletionService({
    fs,
    pathModule: path,
    downloadDir: DOWNLOAD_DIR,
    formatBytes,
    verifyDownload,
    sendMessageToClient: safeSendMessageToClient,
    historyIndex,
    logger: logger,
  });

  import("p-limit")
    .then((module) => {
      pLimit = module.default;
      singleVideoProcessingLimit = pLimit(currentSingleConcurrency);
      playlistItemProcessingLimit = pLimit(currentPlaylistConcurrency);
      metadataService.setLimitFactory(pLimit);
      metadataService.configureConcurrency(concurrencySettings);
      logger.info("p-limit loaded and limiters initialized.");
    })
    .catch((err) => logger.error("Failed to load p-limit:", err));

  const app = express();
  app.disable("x-powered-by");
  const server = http.createServer(app);
  const serverToken = generateToken();
  const authMiddleware = createAuthMiddleware(serverToken);
  const wss = new WebSocket.Server({ noServer: true });

  // ==================== MIDDLEWARE ====================
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl) or from localhost
        if (
          !origin ||
          origin.startsWith("http://localhost") ||
          origin.startsWith("http://127.0.0.1")
        ) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      allowedHeaders: "Content-Type,Authorization,X-Server-Token",
    }),
  );

  // ==================== AUTH & RATE LIMITING ====================
  app.use(authMiddleware);

  app.use("/shutdown", strictLimiter);
  app.use("/update-tools", standardLimiter);
  app.use("/force-update-tools", standardLimiter);
  app.use("/video-info", standardLimiter);
  app.use("/api", standardLimiter);
  app.use("/diagnostics", looseLimiter);
  app.use("/tools-status", looseLimiter);
  app.use("/history-index", looseLimiter);

  // --- STATIC ROOT (dev + packaged) ---
  const resourcesRoot = process.resourcesPath || __dirname;

  const publicDir = fs.existsSync(path.join(resourcesRoot, "public"))
    ? path.join(resourcesRoot, "public")
    : path.join(__dirname, "public");

  const assetsDir = fs.existsSync(path.join(resourcesRoot, "assets"))
    ? path.join(resourcesRoot, "assets")
    : path.join(__dirname, "assets");

  app.use("/public", express.static(publicDir));
  app.use("/assets", express.static(assetsDir));

  const rootFile = (filename) => {
    // When packaged, your app is in app.asar; resources live in process.resourcesPath.
    const packaged = path.join(resourcesRoot, filename);
    const devOrAsar = path.join(__dirname, filename);
    return fs.existsSync(packaged) ? packaged : devOrAsar;
  };

  app.get("/", (req, res) => res.sendFile(rootFile("index.html")));
  app.get("/index.html", (req, res) => res.sendFile(rootFile("index.html")));
  app.get("/script.js", (req, res) => res.sendFile(rootFile("script.js")));

  // IMPORTANT: pick ONE that matches your real file (recommended: styles.css if that's what you have)
  app.get("/style.css", (req, res) => res.sendFile(rootFile("style.css")));
  // If you instead use style.css, use this route name and delete the styles.css route:
  // app.get('/style.css', (req, res) => res.sendFile(rootFile('style.css')));

  app.use(
    "/downloads",
    express.static(DOWNLOAD_DIR, {
      setHeaders: (res, filePath) => {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`,
        );
      },
    }),
  );

  // ==================== WEBSOCKET HANDLING ====================
  wsHub.attach(wss);
  server.on("upgrade", (request, socket, head) => {
    try {
      const requestUrl = new URL(
        request.url || "/",
        `http://${request.headers.host || "127.0.0.1"}`,
      );
      const clientId = requestUrl.searchParams.get("clientId");
      const providedToken = requestUrl.searchParams.get("token");

      if (!clientId || !isValidToken(serverToken, providedToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } catch (error) {
      logger.warn(`[server.js] Rejected websocket upgrade: ${error.message}`);
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
    }
  });

  async function preflightYouTubeBurstCookies(
    clientId,
    videoUrl,
    itemId,
    itemCount,
  ) {
    const siteProfile = getSiteDownloadProfile("youtube");
    if (itemCount < siteProfile.cookieBurstThreshold) {
      return { ok: true };
    }

    const cookieFilePath = await getCookiesPath();
    if (!cookieFilePath) {
      return { ok: true, mode: "anonymous" };
    }

    const stats = fs.statSync(cookieFilePath);
    const cacheKey = `${cookieFilePath}:${stats.size}:${stats.mtimeMs}`;
    const cached = cookieBurstValidationCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) {
      return cached.result;
    }

    const isValid = await validateCookiesFile(cookieFilePath, stats);
    if (!isValid) {
      const result = {
        ok: false,
        error: createClassifiedError({
          code: "COOKIE_INVALID",
          hasCookies: true,
          message:
            "Cookie preflight failed: imported cookies file is not a valid Netscape cookies.txt file.",
          siteKey: "youtube",
        }),
      };
      cookieBurstValidationCache.set(cacheKey, {
        checkedAt: Date.now(),
        result,
      });
      return result;
    }

    try {
      await runYtDlpCommand(
        clientId,
        [
          "--flat-playlist",
          "--playlist-items",
          "1",
          "--skip-download",
          "--print",
          "%(id)s",
          videoUrl,
        ],
        `cookie_preflight_${itemId}`,
        true,
      );
      const result = { ok: true, mode: "cookies" };
      cookieBurstValidationCache.set(cacheKey, {
        checkedAt: Date.now(),
        result,
      });
      return result;
    } catch (error) {
      const classification =
        error.classification ||
        classifyRuntimeError({
          hasCookies: true,
          message: error.message,
          siteKey: "youtube",
        });
      if (classification.category === "cookies" || classification.category === "auth") {
        const result = {
          ok: false,
          error: createClassifiedError({
            code: classification.code,
            hasCookies: true,
            message:
              classification.code === "COOKIE_EXPIRED"
                ? "Cookie preflight failed: imported cookies appear to be expired."
                : "Cookie preflight failed before starting the YouTube playlist burst.",
            siteKey: "youtube",
          }),
        };
        cookieBurstValidationCache.set(cacheKey, {
          checkedAt: Date.now(),
          result,
        });
        return result;
      }

      return { ok: true };
    }
  }

  // ==================== DOWNLOAD REQUEST HANDLING ====================
  async function handleDownloadRequest(clientId, requestData) {
    const {
      url: videoUrl,
      format,
      quality,
      source,
      playlistAction,
      concurrency,
      singleConcurrency,
      selectedPlaylistItems,
      ...settings
    } = requestData;

    if (!videoUrl) {
      return sendMessageToClient(clientId, {
        type: "error",
        message: "Missing video URL.",
      });
    }

    // Check if URL is blocked
    const blocked = contentFilter_isBlockedUrl(videoUrl);
    if (blocked.blocked) {
      const reason =
        blocked.reason === "pornography"
          ? "Pornography sites are not allowed."
          : "Gambling sites are not allowed.";
      return sendMessageToClient(clientId, { type: "error", message: reason });
    }

    if (
      !pLimit ||
      !singleVideoProcessingLimit ||
      !playlistItemProcessingLimit
    ) {
      return sendMessageToClient(clientId, {
        type: "error",
        message: "Server not ready. Please try again shortly.",
      });
    }

    applyQueueProfile(settings.queueTuningProfile);
    const playlistLikelyByUrl =
      videoUrl.includes("list=") ||
      videoUrl.includes("/playlist") ||
      videoUrl.includes("/videos");
    const shouldProbePlaylist = playlistAction === "full" || playlistLikelyByUrl;
    const playlistProbe = shouldProbePlaylist
      ? await playlistService.probeCollection(
          clientId,
          videoUrl,
          `probe_${Date.now()}`,
        )
      : {
          isPlaylist: false,
          playlistTitle: null,
          siteKey: detectSiteKeyFromUrl(videoUrl, source),
        };
    const siteKey = playlistProbe.siteKey || detectSiteKeyFromUrl(videoUrl, source);
    const isPlaylist = playlistAction === "full"
      ? playlistProbe.isPlaylist !== false
      : playlistProbe.isPlaylist === true;

    if (isPlaylist && playlistAction === "full") {
      const playlistMetaId = `playlist_${source}_${Date.now()}`;
      downloadQueue.set(playlistMetaId, {
        status: "processing_playlist",
        title: `Playlist from ${videoUrl}`,
        source: source,
        clientId: clientId,
        isMeta: true,
      });
      sendMessageToClient(clientId, {
        type: "queued",
        itemId: playlistMetaId,
        title: `Fetching playlist: ${videoUrl}`,
        source,
      });

      let playlistFolderPath = null;
      try {
        const { items: fetchedItems, title: resolvedPlaylistTitle } =
          await playlistService.fetchPlaylistContext(
            clientId,
            videoUrl,
            playlistMetaId,
          );
        const filteredItems =
          Array.isArray(selectedPlaylistItems) && selectedPlaylistItems.length > 0
            ? fetchedItems.filter((item) =>
                selectedPlaylistItems.includes(String(item.id)),
              )
            : fetchedItems;
        if (filteredItems.length === 0) {
          throw new Error("No playlist items were selected for download.");
        }
        if (siteKey === "youtube") {
          const cookiePreflight = await preflightYouTubeBurstCookies(
            clientId,
            videoUrl,
            playlistMetaId,
            filteredItems.length,
          );
          if (!cookiePreflight.ok) {
            throw cookiePreflight.error;
          }
        }
        if (downloadQueue.get(playlistMetaId)?.cancelled) {
          logger.info(
            `[${playlistMetaId}] Playlist processing cancelled before starting items.`,
          );
          downloadQueue.delete(playlistMetaId);
          return;
        }
        sendMessageToClient(clientId, {
          type: "status",
          itemId: playlistMetaId,
          message: `Found ${filteredItems.length} items in playlist. Queuing downloads...`,
          source,
        });

        const playlistTitle =
          resolvedPlaylistTitle ||
          playlistProbe.playlistTitle ||
          filteredItems[0]?.title ||
          `Playlist_${Date.now()}`;

        // Use user's selected download folder if available, otherwise fall back to DOWNLOAD_DIR
        const baseDownloadFolder =
          settings.downloadFolder && settings.downloadFolder.trim() !== ""
            ? settings.downloadFolder
            : DOWNLOAD_DIR;

        // Ensure base folder exists
        if (!fs.existsSync(baseDownloadFolder)) {
          fs.mkdirSync(baseDownloadFolder, { recursive: true });
        }

        const organizedBaseFolder = await ensureOrganizedTargetDir({
          fs,
          baseDir: baseDownloadFolder,
          videoUrl,
          videoInfo: {
            siteKey: getSiteKeyFromUrl(videoUrl),
          },
          playlistTitle,
          isPlaylistItem: true,
          settings,
        });

        playlistFolderPath = getUniqueFolderPath(
          fs,
          organizedBaseFolder,
          playlistTitle,
        );
        if (!fs.existsSync(playlistFolderPath))
          fs.mkdirSync(playlistFolderPath, { recursive: true });

        logger.info(`[Playlist] Saving to folder: ${playlistFolderPath}`);

        const playlistRequestContext = resolveSiteConcurrency({
          videoUrl,
          source: siteKey,
          overrides: {
            ...concurrencySettings,
            playlistDownloads: concurrency,
          },
          adaptiveConcurrency: siteRequestGuard.getAdaptiveConcurrency(
            siteKey,
            resolveDownloadConcurrency({
              ...concurrencySettings,
              playlistDownloads: concurrency,
            }),
          ),
        });
        const newPlaylistConcurrency =
          playlistRequestContext.concurrency.playlistDownloads;
        if (currentPlaylistConcurrency !== newPlaylistConcurrency) {
          logger.info(
            `Updating playlist item concurrency from ${currentPlaylistConcurrency} to: ${newPlaylistConcurrency}`,
          );
          currentPlaylistConcurrency = newPlaylistConcurrency;
          concurrencySettings = {
            ...concurrencySettings,
            playlistDownloads: newPlaylistConcurrency,
          };
          playlistItemProcessingLimit = pLimit(newPlaylistConcurrency);
        }
        metadataService.configureConcurrency(playlistRequestContext.concurrency);

        const prefetchBudget =
          playlistRequestContext.prefetchVisiblePlaylistItems;

        const downloadPromises = filteredItems.map((item, index) => {
          const individualItemId = `${source}_${item.id}_${Date.now()}_${index}`;
          const itemData = {
            clientId,
            videoUrl: item.id,
            format,
            quality,
            source,
            settings,
            isPlaylistItem: true,
            playlistIndex: index,
            status: "queued",
            parentPlaylistId: playlistMetaId,
            title: item.title || `Video ${index + 1}`,
            playlistFolderPath,
            playlistTitle, // Add playlist title to item data
            siteKey,
          };
          downloadQueue.set(individualItemId, itemData);
          sendMessageToClient(clientId, {
            type: "queued",
            itemId: individualItemId,
            title: itemData.title,
            source,
            format: format,
            quality: quality,
            isPlaylistItem: itemData.isPlaylistItem || false,
            playlistIndex: itemData.playlistIndex || null,
          });

          if (index < prefetchBudget) {
            schedulePlaylistMetadataPrefetch(individualItemId, async () => {
              try {
                if (
                  downloadQueue.get(playlistMetaId)?.cancelled ||
                  downloadQueue.get(individualItemId)?.cancelled
                ) {
                  return;
                }
                const videoInfo = await getVideoInfo(
                  clientId,
                  item.id,
                  individualItemId,
                  quality,
                  format,
                );
                if (
                  downloadQueue.get(playlistMetaId)?.cancelled ||
                  downloadQueue.get(individualItemId)?.cancelled
                ) {
                  return;
                }
                const currentItemData = downloadQueue.get(individualItemId);
                if (currentItemData) {
                  currentItemData.title =
                    videoInfo.title || currentItemData.title;
                  markDirty();
                }
                sendMessageToClient(clientId, {
                  type: "item_info",
                  itemId: individualItemId,
                  title: videoInfo.title || itemData.title,
                  source,
                  format: format,
                  quality: quality,
                  thumbnail: videoInfo.thumbnail,
                  isPlaylistItem: true,
                  playlistIndex: index,
                });
              } catch (error) {
                logger.info(
                  `[${individualItemId}] Failed to fetch early metadata: ${error.message}`,
                );
              }
            });
          }

          return playlistItemProcessingLimit(async () => {
            if (
              downloadQueue.get(playlistMetaId)?.cancelled ||
              downloadQueue.get(individualItemId)?.cancelled
            ) {
              sendMessageToClient(clientId, {
                type: "cancel_confirm",
                message: "Skipped due to cancellation.",
                itemId: individualItemId,
                source,
              });
              downloadQueue.delete(individualItemId);
              return;
            }
            // Use unified video processor for all supported sites
            await processVideo(clientId, individualItemId, itemData);
          });
        });
        await Promise.all(downloadPromises);
        if (!downloadQueue.get(playlistMetaId)?.cancelled) {
          sendMessageToClient(clientId, {
            type: "playlist_complete",
            message: "All playlist items processed.",
            itemId: playlistMetaId,
            source,
          });
        }
      } catch (error) {
        logger.error(`Error processing playlist ${playlistMetaId}:`, error);
        if (!downloadQueue.get(playlistMetaId)?.cancelled) {
          sendMessageToClient(clientId, {
            type: "error",
            message: `Playlist processing error: ${error.message}`,
            itemId: playlistMetaId,
            source,
          });
        }
      } finally {
        downloadQueue.delete(playlistMetaId);
      }
    } else {
      const itemId = `${source}_${videoUrl.split("v=")[1]?.split("&")[0] || videoUrl.split("/").pop()?.split("?")[0] || Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const itemData = {
        clientId,
        videoUrl,
        format,
        quality,
        source,
        settings,
        isPlaylistItem: isPlaylist && playlistAction === "single",
        siteKey,
        status: "queued",
        title: `Video: ${videoUrl}`,
      };
      const cachedVideoInfo = getCachedVideoInfo(videoUrl);
      if (cachedVideoInfo) {
        itemData.title = cachedVideoInfo.title || itemData.title;
        itemData.thumbnail = cachedVideoInfo.thumbnail || null;
      }
      downloadQueue.set(itemId, itemData);
      sendMessageToClient(clientId, {
        type: "queued",
        itemId: itemId,
        title: itemData.title,
        source,
        format: itemData.format || format,
        quality: quality,
        thumbnail: itemData.thumbnail || null,
      });

      // Fetch metadata immediately for single videos (not playlist items) so users can confirm it's the right video
      const isSingleVideo = !itemData.isPlaylistItem;
      if (isSingleVideo) {
        // Fetch metadata asynchronously without blocking the queue
        scheduleSingleMetadataPrefetch(itemId, async () => {
          try {
            // Check if item was cancelled before fetching
            if (downloadQueue.get(itemId)?.cancelled) {
              return;
            }
            const videoInfo = await getVideoInfo(
              clientId,
              videoUrl,
              itemId,
              quality,
              format,
            );
            // Check again after fetch in case it was cancelled during fetch
            if (downloadQueue.get(itemId)?.cancelled) {
              return;
            }
            // Update the item data with the fetched title
            const currentItemData = downloadQueue.get(itemId);
            if (currentItemData) {
              currentItemData.title = videoInfo.title || currentItemData.title;
              markDirty();
            }
            // Send metadata to client immediately
            sendMessageToClient(clientId, {
              type: "item_info",
              itemId,
              title: videoInfo.title || itemData.title,
              source,
              format: format,
              quality: quality,
              thumbnail: videoInfo.thumbnail,
              isPlaylistItem: false,
            });
          } catch (error) {
            // Silently fail - metadata will be fetched again when processing starts
            logger.info(
              `[${itemId}] Failed to fetch early metadata: ${error.message}`,
            );
          }
        });
      }

      const singleRequestContext = resolveSiteConcurrency({
        videoUrl,
        source: siteKey,
        overrides: {
          ...concurrencySettings,
          singleDownloads: singleConcurrency,
        },
        adaptiveConcurrency: siteRequestGuard.getAdaptiveConcurrency(
          siteKey,
          resolveDownloadConcurrency({
            ...concurrencySettings,
            singleDownloads: singleConcurrency,
          }),
        ),
      });
      const newSingleConcurrency = singleRequestContext.concurrency.singleDownloads;
      if (currentSingleConcurrency !== newSingleConcurrency) {
        logger.info(
          `Updating single video concurrency from ${currentSingleConcurrency} to: ${newSingleConcurrency}`,
        );
        currentSingleConcurrency = newSingleConcurrency;
        concurrencySettings = {
          ...concurrencySettings,
          singleDownloads: newSingleConcurrency,
        };
        singleVideoProcessingLimit = pLimit(newSingleConcurrency);
      }
      metadataService.configureConcurrency(singleRequestContext.concurrency);

      singleVideoProcessingLimit(async () => {
        if (downloadQueue.get(itemId)?.cancelled) {
          sendMessageToClient(clientId, {
            type: "cancel_confirm",
            message: "Download cancelled before start.",
            itemId: itemId,
            source,
          });
          downloadQueue.delete(itemId);
          return;
        }
        // Use unified video processor for all supported sites
        await processVideo(clientId, itemId, itemData);
      });
    }
  }

  // ==================== CANCELLATION HANDLING ====================
  async function handleCancelRequest(clientId, itemId) {
    sendMessageToClient(clientId, {
      type: "status",
      message: "Cancellation request received...",
      itemId,
    });

    // 1. Check Queue
    const queuedItem = downloadQueue.get(itemId);
    if (queuedItem) {
      queuedItem.cancelled = true;
      if (queuedItem.isMeta) {
        downloadQueue.forEach((item) => {
          if (item.parentPlaylistId === itemId) item.cancelled = true;
        });
      }
      markDirty();
      downloadQueue.delete(itemId); // Remove from queue immediately
      sendMessageToClient(clientId, {
        type: "cancel_confirm",
        message: "Download cancelled from queue.",
        itemId,
      });
      return;
    }

    // 2. Check Paused Downloads
    if (pausedDownloads.has(itemId)) {
      const pausedJob = pausedDownloads.get(itemId);
      // Clean up files for paused job
      if (pausedJob.outputTemplate) {
        await cleanupFilesByTemplate(pausedJob.outputTemplate, itemId);
      }
      pausedDownloads.delete(itemId);
      savePausedJobs();
      sendMessageToClient(clientId, {
        type: "cancel_confirm",
        message: "Paused download cancelled and removed.",
        itemId,
      });
      return;
    }

    // 3. Check Active Processes
    const processInfo = activeProcesses.get(itemId);
    if (processInfo) {
      processInfo.cancelled = true;
      markDirty();

      // Terminate processes
      try {
        if (
          processInfo.ytdlpProc &&
          processInfo.ytdlpProc.pid &&
          !processInfo.ytdlpProc.killed
        ) {
          logger.info(
            `[${itemId}] Terminating yt-dlp process (PID: ${processInfo.ytdlpProc.pid})`,
          );
          await terminateProcessGracefully(processInfo.ytdlpProc.pid, itemId);
          processInfo.ytdlpProc.killed = true;
        }
        if (
          processInfo.ffmpegProc &&
          processInfo.ffmpegProc.pid &&
          !processInfo.ffmpegProc.killed
        ) {
          logger.info(
            `[${itemId}] Terminating ffmpeg process (PID: ${processInfo.ffmpegProc.pid})`,
          );
          await terminateProcessGracefully(processInfo.ffmpegProc.pid, itemId);
          processInfo.ffmpegProc.killed = true;
        }
      } catch (killError) {
        logger.error(
          `Error during process termination for ${itemId}:`,
          killError,
        );
      }

      // Wait a bit for file locks to release
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Clean up explicit temp files
      if (processInfo.tempFiles) {
        await Promise.all(processInfo.tempFiles.map((filePathPattern) => {
          return cleanupFilesByPattern(filePathPattern, itemId);
        }));
      }

      // Clean up based on Output Template (catch partials and main file)
      if (processInfo.outputTemplate) {
        await cleanupFilesByTemplate(processInfo.outputTemplate, itemId);
      }

      activeProcesses.delete(itemId);
      sendMessageToClient(clientId, {
        type: "cancel_confirm",
        message: "Download cancelled and files cleaned up.",
        itemId,
      });
    } else {
      sendMessageToClient(clientId, {
        type: "error",
        message: "Item not found or already completed/cancelled.",
        itemId,
      });
    }
  }

  // Helper to cleanup files based on glob pattern
  async function cleanupFilesByPattern(pattern, itemId) {
    try {
      const files = await globAsync(path.basename(pattern), {
        cwd: path.dirname(pattern),
        absolute: true,
      });
      await Promise.all(files.map(async (file) => {
        try {
          await fs.promises.unlink(file);
          logger.info(`[${itemId}] 🗑️ Deleted file on cancel: ${file}`);
        } catch (unlinkError) {
          if (unlinkError && unlinkError.code === "ENOENT") {
            return;
          }
          logger.warn(
            `[${itemId}] Could not delete file ${file}: ${unlinkError.message}`,
          );
        }
      }));
    } catch (e) {
      logger.error(`[${itemId}] Error in cleanupFilesByPattern: ${e.message}`);
    }
  }

  // Helper to cleanup files based on output template
  async function cleanupFilesByTemplate(template, itemId) {
    try {
      const dir = path.dirname(template);
      const base = path.basename(template);
      // Remove extension placeholders for matching
      const basePattern = base.replace(/%\([^)]+\)s/g, "*");
      // Get base name without extension for thumbnail matching
      const nameNoExt = basePattern.replace(/\.[^.]+$/, "");

      // Match:
      // 1. Exact file
      // 2. .part files
      // 3. .ytdl files
      // 4. .temp files
      // 5. any fragment files like .f137.mp4

      const patterns = [
        basePattern,
        `${basePattern}.part`,
        `${basePattern}.ytdl`,
        `${basePattern}.temp`,
        // Thumbnail files (written by --write-thumbnail)
        `${nameNoExt ? nameNoExt : basePattern}.jpg`,
        `${nameNoExt ? nameNoExt : basePattern}.webp`,
        `${nameNoExt ? nameNoExt : basePattern}.png`,
      ];

      const allFiles = new Set();

      for (const pattern of patterns) {
        const matches = await globAsync(pattern, { cwd: dir, absolute: true });
        matches.forEach((m) => allFiles.add(m));
      }

      // Also explicitly look for fragments that might match the base excluding extension
      // e.g. "Video.mp4" -> look for "Video.f*.mp4" or "Video.f*.*"
      if (nameNoExt && nameNoExt !== "*") {
        const fragmentMatches = await globAsync(`${nameNoExt}.f*.*`, {
          cwd: dir,
          absolute: true,
        });
        fragmentMatches.forEach((m) => allFiles.add(m));
      }

      await Promise.all(Array.from(allFiles).map(async (file) => {
        try {
          await fs.promises.unlink(file);
          logger.info(
            `[${itemId}] 🗑️ Deleted related file on cancel: ${file}`,
          );
        } catch (unlinkError) {
          if (unlinkError && unlinkError.code === "ENOENT") {
            return;
          }
          logger.warn(
            `[${itemId}] Could not delete related file ${file}: ${unlinkError.message}`,
          );
        }
      }));
    } catch (e) {
      logger.error(`[${itemId}] Error in cleanUpFilesByTemplate: ${e.message}`);
    }
  }

  // ==================== PAUSE HANDLING ====================
  // Pause = graceful stop (not SIGSTOP - Windows doesn't support it)
  // Terminates yt-dlp process but keeps .part files for resume
  async function handlePauseRequest(clientId, itemId) {
    logger.info(`[${itemId}] ⏸️ Pause request received`);

    const processInfo = activeProcesses.get(itemId);
    const queuedItem = downloadQueue.get(itemId);

    // Build the job spec to save for resume
    let jobSpec = null;

    if (processInfo) {
      // Download is actively running
      // IMPORTANT: Set paused flags FIRST before any termination
      processInfo.paused = true;
      processInfo.pausedByUser = true; // Mark as user-initiated pause
      markDirty();

      // Get the full item data for the job spec
      const itemData = queuedItem || processInfo.itemData || {};

      jobSpec = {
        clientId,
        itemId,
        videoUrl: itemData.videoUrl || processInfo.videoUrl,
        format: itemData.format || processInfo.format,
        quality: itemData.quality || processInfo.quality,
        source: itemData.source || processInfo.source || "youtube",
        settings: itemData.settings || processInfo.settings || {},
        isPlaylistItem: itemData.isPlaylistItem || false,
        playlistIndex: itemData.playlistIndex,
        playlistFolderPath: itemData.playlistFolderPath,
        playlistTitle: itemData.playlistTitle,
        title: itemData.title || processInfo.title || "Paused download",
        outputTemplate: processInfo.outputTemplate || itemData.outputTemplate, // CRITICAL for resume
        pausedAt: Date.now(),
        resumeAttempts: 0,
      };

      // Store job spec for resume BEFORE terminating (in case of crash)
      pausedDownloads.set(itemId, jobSpec);
      savePausedJobs();

      // Terminate the active yt-dlp process gracefully
      // yt-dlp will keep .part files by default
      try {
        if (
          processInfo.ytdlpProc &&
          processInfo.ytdlpProc.pid &&
          !processInfo.ytdlpProc.killed
        ) {
          logger.info(
            `[${itemId}] ⏸️ Terminating yt-dlp process (PID: ${processInfo.ytdlpProc.pid})`,
          );
          await terminateProcessGracefully(processInfo.ytdlpProc.pid, itemId);
          processInfo.ytdlpProc.killed = true;
        }

        // Also terminate any ffmpeg process (shouldn't be running during download phase)
        if (
          processInfo.ffmpegProc &&
          processInfo.ffmpegProc.pid &&
          !processInfo.ffmpegProc.killed
        ) {
          logger.info(
            `[${itemId}] ⏸️ Terminating ffmpeg process (PID: ${processInfo.ffmpegProc.pid})`,
          );
          await terminateProcessGracefully(processInfo.ffmpegProc.pid, itemId);
          processInfo.ffmpegProc.killed = true;
        }
      } catch (killError) {
        logger.error(`[${itemId}] Error during pause termination:`, killError);
      }

      // Small delay to ensure process close handlers have run
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now remove from active processes
      activeProcesses.delete(itemId);

      sendMessageToClient(clientId, {
        type: "pause_confirm",
        message: "Download paused",
        itemId,
        source: jobSpec.source,
      });

      logger.info(
        `[${itemId}] ✅ Paused successfully. Job spec saved for resume.`,
      );
    } else if (queuedItem) {
      // Download is queued but not started yet - easy to pause
      queuedItem.paused = true;
      markDirty();

      jobSpec = {
        clientId,
        itemId,
        videoUrl: queuedItem.videoUrl,
        format: queuedItem.format,
        quality: queuedItem.quality,
        source: queuedItem.source || "youtube",
        settings: queuedItem.settings || {},
        isPlaylistItem: queuedItem.isPlaylistItem || false,
        playlistIndex: queuedItem.playlistIndex,
        playlistFolderPath: queuedItem.playlistFolderPath,
        playlistTitle: queuedItem.playlistTitle,
        title: queuedItem.title || "Queued download",
        outputTemplate: queuedItem.outputTemplate,
        pausedAt: Date.now(),
        resumeAttempts: 0,
      };

      pausedDownloads.set(itemId, jobSpec);
      savePausedJobs();

      // Remove from queue
      downloadQueue.delete(itemId);

      sendMessageToClient(clientId, {
        type: "pause_confirm",
        message: "Queued download paused.",
        itemId,
        source: jobSpec.source,
      });

      logger.info(`[${itemId}] ✅ Queued download paused.`);
    } else {
      // Check if already paused
      if (pausedDownloads.has(itemId)) {
        sendMessageToClient(clientId, {
          type: "status",
          message: "This download is already paused.",
          itemId,
        });
      } else {
        sendMessageToClient(clientId, {
          type: "error",
          message: "Item not found or already completed.",
          itemId,
        });
      }
    }
  }

  // ==================== RESUME HANDLING ====================
  // Resume = respawn yt-dlp with same args and --continue flag
  async function handleResumeRequest(clientId, itemId) {
    logger.info(`[${itemId}] ▶️ Resume request received`);

    const jobSpec = pausedDownloads.get(itemId);
    if (!jobSpec) {
      sendMessageToClient(clientId, {
        type: "error",
        message: "No paused download found for this item.",
        itemId,
      });
      return;
    }

    // Update client ID to the resuming client (might be different if app restarted)
    jobSpec.clientId = clientId;
    jobSpec.resumeAttempts = (jobSpec.resumeAttempts || 0) + 1;

    // Remove from paused downloads
    pausedDownloads.delete(itemId);
    savePausedJobs();

    // Reconstruct itemData from job spec
    const itemData = {
      videoUrl: jobSpec.videoUrl,
      format: jobSpec.format,
      quality: jobSpec.quality,
      source: jobSpec.source,
      settings: jobSpec.settings,
      isPlaylistItem: jobSpec.isPlaylistItem,
      playlistIndex: jobSpec.playlistIndex,
      playlistFolderPath: jobSpec.playlistFolderPath,
      playlistTitle: jobSpec.playlistTitle,
      title: jobSpec.title,
      outputTemplate: jobSpec.outputTemplate,
      resumed: true,
      resumeAttempts: jobSpec.resumeAttempts,
      // Flag to use --continue on first resume, --no-continue if retrying at same point
      useNoContinue: jobSpec.resumeAttempts > 1,
    };

    sendMessageToClient(clientId, {
      type: "status",
      message: `Resuming download... (attempt ${jobSpec.resumeAttempts})`,
      itemId,
      source: jobSpec.source,
    });

    // Re-queue the download using the appropriate processing limit
    if (itemData.isPlaylistItem) {
      playlistItemProcessingLimit(async () => {
        await processVideoWithResume(clientId, itemId, itemData);
      });
    } else {
      singleVideoProcessingLimit(async () => {
        await processVideoWithResume(clientId, itemId, itemData);
      });
    }
  }

  // ==================== PROCESS TERMINATION (Windows-safe) ====================
  // Graceful termination with timeout fallback
  async function terminateProcessGracefully(pid, itemId, timeoutMs = 5000) {
    return new Promise((resolve) => {
      logger.info(`[${itemId}] Terminating PID ${pid} gracefully...`);

      if (os.platform() === "win32") {
        // Windows: Use taskkill with /T to kill process tree
        exec(`taskkill /PID ${pid} /T /F`, (error, stdout, stderr) => {
          if (error) {
            // Process might already be dead - that's fine
            if (
              !error.message.includes("not found") &&
              !error.message.includes("could not be terminated")
            ) {
              logger.warn(
                `[${itemId}] taskkill warning for PID ${pid}: ${error.message}`,
              );
            }
          }
          resolve();
        });
      } else {
        // Unix: Try SIGTERM first, then SIGKILL after timeout
        try {
          process.kill(pid, "SIGTERM");

          // Set timeout for force kill
          const forceKillTimeout = setTimeout(() => {
            try {
              process.kill(pid, "SIGKILL");
              logger.info(`[${itemId}] Force killed PID ${pid}`);
            } catch (e) {
              // Already dead
            }
            resolve();
          }, timeoutMs);

          // Check if process died
          const checkInterval = setInterval(() => {
            try {
              process.kill(pid, 0); // Check if alive
            } catch (e) {
              // Process is dead
              clearTimeout(forceKillTimeout);
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        } catch (err) {
          logger.warn(
            `[${itemId}] Error sending signal to PID ${pid}: ${err.message}`,
          );
          resolve();
        }
      }
    });
  }

  // Legacy function for backward compatibility
  function terminateProcessTree(pid) {
    logger.info(`[terminateProcessTree] Attempting to terminate PID: ${pid}`);
    if (os.platform() === "win32") {
      exec(`taskkill /PID ${pid} /T /F`, (error, stdout, stderr) => {
        if (error)
          logger.error(
            `[terminateProcessTree] taskkill error for PID ${pid}: ${error.message}`,
          );
        if (
          stderr &&
          !stderr.toLowerCase().includes("could not be terminated") &&
          !stderr.toLowerCase().includes("not found")
        ) {
          logger.error(
            `[terminateProcessTree] taskkill stderr for PID ${pid}: ${stderr}`,
          );
        }
      });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
        logger.info(
          `[terminateProcessTree] Sent SIGTERM to process group ${-pid}`,
        );
      } catch (err) {
        logger.warn(
          `[terminateProcessTree] Error sending SIGTERM to process group ${-pid}: ${err.message}. Trying direct PID.`,
        );
        try {
          process.kill(pid, "SIGTERM");
          logger.info(`[terminateProcessTree] Sent SIGTERM to PID ${pid}`);
        } catch (e2) {
          logger.warn(
            `[terminateProcessTree] Error sending SIGTERM to PID ${pid}: ${e2.message}. Trying SIGKILL.`,
          );
          try {
            process.kill(pid, "SIGKILL");
            logger.info(`[terminateProcessTree] Sent SIGKILL to PID ${pid}.`);
          } catch (e3) {
            logger.error(
              `[terminateProcessTree] Error SIGKILLing PID ${pid}: ${e3.message}`,
            );
          }
        }
      }
    }
  }

  // ==================== VIDEO PROCESSING LOGIC ====================
  function formatBytes(bytesInput, decimals = 2) {
    if (
      !bytesInput ||
      bytesInput === "N/A" ||
      bytesInput === "NA" ||
      isNaN(parseFloat(bytesInput))
    )
      return null;
    const bytes = parseFloat(bytesInput);
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (
      parseFloat(
        (bytes / Math.pow(k, Math.min(i, sizes.length - 1))).toFixed(dm),
      ) +
      " " +
      sizes[Math.min(i, sizes.length - 1)]
    );
  }

  async function getVideoInfo(clientId, videoUrl, itemId) {
    return metadataService.getVideoInfo(clientId, videoUrl, itemId);
  }

  function getCachedVideoInfo(videoUrl) {
    return metadataService.getCachedVideoInfo(videoUrl);
  }

  function scheduleSingleMetadataPrefetch(itemId, task) {
    metadataService.scheduleSinglePrefetch(itemId, task);
  }

  function schedulePlaylistMetadataPrefetch(itemId, task) {
    metadataService.schedulePlaylistPrefetch(itemId, task);
  }

  function extractAvailableQualities(formats) {
    return metadataService.extractAvailableQualities(formats);
  }

  function logDetailed(level, itemId, message) {
    const prefix = `[${itemId}]`;
    if (level === "info") {
      logger.info(prefix, message);
    } else if (level === "error") {
      logger.error(prefix, message);
    } else {
      logger.info(prefix, message);
    }
  }

  // Unified video processor - supports all yt-dlp compatible sites
  async function processVideo(clientId, itemId, itemData) {
    const {
      videoUrl,
      format,
      quality,
      source,
      settings,
      isPlaylistItem,
      playlistIndex,
    } = itemData;
    let currentVideoTitle = itemData.title || "video";
    let tempFilesCreated = [];
    let finalFilePathValue; // Declare at function scope for access in finally block

    // Create process tracking info with all data needed for pause/resume
    const itemProcInfo = {
      ytdlpProc: null,
      ffmpegProc: null,
      tempFiles: tempFilesCreated,
      cancelled: false,
      paused: false,
      // Store all item data for potential pause
      itemData: { ...itemData },
      videoUrl,
      format,
      quality,
      source,
      settings,
      title: currentVideoTitle,
    };
    activeProcesses.set(itemId, itemProcInfo);
    downloadQueue.delete(itemId);

    try {
      if (itemProcInfo.cancelled) {
        logger.info(`[${itemId}] Pre-cancelled processVideo.`);
        return;
      }

      const videoInfo = await getVideoInfo(
        clientId,
        videoUrl,
        itemId,
        quality,
        format,
      );
      currentVideoTitle = videoInfo.title || currentVideoTitle;
      itemProcInfo.videoInfo = videoInfo;
      itemProcInfo.thumbnail = videoInfo.thumbnail; // Store thumbnail for complete message
      markDirty();
      sendMessageToClient(clientId, {
        type: "item_info",
        itemId,
        title: currentVideoTitle,
        source,
        format: format,
        quality: quality,
        thumbnail: videoInfo.thumbnail,
        isPlaylistItem: itemData.isPlaylistItem || false,
        playlistIndex: itemData.playlistIndex || null,
      });

      let targetDir;
      if (
        isPlaylistItem &&
        itemData.playlistFolderPath &&
        fs.existsSync(itemData.playlistFolderPath)
      ) {
        targetDir = itemData.playlistFolderPath;
        logger.info(`[${itemId}] 📁 Using playlist folder: ${targetDir}`);
      } else if (
        settings &&
        settings.downloadFolder &&
        settings.downloadFolder.trim() !== "" &&
        fs.existsSync(settings.downloadFolder)
      ) {
        targetDir = settings.downloadFolder;
        logger.info(`[${itemId}] 📁 Using settings folder: ${targetDir}`);
      } else if (
        settings &&
        settings.downloadFolder &&
        settings.downloadFolder.trim() !== ""
      ) {
        // User specified a folder but it doesn't exist yet - create it
        try {
          fs.mkdirSync(settings.downloadFolder, { recursive: true });
          targetDir = settings.downloadFolder;
          logger.info(
            `[${itemId}] 📁 Created and using settings folder: ${targetDir}`,
          );
        } catch (mkdirError) {
          logger.error(
            `[${itemId}] Failed to create download folder ${settings.downloadFolder}:`,
            mkdirError,
          );
          targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
          logger.info(
            `[${itemId}] 📁 Fallback to default folder: ${targetDir}`,
          );
        }
      } else {
        targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
        logger.info(
          `[${itemId}] 📁 Using default folder (no settings folder specified): ${targetDir}`,
        );
      }

      if (!isPlaylistItem || !itemData.playlistFolderPath) {
        targetDir = await ensureOrganizedTargetDir({
          fs,
          baseDir: targetDir,
          videoUrl,
          videoInfo,
          playlistTitle: itemData.playlistTitle,
          isPlaylistItem,
          settings,
        });
      }

      const finalBaseFilename = sanitizeFilename(currentVideoTitle);

      // Helper to generate unique filename - ALWAYS ensures no file is overwritten
      // Excludes temp files (.part, .ytdl, .temp, .f*.m4a, .f*.webm) from duplicate detection
      function getUniqueFilename(baseName, dir, targetExt) {
        const glob = require("glob");

        // Get all files with this base name, but filter out temp/partial files
        const allMatches = glob.sync(`${baseName}.*`, { cwd: dir });
        const tempExtensions = [".part", ".ytdl", ".temp"];
        const existingFiles = allMatches.filter((f) => {
          const ext = path.extname(f).toLowerCase();
          // Exclude temp files and fragment files (like .f140.m4a)
          return !tempExtensions.includes(ext) && !f.match(/\.f\d+\./);
        });

        if (existingFiles.length === 0) {
          return baseName;
        }

        // Files exist - find unique name that doesn't conflict with completed downloads
        let counter = 1;
        let uniqueName = `${baseName} (${counter})`;
        while (true) {
          const matches = glob.sync(`${uniqueName}.*`, { cwd: dir });
          const realFiles = matches.filter((f) => {
            const ext = path.extname(f).toLowerCase();
            return !tempExtensions.includes(ext) && !f.match(/\.f\d+\./);
          });
          if (realFiles.length === 0) break;
          counter++;
          uniqueName = `${baseName} (${counter})`;
        }
        logger.info(
          `[${itemId}] File exists with base name "${baseName}", using unique name: ${uniqueName}`,
        );
        return uniqueName;
      }

      let outputTemplate;
      if (isPlaylistItem && itemData.playlistFolderPath) {
        if (settings.numerateFiles && playlistIndex !== null) {
          const displayIndex = (playlistIndex + 1).toString();
          const numberedBase = `${displayIndex}_${finalBaseFilename}`;
          const uniqueBase = getUniqueFilename(numberedBase, targetDir, format);
          outputTemplate = path.join(targetDir, `${uniqueBase}.%(ext)s`);
        } else {
          const uniqueBase = getUniqueFilename(
            finalBaseFilename,
            targetDir,
            format,
          );
          outputTemplate = path.join(targetDir, `${uniqueBase}.%(ext)s`);
        }
      } else {
        const uniqueBase = getUniqueFilename(
          finalBaseFilename,
          targetDir,
          format,
        );
        outputTemplate = path.join(targetDir, `${uniqueBase}.%(ext)s`);
      }

      // Store outputTemplate for pause/resume functionality
      itemProcInfo.outputTemplate = outputTemplate;
      markDirty();

      sendMessageToClient(clientId, {
        type: "status",
        message: "Starting optimized download...",
        itemId,
        source,
      });

      const audioFormats = ["mp3", "wav", "m4a", "opus", "flac"];
      const videoFormats = ["mp4", "mkv", "mov", "webm"];

      // Ensure WEBM is always treated as video, never audio
      if (audioFormats.includes(format) && format !== "webm") {
        const finalOutputFilename = outputTemplate.replace("%(ext)s", format);

        let audioArgs = [
          "--extract-audio",
          "--audio-format",
          format,
          "--no-playlist",
          "-o",
          outputTemplate,
          videoUrl,
        ];

        // Audio quality settings - some formats have different handling
        if (format === "flac") {
          // FLAC is lossless, no quality setting needed
          audioArgs.push("--audio-quality", "0");
        } else if (format === "wav") {
          // WAV is typically uncompressed, but we can still specify
          audioArgs.push("--audio-quality", "0");
        } else if (
          quality &&
          quality !== "highest" &&
          !isNaN(parseInt(quality))
        ) {
          audioArgs.push("--audio-quality", quality + "K");
        } else {
          audioArgs.push("--audio-quality", "0");
        }

        // Always embed metadata and thumbnail for audio formats
        audioArgs.push("--embed-metadata");
        audioArgs.push("--add-metadata"); // Comprehensive tagging for Windows Explorer
        audioArgs.push("--embed-thumbnail"); // Embed thumbnail into audio file (MP3, M4A support this)

        if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
          audioArgs.unshift("--limit-rate", `${settings.maxSpeed}K`);
          logger.info(
            `[${itemId}] 🚦 SPEED LIMIT APPLIED: ${settings.maxSpeed}K (KB/s)`,
          );
        } else {
          logger.info(
            `[${itemId}] 🚦 SPEED LIMIT: None (maxSpeed=${settings.maxSpeed})`,
          );
        }

        // ALWAYS prevent overwrites to protect existing files
        audioArgs.unshift("--no-overwrites");

        const result = await runYtDlpCommand(
          clientId,
          audioArgs,
          itemId,
          false,
          itemProcInfo,
        );

        // Check if download was paused or cancelled
        if (result.wasPaused || itemProcInfo.paused) {
          logger.info(`[${itemId}] ⏸️ Audio download paused - returning early`);
          return;
        }
        if (result.wasCancelled || itemProcInfo.cancelled) {
          logger.info(
            `[${itemId}] ❌ Audio download cancelled - returning early`,
          );
          return;
        }

        finalFilePathValue = result.actualPath || finalOutputFilename;
      } else if (videoFormats.includes(format)) {
        // ==================== QUALITY NORMALIZATION ====================
        // Map string quality values to numeric heights
        // Prevents parseInt("4k") → 4 bug
        const qualityMap = {
          "4k": 2160,
          "2160p": 2160,
          "2k": 1440,
          "1440p": 1440,
          "1080p": 1080,
          "720p": 720,
          "480p": 480,
          "360p": 360,
          "240p": 240,
          highest: 2160,
        };

        let targetHeight;
        const qualityLower = (quality || "").toString().toLowerCase().trim();

        if (qualityLower === "highest" || qualityLower === "") {
          // HIGHEST MODE: Always target 4K+ and use MKV container
          // Don't cap based on availableQualities - that can be unreliable
          // Let yt-dlp's bestvideo selector pick the actual best available
          targetHeight = 4320; // 8K ceiling - ensures MKV container and 4K format selector
          logger.info(
            `[${itemId}] 🎯 HIGHEST MODE: Using uncapped target (${targetHeight}p) to ensure best quality`,
          );
        } else if (qualityMap[qualityLower]) {
          targetHeight = qualityMap[qualityLower];
        } else {
          const parsed = parseInt(quality);
          if (!isNaN(parsed) && parsed >= 144 && parsed <= 8640) {
            targetHeight = parsed;
          } else {
            logger.error(
              `[${itemId}] ❌ INVALID QUALITY VALUE: "${quality}" - cannot parse to valid resolution`,
            );
            throw new Error(
              `Invalid quality value: "${quality}". Expected numeric resolution (e.g., 1080, 2160) or preset (4k, 2k, highest)`,
            );
          }
        }

        logger.info(
          `[${itemId}] 🎯 QUALITY NORMALIZATION: input="${quality}" → targetHeight=${targetHeight}`,
        );

        // ==================== CONTAINER FORMAT SELECTION ====================
        // Use the user-selected format directly
        const containerFormat = format;

        logger.info(
          `[${itemId}] 📦 CONTAINER SELECTION: targetHeight=${targetHeight}, container=${containerFormat}`,
        );
        const finalOutputFilename = outputTemplate.replace(
          "%(ext)s",
          containerFormat,
        );

        // ==================== PROPER YT-DLP FORMAT SELECTORS ====================
        // Using correct bracket syntax with explicit resolution filters
        // Each selector chain ends with /best as ultimate fallback
        let formatString;
        let sortOrder;

        // Filter to exclude auto-dubbed/translated audio: exclude tracks with asr=1 (auto-generated)
        const originalAudioFilter = "[asr!=1]";

        // For MOV and WEBM, use simpler format selectors to ensure compatibility
        if (containerFormat === "mov") {
          // MOV works best with H.264/H.265 codecs
          if (targetHeight >= 2160) {
            formatString = `bestvideo*[vcodec^=avc][ext=mp4]+bestaudio${originalAudioFilter}[ext=m4a]/bestvideo*[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[vcodec^=hevc][ext=mp4]+bestaudio${originalAudioFilter}[ext=m4a]/bestvideo*[vcodec^=hevc][ext=mp4]+bestaudio[ext=m4a]/bestvideo*[ext=mp4]+bestaudio${originalAudioFilter}[ext=m4a]/bestvideo*[ext=mp4]+bestaudio[ext=m4a]/best`;
            sortOrder = "res,tbr,vcodec:h264,vcodec:hevc";
          } else {
            formatString = `bv*[height<=${targetHeight}][vcodec^=avc][ext=mp4]+ba${originalAudioFilter}[ext=m4a]/bv*[height<=${targetHeight}][vcodec^=avc][ext=mp4]+ba[ext=m4a]/bv*[height<=${targetHeight}][vcodec^=hevc][ext=mp4]+ba${originalAudioFilter}[ext=m4a]/bv*[height<=${targetHeight}][vcodec^=hevc][ext=mp4]+ba[ext=m4a]/bv*[height<=${targetHeight}][ext=mp4]+ba${originalAudioFilter}[ext=m4a]/bv*[height<=${targetHeight}][ext=mp4]+ba[ext=m4a]/best`;
            sortOrder = "res,tbr,vcodec:h264,vcodec:hevc";
          }
          logger.info(
            `[${itemId}] 📺 FORMAT: MOV MODE - Selector: ${formatString}`,
          );
        } else if (containerFormat === "webm") {
          // WEBM works best with VP8/VP9 codecs
          if (targetHeight >= 2160) {
            formatString = `bestvideo*[vcodec^=vp9]+bestaudio${originalAudioFilter}[acodec^=opus]/bestvideo*[vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo*[vcodec^=vp8]+bestaudio${originalAudioFilter}[acodec^=vorbis]/bestvideo*[vcodec^=vp8]+bestaudio[acodec^=vorbis]/bestvideo*[vcodec^=vp9]+bestaudio${originalAudioFilter}/bestvideo*[vcodec^=vp9]+bestaudio/best`;
            sortOrder = "res,tbr,vcodec:vp9,vcodec:vp8";
          } else {
            formatString = `bv*[height<=${targetHeight}][vcodec^=vp9]+ba${originalAudioFilter}[acodec^=opus]/bv*[height<=${targetHeight}][vcodec^=vp9]+ba[acodec^=opus]/bv*[height<=${targetHeight}][vcodec^=vp8]+ba${originalAudioFilter}[acodec^=vorbis]/bv*[height<=${targetHeight}][vcodec^=vp8]+ba[acodec^=vorbis]/bv*[height<=${targetHeight}][vcodec^=vp9]+ba${originalAudioFilter}/bv*[height<=${targetHeight}][vcodec^=vp9]+ba/best`;
            sortOrder = "res,tbr,vcodec:vp9,vcodec:vp8";
          }
          logger.info(
            `[${itemId}] 📺 FORMAT: WEBM MODE - Selector: ${formatString}`,
          );
        } else if (targetHeight >= 2160) {
          // 4K+ / HIGHEST MODE: Prefer original audio, fallback to any audio
          formatString = `bestvideo*+bestaudio${originalAudioFilter}/bestvideo*+bestaudio/best`;
          sortOrder = "res,tbr,vcodec:av01,vcodec:vp9.2,vcodec:vp9,vcodec:h264";
          logger.info(
            `[${itemId}] 📺 FORMAT: HIGHEST/4K+ MODE - Selector: ${formatString}`,
          );
        } else if (targetHeight >= 1440) {
          // 2K (1440p): Prefer 1440p → 1080p → bestvideo+original audio → best
          formatString = `bv*[height=1440]+ba${originalAudioFilter}/bv*[height=1440]+ba/bv*[height>=1440]+ba${originalAudioFilter}/bv*[height>=1440]+ba/bv*[height>=1080]+ba${originalAudioFilter}/bv*[height>=1080]+ba/bestvideo*+bestaudio${originalAudioFilter}/bestvideo*+bestaudio/best`;
          sortOrder = "res,tbr,vcodec:av01,vcodec:vp9.2,vcodec:vp9,vcodec:h264";
          logger.info(
            `[${itemId}] 📺 FORMAT: 2K MODE - Selector: ${formatString}`,
          );
        } else {
          // 1080p and below: Prefer H.264/MP4 → any video+original audio → best
          formatString = `bv*[height<=${targetHeight}][ext=mp4][vcodec^=avc]+ba${originalAudioFilter}[ext=m4a]/bv*[height<=${targetHeight}][ext=mp4][vcodec^=avc]+ba[ext=m4a]/bv*[height<=${targetHeight}][ext=mp4]+ba${originalAudioFilter}[ext=m4a]/bv*[height<=${targetHeight}][ext=mp4]+ba[ext=m4a]/bv*[height<=${targetHeight}]+ba${originalAudioFilter}/bv*[height<=${targetHeight}]+ba/bestvideo*+bestaudio${originalAudioFilter}/bestvideo*+bestaudio/best`;
          sortOrder = `res,tbr,vcodec:h264,ext:mp4`;
          logger.info(
            `[${itemId}] 📺 FORMAT: STANDARD MODE (${targetHeight}p) - Selector: ${formatString}`,
          );
        }

        // CRITICAL: Use fixed extension in output path, not %(ext)s
        // This ensures the file always ends with the correct extension
        const fixedOutputTemplate = outputTemplate.replace(
          "%(ext)s",
          containerFormat,
        );

        let videoArgs = [
          "-f",
          formatString,
          "-S",
          sortOrder, // Sort formats by resolution preference, then bitrate
          "--merge-output-format",
          containerFormat,
          "--embed-metadata", // Embed metadata (title, artist, etc.)
          "--add-metadata", // Ensure comprehensive tagging for Windows Explorer
        ];

        // Embed chapters and thumbnail (no separate thumbnail file)
        if (containerFormat !== "mov" && containerFormat !== "webm") {
          videoArgs.push("--embed-chapters", "--embed-thumbnail");
        } else {
          // MOV/WEBM: chapters only (thumbnail embedding not well supported)
          videoArgs.push("--embed-chapters");
        }

        const subtitleArgs = buildSubtitleArgs(settings, containerFormat);
        if (subtitleArgs.length > 0) {
          videoArgs.push(...subtitleArgs);
        }

        videoArgs.push(
          // NOTE: Removed --no-overwrites here because getUniqueFilename() already ensures unique names
          "--no-playlist",
          "-o",
          fixedOutputTemplate, // Use fixed extension template
          videoUrl,
        );

        if (settings.maxSpeed && parseInt(settings.maxSpeed) > 0) {
          videoArgs.unshift("--limit-rate", `${settings.maxSpeed}K`);
          logger.info(
            `[${itemId}] 🚦 SPEED LIMIT APPLIED: ${settings.maxSpeed}K (KB/s)`,
          );
        } else {
          logger.info(
            `[${itemId}] 🚦 SPEED LIMIT: None (maxSpeed=${settings.maxSpeed})`,
          );
        }

        const qualityText =
          quality === "highest"
            ? `highest available quality (${containerFormat.toUpperCase()})`
            : `${quality}p with highest bitrate (${containerFormat.toUpperCase()})`;
        sendMessageToClient(clientId, {
          type: "status",
          message: `Downloading in ${qualityText}...`,
          itemId,
          source,
        });

        // VERBOSE LOGGING for debugging 4K issues
        logger.info(`[${itemId}] ========== VIDEO DOWNLOAD DEBUG ==========`);
        logger.info(`[${itemId}] Quality requested: ${quality}`);
        logger.info(`[${itemId}] Target height: ${targetHeight}`);
        logger.info(`[${itemId}] Container format: ${containerFormat}`);
        logger.info(`[${itemId}] Format string: ${formatString}`);
        logger.info(`[${itemId}] Sort order: ${sortOrder}`);
        logger.info(`[${itemId}] Output template: ${fixedOutputTemplate}`);
        logger.info(
          `[${itemId}] Full video args:`,
          JSON.stringify(videoArgs, null, 2),
        );
        logger.info(`[${itemId}] ============================================`);

        const result = await runYtDlpCommand(
          clientId,
          videoArgs,
          itemId,
          false,
          itemProcInfo,
        );

        // Check if download was paused or cancelled
        if (result.wasPaused || itemProcInfo.paused) {
          logger.info(`[${itemId}] ⏸️ Video download paused - returning early`);
          return;
        }
        if (result.wasCancelled || itemProcInfo.cancelled) {
          logger.info(
            `[${itemId}] ❌ Video download cancelled - returning early`,
          );
          return;
        }

        finalFilePathValue = result.actualPath || finalOutputFilename;

        // ==================== NO FALLBACK - EXPLICIT ERROR ====================
        // If yt-dlp didn't return a path and expected file doesn't exist, fail explicitly
        if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
          logger.error(`[${itemId}] ❌ DOWNLOAD FAILED - File not found`);
          logger.error(`[${itemId}] Expected path: ${finalOutputFilename}`);
          logger.error(`[${itemId}] Returned path: ${actualPath}`);
          logger.error(`[${itemId}] Target directory: ${targetDir}`);

          // List files in target directory for debugging
          try {
            const dirContents = fs.readdirSync(targetDir);
            logger.error(
              `[${itemId}] 📁 Files in target directory (${dirContents.length} total):`,
            );
            dirContents
              .slice(0, 20)
              .forEach((f) => logger.error(`[${itemId}]    - ${f}`));
            if (dirContents.length > 20) {
              logger.error(
                `[${itemId}]    ... and ${dirContents.length - 20} more files`,
              );
            }
          } catch (dirErr) {
            logger.error(
              `[${itemId}] Could not list directory: ${dirErr.message}`,
            );
          }

          throw new Error(
            `Download failed: yt-dlp completed but output file was not created. Expected: ${path.basename(finalOutputFilename)}. Check format selector compatibility with this video.`,
          );
        }

        logger.info(
          `[${itemId}] ✅ Download successful: ${finalFilePathValue}`,
        );
      } else {
        throw new Error(`Unsupported format: ${format}`);
      }

      if (itemProcInfo.cancelled) {
        logger.info(`[${itemId}] Cancelled after download.`);
        return;
      }

      sendMessageToClient(clientId, {
        type: "progress",
        percent: 100,
        speedBytesPerSec: null,
        itemId,
      });

      if (!finalFilePathValue || !fs.existsSync(finalFilePathValue)) {
        throw new Error(
          "Processing failed, final file not found at: " + finalFilePathValue,
        );
      }

      try {
        const now = new Date();
        fs.utimesSync(finalFilePathValue, now, now);
      } catch (e) {
        logger.error(`[${itemId}] Failed to set file modification time:`, e);
      }

      const actualFinalFilenameDisplay = path.basename(finalFilePathValue);

      try {
        await clearFailedDownload(itemId);
        const payload = await downloadCompletionService.createPayloadFromFileStats({
          expectedFormat: format,
          itemId,
          source,
          targetDir,
          finalFilePath: finalFilePathValue,
          itemData,
          itemProcInfo,
          title: currentVideoTitle || actualFinalFilenameDisplay,
          message: "Download complete!",
        });

        await downloadCompletionService.sendAndRecord(clientId, payload);
      } catch (e) {
        logger.error(`[${itemId}] Stat error for ${finalFilePathValue}:`, e);
      }
    } catch (error) {
      if (!itemProcInfo.cancelled) {
        logger.error(
          `[${itemId}] Error in processVideo for ${videoUrl}:`,
          error,
        );

        const errorMsg = error.message || "";
        const retryAttempt = Number(itemData.retryCount || 0);
        const siteKey =
          itemProcInfo.videoInfo?.siteKey ||
          itemData.siteKey ||
          getSiteKeyFromUrl(videoUrl);
        const classification =
          error.classification ||
          classifyRuntimeError({
            hasCookies: errorMsg.toLowerCase().includes("cookie"),
            message: errorMsg,
            siteKey,
          });

        if (
          classification.retryable ||
          shouldSmartRetry({
            message: errorMsg,
            attempt: retryAttempt,
            maxAttempts: Number(settings.smartRetryAttempts || 3),
            smartRetryEnabled: settings.smartRetry !== false,
          })
        ) {
          const siteFailures = (siteRetryState.get(siteKey) || 0) + 1;
          siteRetryState.set(siteKey, siteFailures);
          const delayMs = computeSiteRetryDelayMs({
            siteKey,
            attempt: retryAttempt + 1,
            siteFailures,
          });
          const nextRetryItemData = {
            ...itemData,
            retryCount: retryAttempt + 1,
          };
          downloadQueue.set(itemId, nextRetryItemData);
          sendMessageToClient(clientId, {
            type: "status",
            message:
              classification.category === "rate_limit"
                ? `Retrying in ${Math.ceil(delayMs / 1000)}s with rate-limit safe pacing (attempt ${retryAttempt + 1}/${Number(settings.smartRetryAttempts || 3)}).`
                : `Retrying in ${Math.ceil(delayMs / 1000)}s due to a temporary ${siteKey} issue (attempt ${retryAttempt + 1}/${Number(settings.smartRetryAttempts || 3)}).`,
            itemId,
            source,
          });
          setTimeout(() => {
            if (!downloadQueue.has(itemId)) {
              return;
            }
            const runRetry = async () => {
              await processVideo(clientId, itemId, nextRetryItemData);
            };
            if (itemData.isPlaylistItem) {
              playlistItemProcessingLimit(runRetry);
            } else {
              singleVideoProcessingLimit(runRetry);
            }
          }, delayMs);
          return;
        }

        await storeFailedDownload(itemId, {
          clientId,
          videoUrl,
          format,
          quality,
          source,
          title: currentVideoTitle,
          message: classification.userMessage || errorMsg,
          failedAt: new Date().toISOString(),
          attempt: retryAttempt,
          siteKey,
          playlistAction: itemData.isPlaylistItem ? "full" : "single",
          concurrency: settings.concurrency || 1,
          singleConcurrency: settings.singleConcurrency || 1,
          settings,
        });

        sendMessageToClient(clientId, {
          type: "error",
          message: classification.userMessage || `Failed: ${error.message}`,
          itemId,
          source,
        });
      } else {
        logger.info(
          `[${itemId}] Processing stopped due to cancellation for ${videoUrl}.`,
        );
        sendMessageToClient(clientId, {
          type: "cancel_confirm",
          message: "Processing stopped due to cancellation.",
          itemId,
          source,
        });
      }
    } finally {
      // SAFE CLEANUP: Only delete specific temp files that we tracked during this download
      // Never use broad glob patterns that could match other files
      const safeMediaExtensions =
        /\.(mp3|mp4|webm|m4a|mkv|avi|flv|mov|wmv|ogg)$/i;

      itemProcInfo.tempFiles.forEach((trackedFile) => {
        // Only process if this is an actual file path (not a pattern)
        if (!trackedFile || trackedFile.includes("*")) {
          logger.info(
            `[${itemId}] Skipping cleanup of pattern: ${trackedFile}`,
          );
          return;
        }

        // Check if file exists and is a temp file (not a completed media file)
        if (fs.existsSync(trackedFile)) {
          const ext = path.extname(trackedFile).toLowerCase();

          // Never delete completed media files
          if (safeMediaExtensions.test(trackedFile)) {
            logger.info(`[${itemId}] Preserving media file: ${trackedFile}`);
            return;
          }

          // Only delete known temp extensions
          if ([".part", ".ytdl", ".temp"].includes(ext)) {
            try {
              fs.unlinkSync(trackedFile);
              logger.info(`[${itemId}] Cleaned up temp file: ${trackedFile}`);
            } catch (e) {
              logger.error(
                `[${itemId}] Error cleaning up temp file ${trackedFile}:`,
                e,
              );
            }
          }
        }
      });

      activeProcesses.delete(itemId);
    }
  }

      // Legacy site-specific path removed - use the unified processVideo flow for all supported sites

  async function getPlaylistItems(clientId, playlistUrl, playlistMetaId) {
    return playlistService.getPlaylistItems(
      clientId,
      playlistUrl,
      playlistMetaId,
    );
  }

  async function getPlaylistTitle(clientId, playlistUrl, playlistMetaId) {
    return playlistService.getPlaylistTitle(
      clientId,
      playlistUrl,
      playlistMetaId,
    );
  }

  // ==================== COOKIE MANAGEMENT ====================
  const COOKIE_PATH_CACHE_TTL_MS = 5000;
  const ADAPTIVE_THROTTLE_COOLDOWN_MS = 15 * 60 * 1000;
  let cachedCookiesPathResult = {
    checkedAt: 0,
    path: null,
  };
  let cachedCookieValidationResult = {
    path: null,
    size: 0,
    mtimeMs: 0,
    isValid: false,
  };
  let slowerDownloadModeUntil = 0;

  function markSlowerDownloadMode(reason, itemId) {
    slowerDownloadModeUntil = Date.now() + ADAPTIVE_THROTTLE_COOLDOWN_MS;
    logger.warn(
      `[${itemId}] Slower download pacing enabled for ${Math.round(
        ADAPTIVE_THROTTLE_COOLDOWN_MS / 60000,
      )} minutes due to ${reason}.`,
    );
  }

  function getDownloadPacingProfile() {
    if (Date.now() < slowerDownloadModeUntil) {
      return {
        name: "rate-limit-safe",
        concurrentFragments: "4",
        sleepRequests: "0.85",
        sleepInterval: "1",
        maxSleepInterval: "2",
      };
    }

    return {
      name: "balanced-fast",
      concurrentFragments: "6",
      sleepRequests: "0.35",
      sleepInterval: null,
      maxSleepInterval: null,
    };
  }

  async function getCookiesPath() {
    const now = Date.now();
    if (now - cachedCookiesPathResult.checkedAt < COOKIE_PATH_CACHE_TTL_MS) {
      return cachedCookiesPathResult.path;
    }

    const cookiesDir = env.COOKIES_DIR || path.join(writableDataRoot, "cookies");
    const cookiesPath = path.join(cookiesDir, "cookies.txt");

    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true, mode: 0o700 });
      logger.info("[getCookiesPath] 📁 Created cookies directory:", cookiesDir);
    }

    if (fs.existsSync(cookiesPath)) {
      const stats = fs.statSync(cookiesPath);
      if (stats.size > 50) {
        cachedCookiesPathResult = {
          checkedAt: now,
          path: cookiesPath,
        };
        return cookiesPath;
      }
    }

    cachedCookiesPathResult = {
      checkedAt: now,
      path: null,
    };
    return null;
  }

  async function validateCookiesFile(filePath, fileStats = null) {
    try {
      const stats = fileStats || fs.statSync(filePath);
      if (
        cachedCookieValidationResult.path === filePath &&
        cachedCookieValidationResult.size === stats.size &&
        cachedCookieValidationResult.mtimeMs === stats.mtimeMs
      ) {
        return cachedCookieValidationResult.isValid;
      }

      const content = fs.readFileSync(filePath, "utf8").trim();
      let isValid = true;

      if (!content || content.length < 10) {
        isValid = false;
      }

      let nonCommentLines = [];
      if (isValid) {
        const lines = content.split("\n");
        nonCommentLines = lines.filter((line) => {
          const trimmed = line.trim();
          return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
        });

        if (nonCommentLines.length === 0) {
          isValid = false;
        }

        const hasValidIndicator =
          content.toLowerCase().includes("youtube") ||
          content.toLowerCase().includes("google") ||
          content.includes("\t") ||
          content.includes(".com") ||
          nonCommentLines.length >= 3;

        if (!hasValidIndicator) {
          isValid = false;
        }
      }

      cachedCookieValidationResult = {
        path: filePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        isValid,
      };
      return isValid;
    } catch (e) {
      logger.error(
        `[validateCookiesFile] Error validating ${filePath}:`,
        e.message,
      );
      return false;
    }
  }

  // ==================== RESUME-SPECIFIC VIDEO PROCESSOR ====================
  // Handles resumed downloads with --continue flag and proper .part file detection
  async function processVideoWithResume(clientId, itemId, itemData) {
    logger.info(`[${itemId}] ▶️ Processing resumed download...`);

    const {
      videoUrl,
      format,
      quality,
      source,
      settings,
      isPlaylistItem,
      playlistIndex,
      resumed,
      resumeAttempts,
      useNoContinue,
    } = itemData;
    let currentVideoTitle = itemData.title || "video";
    let tempFilesCreated = [];

    // Create process tracking info and store itemData for pause functionality
    const itemProcInfo = {
      ytdlpProc: null,
      ffmpegProc: null,
      tempFiles: tempFilesCreated,
      cancelled: false,
      paused: false,
      // Store all item data for potential re-pause
      itemData: { ...itemData },
      videoUrl,
      format,
      quality,
      source,
      settings,
      title: currentVideoTitle,
    };
    activeProcesses.set(itemId, itemProcInfo);

    try {
      if (itemProcInfo.cancelled || itemProcInfo.paused) {
        logger.info(`[${itemId}] Pre-cancelled/paused processVideoWithResume.`);
        return;
      }

      // For resumed downloads, we might already have the title
      // Only fetch info if we don't have it or need to update UI
      if (
        !currentVideoTitle ||
        currentVideoTitle === "video" ||
        currentVideoTitle === "Paused download"
      ) {
        try {
          const videoInfo = await getVideoInfo(
            clientId,
            videoUrl,
            itemId,
            quality,
            format,
          );
          currentVideoTitle = videoInfo.title || currentVideoTitle;
          itemProcInfo.title = currentVideoTitle;
          itemProcInfo.thumbnail = videoInfo.thumbnail; // Store thumbnail for complete message
          markDirty();

          sendMessageToClient(clientId, {
            type: "item_info",
            itemId,
            title: currentVideoTitle,
            source,
            format: format,
            quality: quality,
            thumbnail: videoInfo.thumbnail,
            isPlaylistItem: itemData.isPlaylistItem || false,
            playlistIndex: itemData.playlistIndex || null,
          });
        } catch (infoError) {
          logger.info(
            `[${itemId}] Could not fetch video info on resume, using existing title`,
          );
        }
      } else {
        // Just send status update
        sendMessageToClient(clientId, {
          type: "status",
          message: `Resuming: ${currentVideoTitle}`,
          itemId,
          source,
        });
      }

      // Determine target directory
      let targetDir;
      if (
        isPlaylistItem &&
        itemData.playlistFolderPath &&
        fs.existsSync(itemData.playlistFolderPath)
      ) {
        targetDir = itemData.playlistFolderPath;
      } else if (
        settings &&
        settings.downloadFolder &&
        settings.downloadFolder.trim() !== ""
      ) {
        targetDir = settings.downloadFolder;
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
      } else {
        targetDir = itemData.playlistFolderPath || DOWNLOAD_DIR;
      }

      // Use existing output template if available (CRITICAL for resume)
      // Otherwise generate a new one
      let outputTemplate = itemData.outputTemplate;
      if (!outputTemplate) {
        const finalBaseFilename = sanitizeFilename(currentVideoTitle);

        if (
          isPlaylistItem &&
          itemData.playlistFolderPath &&
          settings?.numerateFiles &&
          playlistIndex !== null
        ) {
          const displayIndex = (playlistIndex + 1).toString();
          outputTemplate = path.join(
            targetDir,
            `${displayIndex}_${finalBaseFilename}.%(ext)s`,
          );
        } else {
          outputTemplate = path.join(targetDir, `${finalBaseFilename}.%(ext)s`);
        }
      }

      // Store output template in process info for potential re-pause
      itemProcInfo.outputTemplate = outputTemplate;
      markDirty();

      logger.info(`[${itemId}] 📁 Resume output template: ${outputTemplate}`);

      // Check if .part files exist (indicates previous download was interrupted)
      const glob = require("glob");
      const templateDir = path.dirname(outputTemplate);
      const templateBase = path
        .basename(outputTemplate)
        .replace(".%(ext)s", "");
      const partFiles = glob.sync(`${templateBase}*.part`, {
        cwd: templateDir,
        absolute: true,
      });

      if (partFiles.length > 0) {
        logger.info(
          `[${itemId}] 📂 Found ${partFiles.length} .part files - will attempt to continue`,
        );
      } else {
        logger.info(`[${itemId}] ℹ️ No .part files found - will start fresh`);
      }

      sendMessageToClient(clientId, {
        type: "status",
        message: "Resuming download...",
        itemId,
        source,
      });

      // Build yt-dlp arguments for resume
      const audioFormats = ["mp3", "wav", "m4a", "opus", "flac"];
      const videoFormats = ["mp4", "mkv", "mov", "webm"];

      let ytdlpArgs = [];

      // CRITICAL: Add --continue flag for resume (or --no-continue if retry failed at same point)
      if (useNoContinue) {
        logger.info(
          `[${itemId}] ⚠️ Using --no-continue (retry attempt ${resumeAttempts})`,
        );
        ytdlpArgs.push("--no-continue");
      } else {
        ytdlpArgs.push("--continue"); // Explicitly enable continue mode
      }

      // Keep .part files for potential re-pause
      ytdlpArgs.push("--part");

      // Don't overwrite existing files
      ytdlpArgs.push("--no-overwrites");

      if (audioFormats.includes(format) && format !== "webm") {
        // Audio download
        ytdlpArgs.push(
          "--extract-audio",
          "--audio-format",
          format,
          "--no-playlist",
          "-o",
          outputTemplate,
          videoUrl,
        );

        if (format === "flac" || format === "wav") {
          ytdlpArgs.push("--audio-quality", "0");
        } else if (
          quality &&
          quality !== "highest" &&
          !isNaN(parseInt(quality))
        ) {
          ytdlpArgs.push("--audio-quality", quality + "K");
        } else {
          ytdlpArgs.push("--audio-quality", "0");
        }

        ytdlpArgs.push("--embed-metadata");
      } else if (videoFormats.includes(format)) {
        // Video download - use similar logic to processVideo
        const qualityMap = {
          "4k": 2160,
          "2160p": 2160,
          "2k": 1440,
          "1440p": 1440,
          "1080p": 1080,
          "720p": 720,
          "480p": 480,
          "360p": 360,
          "240p": 240,
          highest: 2160,
        };

        let targetHeight;
        const qualityLower = (quality || "").toString().toLowerCase().trim();

        if (qualityLower === "highest" || qualityLower === "") {
          targetHeight = 4320;
        } else if (qualityMap[qualityLower]) {
          targetHeight = qualityMap[qualityLower];
        } else {
          const parsed = parseInt(quality);
          targetHeight =
            !isNaN(parsed) && parsed >= 144 && parsed <= 8640 ? parsed : 1080;
        }

        const containerFormat = format;
        const finalOutputFilename = outputTemplate.replace(
          "%(ext)s",
          containerFormat,
        );

        // Format selector
        let formatString;
        if (targetHeight >= 2160) {
          formatString = `bestvideo[height<=${targetHeight}]+bestaudio/bestvideo+bestaudio/best`;
        } else {
          formatString = `bestvideo[height<=${targetHeight}]+bestaudio/bestvideo[height<=${targetHeight}]+bestaudio/best`;
        }

        ytdlpArgs.push(
          "-f",
          formatString,
          "-S",
          `res,tbr`,
          "--merge-output-format",
          containerFormat,
          "--no-playlist",
          "-o",
          outputTemplate,
          videoUrl,
        );
      }

      // Add speed limit if set
      if (settings?.maxSpeed && parseInt(settings.maxSpeed) > 0) {
        ytdlpArgs.unshift("--limit-rate", `${settings.maxSpeed}K`);
      }

      // Run yt-dlp with resume args
      try {
        const result = await runYtDlpCommand(
          clientId,
          ytdlpArgs,
          itemId,
          false,
          itemProcInfo,
        );

        // Check if paused or cancelled during download
        if (result.wasPaused || itemProcInfo.paused) {
          logger.info(`[${itemId}] ⏸️ Download paused during processing`);
          return;
        }
        if (result.wasCancelled || itemProcInfo.cancelled) {
          logger.info(`[${itemId}] ❌ Download cancelled during processing`);
          return;
        }

        sendMessageToClient(clientId, {
          type: "progress",
          percent: 100,
          speedBytesPerSec: null,
          itemId,
        });

        const finalPath =
          result.actualPath || outputTemplate.replace("%(ext)s", format);

        // Verify file exists
        if (fs.existsSync(finalPath)) {
          const payload =
            await downloadCompletionService.createPayloadFromFileStats({
            expectedFormat: format,
            itemId,
            source,
            targetDir,
            finalFilePath: finalPath,
            itemData,
            itemProcInfo,
            title: currentVideoTitle,
            message: "Download complete!",
          });
          await downloadCompletionService.sendAndRecord(clientId, payload);

          logger.info(
            `[${itemId}] ✅ Resume complete: ${finalPath} (${payload.actualSize})`,
          );
        } else {
          throw new Error("Output file not found after download");
        }
      } catch (downloadError) {
        // Check if it was paused (not a real error)
        if (itemProcInfo.paused) {
          logger.info(`[${itemId}] Download paused`);
          return;
        }

        logger.error(
          `[${itemId}] Resume download error:`,
          downloadError.message,
        );
        const classification =
          downloadError.classification ||
          classifyRuntimeError({
            hasCookies: downloadError.message?.toLowerCase().includes("cookie"),
            message: downloadError.message,
            siteKey: itemData.siteKey || getSiteKeyFromUrl(videoUrl),
          });
        sendMessageToClient(clientId, {
          type: "error",
          message: classification.userMessage || downloadError.message || "Resume failed",
          itemId,
          source,
        });
      }
    } catch (error) {
      logger.error(`[${itemId}] processVideoWithResume error:`, error);
      const classification =
        error.classification ||
        classifyRuntimeError({
          hasCookies: error.message?.toLowerCase().includes("cookie"),
          message: error.message,
          siteKey: itemData.siteKey || getSiteKeyFromUrl(videoUrl),
        });
      sendMessageToClient(clientId, {
        type: "error",
        message:
          classification.userMessage ||
          error.message ||
          "Resume processing failed",
        itemId,
        source,
      });
    } finally {
      activeProcesses.delete(itemId);
    }
  }

  // ==================== YT-DLP COMMAND RUNNER (OPTIMIZED) ====================
  async function runYtDlpCommand(
    clientId,
    baseArgs,
    itemId,
    suppressProgress = false,
    itemProcInfoRef = null,
  ) {
    const candidateUrl =
      itemProcInfoRef?.videoUrl ||
      baseArgs.find((arg) => /^https?:\/\//i.test(String(arg))) ||
      "";
    const siteKey = detectSiteKeyFromUrl(candidateUrl, itemProcInfoRef?.source);
    const isInfoOnly =
      suppressProgress ||
      baseArgs.includes("--print-json") ||
      baseArgs.includes("--print");
    const maxAttempts = siteKey === "youtube" ? (isInfoOnly ? 2 : 3) : 1;

    let attempt = 0;
    let lastError = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      siteRequestGuard.assertRequestAllowed(siteKey);
      if (attempt > 1) {
        await siteRequestGuard.waitForBackoff(siteKey, itemId);
      }

      try {
        const result = await runSingleYtDlpCommand(
          clientId,
          baseArgs,
          itemId,
          suppressProgress,
          itemProcInfoRef,
        );
        siteRequestGuard.recordSuccess(siteKey);
        if (siteRetryState.has(siteKey)) {
          siteRetryState.delete(siteKey);
        }
        return result;
      } catch (error) {
        const classification =
          error.classification ||
          classifyRuntimeError({
            hasCookies: String(error.message || "")
              .toLowerCase()
              .includes("cookie"),
            message: error.message,
            siteKey,
          });
        error.classification = classification;
        lastError = error;

        if (!classification.shouldBackoff || attempt >= maxAttempts) {
          break;
        }

        const backoff = siteRequestGuard.recordFailure(siteKey, classification);
        if (!suppressProgress) {
          sendMessageToClient(clientId, {
            type: "status",
            itemId,
            message: backoff.openedCircuit
              ? "YouTube protection opened a short cooldown to avoid further rate limiting."
              : `YouTube rate limiting detected. Retrying in ${Math.ceil(
                  backoff.retryDelayMs / 1000,
                )}s...`,
          });
        }
      }
    }

    throw lastError;
  }

  async function runSingleYtDlpCommand(
    clientId,
    baseArgs,
    itemId,
    suppressProgress = false,
    itemProcInfoRef = null,
  ) {
    logger.info(`[${itemId}] 🚀 Starting yt-dlp command...`);

    const requestUrl =
      itemProcInfoRef?.videoUrl ||
      baseArgs.find((arg) => /^https?:\/\//i.test(String(arg))) ||
      "";
    const siteKey = detectSiteKeyFromUrl(requestUrl, itemProcInfoRef?.source);
    const isInfoOnly =
      suppressProgress ||
      baseArgs.includes("--print-json") ||
      baseArgs.includes("--print");
    const cookieFilePath = await getCookiesPath();

    let cookieArgs = [];
    if (cookieFilePath) {
      try {
        const stats = fs.statSync(cookieFilePath);
        const isValid = await validateCookiesFile(cookieFilePath, stats);

        if (isValid) {
          logger.info(`[${itemId}] ✅ Using cookies for enhanced access`);
          cookieArgs = ["--cookies", cookieFilePath];

          if (!isInfoOnly) {
            cookieArgs.push("--extractor-retries", "3");
            sendMessageToClient(clientId, {
              type: "status",
              message: "🍪 Using cookies (optimized mode)",
              itemId,
            });
          }
        } else {
          logger.info(
            `[${itemId}] ⚠️ Cookies file found but appears invalid format`,
          );
          if (!isInfoOnly) {
            sendMessageToClient(clientId, {
              type: "status",
              message:
                "⚠️ Cookies found but invalid format. Using standard access...",
              itemId,
            });
          }
        }
      } catch (e) {
        logger.error(`[${itemId}] ❌ Cookie file error: ${e.message}`);
        if (!isInfoOnly) {
          sendMessageToClient(clientId, {
            type: "status",
            message: `❌ Cookie error: ${e.message}`,
            itemId,
          });
        }
      }
    } else if (!isInfoOnly) {
      logger.info(
        `[${itemId}] ℹ️ No cookies file found - using standard requests`,
      );
      sendMessageToClient(clientId, {
        type: "status",
        message: "ℹ️ No cookies found - add cookies for enhanced access",
        itemId,
      });
    }

    // OPTIMIZED ARGS - Different settings for info vs downloads
    const finalArgs = [
      ...cookieArgs,
      ...baseArgs,
      "--ffmpeg-location",
      ffmpegExecutable, // CRITICAL: Enables stream merging for 4K
      "--encoding",
      "utf-8",
      "--no-colors",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ];

    // DETERMINISTIC JS RUNTIME: Force yt-dlp to use ONLY our bundled Node binary
    // This prevents "user has Deno installed" situations from affecting behavior
    if (nodeExecutable && fs.existsSync(nodeExecutable)) {
      finalArgs.push("--no-js-runtimes"); // Clear all defaults first
      finalArgs.push("--js-runtimes", `node:${nodeExecutable}`); // Then set our bundled binary
      logger.info(
        `[${itemId}] ✅ Using bundled Node runtime: ${nodeExecutable}`,
      );
    } else {
      logger.warn(
        `[${itemId}] ⚠️ NODE_BINARY not available. High-res extraction may be limited.`,
      );
      // If cookies are being used and Node is missing, this is a critical issue
      if (cookieArgs.length > 0) {
        logger.error(
          `[${itemId}] ❌ CRITICAL: Cookies require Node runtime for signature extraction!`,
        );
      }
    }

    if (isInfoOnly) {
      // Fast settings for info - no throttles
      finalArgs.push(
        "--retries",
        "2",
        "--extractor-retries",
        "2",
        "--socket-timeout",
        "20",
        "--no-warnings",
      );
    } else {
      // Adaptive download pacing: start faster, only slow down after actual rate limiting.
      const pacingProfile = getDownloadPacingProfile();
      logger.info(
        `[${itemId}] Using ${pacingProfile.name} yt-dlp pacing profile.`,
      );

      finalArgs.push(
        "--retries",
        "5",
        "--fragment-retries",
        "4",
        "--retry-sleep",
        "linear=1::2",
        "--concurrent-fragments",
        pacingProfile.concurrentFragments,
        "--buffer-size",
        "256K", // INCREASED from 64K to 256K
        "--socket-timeout",
        "45", // Prevents hanging
        "--http-chunk-size",
        "10M", // Better chunk handling
        "--sleep-requests",
        pacingProfile.sleepRequests,
        // NOTE: Removed --no-part to allow .part files for interrupted downloads
        // This prevents corrupt "complete" files and allows proper resume/cleanup
        // Browser-like headers for anti-bot
        "--add-header",
        "Accept-Language:en-US,en;q=0.9",
        "--add-header",
        "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "--add-header",
        "Accept-Encoding:gzip, deflate, br",
        "--add-header",
        "DNT:1",
        "--add-header",
        "Connection:keep-alive",
        "--add-header",
        "Upgrade-Insecure-Requests:1",
      );

      if (pacingProfile.sleepInterval && pacingProfile.maxSleepInterval) {
        finalArgs.push(
          "--sleep-interval",
          pacingProfile.sleepInterval,
          "--max-sleep-interval",
          pacingProfile.maxSleepInterval,
        );
      }
    }

    if (!suppressProgress) finalArgs.push("--progress", "--newline");

    const shouldLogFullCommand =
      logger.level === "debug" || !isInfoOnly;
    if (shouldLogFullCommand) {
      logger.info(`[${itemId}] ======================================`);
      logger.info(`[${itemId}] 🚀 YT-DLP FULL COMMAND DEBUG`);
      logger.info(`[${itemId}] Executable: ${ytdlpExecutable}`);
      logger.info(`[${itemId}] Args count: ${finalArgs.length}`);

      const formatIndex = finalArgs.indexOf("-f");
      if (formatIndex !== -1 && finalArgs[formatIndex + 1]) {
        logger.info(
          `[${itemId}] 📺 FORMAT SELECTOR (-f): ${finalArgs[formatIndex + 1]}`,
        );
      }

      const mergeIndex = finalArgs.indexOf("--merge-output-format");
      if (mergeIndex !== -1 && finalArgs[mergeIndex + 1]) {
        logger.info(
          `[${itemId}] 📦 MERGE FORMAT: ${finalArgs[mergeIndex + 1]}`,
        );
      }

      const outputIndex = finalArgs.indexOf("-o");
      if (outputIndex !== -1 && finalArgs[outputIndex + 1]) {
        logger.info(
          `[${itemId}] 📁 OUTPUT TEMPLATE: ${finalArgs[outputIndex + 1]}`,
        );
      }

      logger.info(`[${itemId}] 📋 FULL ARGS:`);
      logger.info(JSON.stringify(finalArgs, null, 2));
      logger.info(`[${itemId}] ======================================`);
    } else {
      logger.info(
        `[${itemId}] Starting lightweight metadata probe with ${finalArgs.length} yt-dlp args.`,
      );
    }

    return new Promise((resolve, reject) => {
      const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
      if (currentProcInfo?.cancelled) {
        return reject(
          new Error(
            `[${itemId}] Download cancelled before yt-dlp process start.`,
          ),
        );
      }

      const startTime = Date.now();
      let downloadStartTime = startTime;
      let downloadEndTime = null;
      let initialFileSize = 0;

      // NEW: Try to detect initial file size for accurate speed on resume
      if (!isInfoOnly) {
        const outputIndex = finalArgs.indexOf("-o");
        if (outputIndex !== -1 && finalArgs[outputIndex + 1]) {
          const template = finalArgs[outputIndex + 1];
          try {
            const baseDir = path.dirname(template);
            const baseName = path.basename(template);

            // Check if file or partial file exists
            let checkPath = template;
            if (template.includes("%(ext)s")) {
              // If it's a template, look for .part files that yt-dlp would resume
              const glob = require("glob");
              const matches = glob.sync(
                `${baseName.replace("%(ext)s", "")}*.part`,
                { cwd: baseDir, absolute: true },
              );
              if (matches.length > 0) checkPath = matches[0];
            }

            if (fs.existsSync(checkPath)) {
              initialFileSize = fs.statSync(checkPath).size;
              logger.info(
                `[${itemId}] 📊 Detected initial file size for speed calculation: ${initialFileSize} bytes`,
              );
            }
          } catch (e) {
            /* Ignore stat errors */
          }
        }
      }

      logger.info(`[${itemId}] 🚀 Starting yt-dlp...`);
      const ytdlpProc = spawn(ytdlpExecutable, finalArgs, {
        detached: os.platform() !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", LANG: "en_US.UTF-8" },
      });

      if (currentProcInfo) currentProcInfo.ytdlpProc = ytdlpProc;
      else if (itemProcInfoRef && typeof itemProcInfoRef === "object")
        itemProcInfoRef.ytdlpProc = ytdlpProc;

      let stdoutData = "";
      let stderrData = "";
      let destinationPath = null;

      let stdoutBuffer = ""; // Buffer for incomplete lines

      ytdlpProc.stdout.setEncoding("utf8");
      ytdlpProc.stderr.setEncoding("utf8");

      // Speed monitoring for throttle detection only
      let lastSpeedCheck = Date.now();
      let speedSamples = [];
      let rateLimitDetected = false;

      // DISK-BASED SPEED MEASUREMENT (ground truth)
      let diskSpeedInterval = null;
      let diskSpeedEma = null; // Exponential moving average
      let lastDiskSize = 0;
      let lastDiskCheckTime = Date.now();
      let lastSentPercent = null;
      let lastSpeedSendTime = Date.now();
      let parsedSpeedFallback = null; // Only used before file path is known

      ytdlpProc.stdout.on("data", (data) => {
        stdoutData += data;
        stdoutBuffer += data;

        // Process complete lines from buffer
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || ""; // Keep the last incomplete line

        lines.forEach((line) => {
          if (!line.trim()) return;

          // Detect when download actually starts and ends
          if (!downloadEndTime) {
            if (
              line.includes("[download] Destination:") ||
              line.includes("[download] Resuming download")
            ) {
              downloadStartTime = Date.now();
            }
            if (
              line.includes("[Merger]") ||
              line.includes("[ExtractAudio]") ||
              line.includes("[VideoConvertor]") ||
              line.includes("[EmbedSubtitle]")
            ) {
              downloadEndTime = Date.now();
              logger.info(
                `[${itemId}] ⏱️ Download phase completed. Starting post-processing...`,
              );
            }
          }

          // Robust Destination Detection
          // We look for multiple patterns and keep the LATEST one seen (especially important after merging)
          const destMatch =
            line.match(/\[download\] Destination:\s*(.*)/) ||
            line.match(/\[Merger\] Merging formats into "([^"]+)"/) ||
            line.match(/\[ExtractAudio\] Destination:\s*(.*)/) ||
            line.match(/\[VideoConvertor\] Converting video to "([^"]+)"/) ||
            line.match(/\[FixupM3u8\] Fixup m3u8 manifest for "([^"]+)"/);

          if (destMatch && (destMatch[1] || destMatch[2])) {
            let pathMatch = (destMatch[1] || destMatch[2]).trim();
            if (pathMatch.endsWith('"')) pathMatch = pathMatch.slice(0, -1);
            if (pathMatch.startsWith('"')) pathMatch = pathMatch.slice(1);
            destinationPath = pathMatch;
            logger.info(
              `[${itemId}] 📁 NEW DESTINATION DETECTED: ${destinationPath}`,
            );

            // START DISK-BASED SPEED MEASUREMENT
            // This gives ground truth speed by measuring actual bytes written to disk
            if (!diskSpeedInterval) {
              // Find the actual file being written (could be .part file)
              const getActiveFilePath = () => {
                const partPath = destinationPath + ".part";
                if (fs.existsSync(partPath)) return partPath;
                if (fs.existsSync(destinationPath)) return destinationPath;
                // Try common yt-dlp part patterns
                const dir = path.dirname(destinationPath);
                const base = path.basename(
                  destinationPath,
                  path.extname(destinationPath),
                );
                const patterns = [`${base}*.part`, `${base}.f*.part`];
                for (const pattern of patterns) {
                  try {
                    const glob = require("glob");
                    const matches = glob.sync(pattern, {
                      cwd: dir,
                      absolute: true,
                    });
                    if (matches.length > 0) return matches[0];
                  } catch (e) {
                    /* ignore */
                  }
                }
                return null;
              };

              // Initialize with current file size
              const initialPath = getActiveFilePath();
              if (initialPath) {
                try {
                  lastDiskSize = fs.statSync(initialPath).size;
                } catch (e) {
                  lastDiskSize = 0;
                }
              }
              lastDiskCheckTime = Date.now();

              diskSpeedInterval = setInterval(() => {
                try {
                  const filePath = getActiveFilePath();
                  if (!filePath) return;

                  const now = Date.now();
                  const stats = fs.statSync(filePath);
                  const currentSize = stats.size;
                  const deltaBytes = currentSize - lastDiskSize;
                  const deltaTime = now - lastDiskCheckTime;

                  if (deltaTime > 0 && deltaBytes >= 0) {
                    // Calculate bytes per second
                    const bps = (deltaBytes / deltaTime) * 1000;

                    // Skip if file size decreased (file was deleted/replaced)
                    if (deltaBytes < 0) {
                      lastDiskSize = currentSize;
                      lastDiskCheckTime = now;
                      return;
                    }

                    // Apply EMA smoothing
                    if (diskSpeedEma === null) {
                      diskSpeedEma = bps;
                    } else {
                      // Ignore extreme spikes (> 2.5x current EMA)
                      if (bps <= diskSpeedEma * 2.5 || diskSpeedEma === 0) {
                        diskSpeedEma = diskSpeedEma * 0.8 + bps * 0.2;
                      }
                      // If EMA is 0 and we have any reading, use it
                      if (diskSpeedEma === 0 && bps > 0) {
                        diskSpeedEma = bps;
                      }
                    }
                  }

                  lastDiskSize = currentSize;
                  lastDiskCheckTime = now;
                } catch (e) {
                  // File might not exist yet or be locked, ignore
                }
              }, 500); // Check every 500ms

              logger.info(
                `[${itemId}] 📊 Started disk-based speed measurement`,
              );
            }
          }

          if (!suppressProgress) {
            const progressMatch = line.match(
              /\[download\]\s*(\d+\.?\d*)%.*?at\s*([\d.]+(?:[KMG]?i?B)\/s)/,
            );
            if (progressMatch) {
              const percent = parseFloat(progressMatch[1]);
              const speed = progressMatch[2];
              const now = Date.now();

              // Parse speed to bytes (only as fallback when disk speed not available)
              let parsedBytes = null;
              try {
                const speedValue = parseFloat(speed);
                if (!isNaN(speedValue) && speedValue > 0) {
                  const speedLower = speed.toLowerCase();
                  parsedBytes = speedValue;

                  if (speedLower.includes("gib") || speedLower.includes("gb")) {
                    parsedBytes *= 1024 * 1024 * 1024;
                  } else if (
                    speedLower.includes("mib") ||
                    speedLower.includes("mb")
                  ) {
                    parsedBytes *= 1024 * 1024;
                  } else if (
                    speedLower.includes("kib") ||
                    speedLower.includes("kb")
                  ) {
                    parsedBytes *= 1024;
                  }
                  parsedSpeedFallback = parsedBytes;
                }
              } catch (e) {
                /* Ignore parsing errors */
              }

              // Speed monitoring for throttle detection (every 5 seconds)
              if (now - lastSpeedCheck > 5000 && parsedBytes !== null) {
                speedSamples.push(parsedBytes);
                if (speedSamples.length > 10) speedSamples.shift();

                if (speedSamples.length >= 3) {
                  const recentAvg =
                    speedSamples.slice(-3).reduce((a, b) => a + b, 0) / 3;
                  const earlierAvg =
                    speedSamples.slice(0, 3).reduce((a, b) => a + b, 0) / 3;

                  if (earlierAvg > 0 && recentAvg < earlierAvg * 0.3) {
                    logger.info(
                      `[${itemId}] ⚠️ Speed drop detected: ${(earlierAvg / 1024 / 1024).toFixed(2)} MB/s → ${(recentAvg / 1024 / 1024).toFixed(2)} MB/s`,
                    );
                  }
                }
                lastSpeedCheck = now;
              }

              // SEND PROGRESS UPDATE (every 1 second for speed, more often for percent)
              const timeSinceLastSpeedSend = now - lastSpeedSendTime;

              // Determine which speed to use: disk-based (ground truth) or parsed (fallback)
              const speedToSend =
                diskSpeedEma !== null ? diskSpeedEma : parsedSpeedFallback;

              if (timeSinceLastSpeedSend >= 1000) {
                lastSpeedSendTime = now;
                lastSentPercent = percent;

                sendMessageToClient(clientId, {
                  type: "progress",
                  percent,
                  speedBytesPerSec: speedToSend
                    ? Math.round(speedToSend)
                    : null,
                  itemId,
                });
              } else if (
                lastSentPercent === null ||
                Math.abs(percent - lastSentPercent) >= 0.5
              ) {
                // Send progress update for percent changes
                lastSentPercent = percent;
                sendMessageToClient(clientId, {
                  type: "progress",
                  percent,
                  speedBytesPerSec: speedToSend
                    ? Math.round(speedToSend)
                    : null,
                  itemId,
                });
              }
            } else if (line.includes("[download]") && line.includes("%")) {
              // Fallback: try to extract just the percent from lines we couldn't fully parse
              const percentOnlyMatch = line.match(/(\d+\.?\d*)%/);
              if (percentOnlyMatch) {
                const percent = parseFloat(percentOnlyMatch[1]);
                if (!isNaN(percent)) {
                  const speedToSend =
                    diskSpeedEma !== null ? diskSpeedEma : parsedSpeedFallback;
                  lastSentPercent = percent;
                  sendMessageToClient(clientId, {
                    type: "progress",
                    percent,
                    speedBytesPerSec: speedToSend
                      ? Math.round(speedToSend)
                      : null,
                    itemId,
                  });
                }
              }
            }
          }

          // Log format selection info
          if (
            line.includes("[info]") ||
            line.includes("Downloading") ||
            line.includes("format") ||
            line.includes("Merging")
          ) {
            logger.info(`[${itemId}] 📋 YTDLP: ${line.trim()}`);
          }
        });
      });

      ytdlpProc.stderr.on("data", (data) => {
        stderrData += data;

        // Enhanced error detection
        if (data.includes("403") || data.includes("Forbidden")) {
          logger.info(`[${itemId}] 🚨 Auth error detected: ${data.trim()}`);
          if (!isInfoOnly) {
            sendMessageToClient(clientId, {
              type: "status",
              message:
                "⚠️ Authentication issue detected. Consider updating cookies.",
              itemId,
            });
          }
        }

        if (
          data.includes("429") ||
          data.includes("Too Many Requests") ||
          data.includes("rate limit")
        ) {
          rateLimitDetected = true;
          markSlowerDownloadMode("rate limiting", itemId);
          logger.info(`[${itemId}] 🚨 Rate limiting detected: ${data.trim()}`);
          if (!isInfoOnly) {
            sendMessageToClient(clientId, {
              type: "status",
              message:
                "⚠️ Rate limiting detected. Adjusting download strategy...",
              itemId,
            });
          }
        }

        if (
          data.includes("throttled") ||
          data.includes("blocked") ||
          data.includes("temporarily unavailable")
        ) {
          logger.info(
            `[${itemId}] ⚠️ Possible throttling detected: ${data.trim()}`,
          );
        }
      });

      ytdlpProc.on("error", (error) => {
        logger.error(
          `[${itemId}] yt-dlp spawn error using ${ytdlpExecutable}: ${error.message}`,
        );
        if (currentProcInfo) currentProcInfo.ytdlpProc = null;
        if (!itemProcInfoRef) activeProcesses.delete(itemId);
        reject(
          createClassifiedError({
            code: "TOOLING",
            message: `yt-dlp process failed to start (${ytdlpExecutable}): ${error.message}`,
            siteKey,
          }),
        );
      });

      ytdlpProc.on("close", async (code, signal) => {
        // Cleanup disk speed measurement interval
        if (diskSpeedInterval) {
          clearInterval(diskSpeedInterval);
          diskSpeedInterval = null;
        }

        if (currentProcInfo) currentProcInfo.ytdlpProc = null;

        // Check if this was a user-initiated cancellation
        if (currentProcInfo?.cancelled) {
          logger.info(
            `[${itemId}] ❌ Process terminated due to cancellation (exit code ${code})`,
          );
          return resolve({
            stdout: stdoutData,
            stderr: stderrData,
            actualPath: destinationPath,
            wasCancelled: true,
          });
        }

        if (code === 0) {
          if (!destinationPath && stdoutData) {
            const mergedPathMatch = stdoutData.match(
              /Merging formats into "([^"]+)"/,
            );
            const extractAudioMatch = stdoutData.match(
              /\[ExtractAudio\] Destination: (.*)/,
            );
            const destinationMatch = stdoutData.match(
              /\[download\] Destination: (.+)/,
            );

            if (mergedPathMatch && mergedPathMatch[1])
              destinationPath = mergedPathMatch[1];
            else if (extractAudioMatch && extractAudioMatch[1])
              destinationPath = extractAudioMatch[1];
            else if (destinationMatch && destinationMatch[1])
              destinationPath = destinationMatch[1].trim();

            if (destinationPath) {
              if (destinationPath.endsWith('"'))
                destinationPath = destinationPath.slice(0, -1);
              if (destinationPath.startsWith('"'))
                destinationPath = destinationPath.slice(1);
            }
          }

          if (!destinationPath && baseArgs.includes("-o")) {
            const outputTemplateIndex = baseArgs.indexOf("-o") + 1;
            if (outputTemplateIndex < baseArgs.length) {
              const template = baseArgs[outputTemplateIndex];
              if (!template.includes("%(") && fs.existsSync(template)) {
                destinationPath = template;
              } else if (template.includes("%(ext)s")) {
                const globPattern = template.replace(/%\([^)]+\)s/g, "*");
                try {
                  const glob = require("glob");
                  const files = glob.sync(path.basename(globPattern), {
                    cwd: path.dirname(template),
                    absolute: true,
                  });
                  if (files.length === 1) {
                    destinationPath = files[0];
                  } else if (files.length > 1) {
                    // Filter for media files to avoid matching .f137.mp4 fragments
                    const mediaFiles = files.filter(
                      (f) => !f.match(/\.f\d+\./),
                    );
                    if (mediaFiles.length === 1)
                      destinationPath = mediaFiles[0];
                  }
                } catch (e) {
                  /* Silent */
                }
              } else if (fs.existsSync(template)) {
                destinationPath = template;
              }
            }
          }

          // INTEGRITY CHECK: Verify the file exists and is not empty
          if (destinationPath) {
            try {
              if (fs.existsSync(destinationPath)) {
                const stats = fs.statSync(destinationPath);
                if (stats.size > 0) {
                  logger.info(
                    `[${itemId}] ✅ Integrity Check Passed: ${destinationPath} (${stats.size} bytes)`,
                  );
                } else {
                  logger.warn(
                    `[${itemId}] ⚠️ Integrity Warning: File exists but is empty (0 bytes): ${destinationPath}`,
                  );
                  // Don't reject yet, maybe it's still being moved? Wait a tiny bit.
                  setTimeout(() => {
                    try {
                      const reStats = fs.statSync(destinationPath);
                      if (reStats.size === 0) {
                        return reject(
                          new Error(
                            `Download failed: File is empty (0 bytes) at ${destinationPath}. Check logs for details.`,
                          ),
                        );
                      }
                      // If it’s not empty after waiting, continue as success:
                      return resolve({
                        stdout: stdoutData,
                        stderr: stderrData,
                        actualPath: destinationPath,
                      });
                    } catch (e) {
                      return reject(e);
                    }
                  }, 1000);

                  return; // IMPORTANT: stop execution here so resolve() isn't called twice
                }
              } else {
                // Try fallback: search for file in the target directory if template was used
                logger.warn(
                  `[${itemId}] ⚠️ Post-process path missing: ${destinationPath}. Check if download actually succeeded.`,
                );
              }
            } catch (e) {
              logger.error(
                `[${itemId}] ❌ Integrity check failed: ${e.message}`,
              );
            }
          }

          if (!destinationPath && !isInfoOnly) {
            logger.error(
              `[${itemId}] ❌ CRITICAL: Download reported success but no destination path was captured!`,
            );
          }

          resolve({
            stdout: stdoutData,
            stderr: stderrData,
            actualPath: destinationPath,
          });
        } else {
          // Check if this was a user-initiated pause (not a real error)
          if (currentProcInfo?.paused || currentProcInfo?.pausedByUser) {
            logger.info(
              `[${itemId}] ⏸️ Process terminated due to pause (exit code ${code})`,
            );
            // Resolve with partial data - pause handler will manage the state
            return resolve({
              stdout: stdoutData,
              stderr: stderrData,
              actualPath: destinationPath,
              wasPaused: true,
            });
          }

          let errorMsg =
            stderrData
              .split("\n")
              .filter((line) => line.toLowerCase().includes("error:"))
              .join("; ") ||
            stderrData.trim() ||
            `yt-dlp exited with code ${code}`;

          if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
            errorMsg = cookieFilePath
              ? `Authentication failed despite cookies. Your cookies may be expired or invalid. Original error: ${errorMsg}`
              : `Authentication required (403 Forbidden). Try importing cookies. Original error: ${errorMsg}`;
          } else if (
            errorMsg.includes("429") ||
            errorMsg.includes("Too Many Requests") ||
            errorMsg.includes("rate limit") ||
            rateLimitDetected
          ) {
            errorMsg = `Rate limiting detected (429). Please wait a few minutes before trying again. Error: ${errorMsg}`;
          } else if (errorMsg.includes("Did not get any data blocks")) {
            errorMsg = `There was a network error. Please check your internet connection and try again.`;
          }

          logger.error(
            `[${itemId}] yt-dlp failed (code ${code}). Error: ${errorMsg}`,
          );
          reject(
            createClassifiedError({
              code: undefined,
              hasCookies: cookieArgs.includes("--cookies"),
              message: errorMsg.substring(0, 400),
              stderr: stderrData,
              siteKey,
            }),
          );
        }
      });
    });
  }

  async function runFFmpegCommand(
    clientId,
    ffmpegArgs,
    itemId,
    itemProcInfoRef,
  ) {
    return new Promise((resolve, reject) => {
      const currentProcInfo = itemProcInfoRef || activeProcesses.get(itemId);
      if (currentProcInfo?.cancelled) {
        return reject(
          new Error(
            `[${itemId}] Conversion cancelled before ffmpeg process start.`,
          ),
        );
      }

      sendMessageToClient(clientId, {
        type: "status",
        message: "Starting conversion...",
        itemId,
      });
      const ffmpegProc = spawn(ffmpegExecutable, ffmpegArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      if (currentProcInfo) currentProcInfo.ffmpegProc = ffmpegProc;
      else if (itemProcInfoRef && typeof itemProcInfoRef === "object")
        itemProcInfoRef.ffmpegProc = ffmpegProc;

      let ffmpegStderr = "";
      ffmpegProc.stderr.setEncoding("utf8");
      ffmpegProc.stderr.on("data", (data) => {
        ffmpegStderr += data;
      });

      ffmpegProc.on("error", (error) => {
        logger.error(
          `[${itemId}] ffmpeg spawn error using ${ffmpegExecutable}: ${error.message}`,
        );
        if (currentProcInfo) currentProcInfo.ffmpegProc = null;
        if (!itemProcInfoRef) activeProcesses.delete(itemId);
        reject(
          new Error(
            `ffmpeg process failed to start (${ffmpegExecutable}): ${error.message}`,
          ),
        );
      });

      ffmpegProc.on("close", (code) => {
        if (currentProcInfo) currentProcInfo.ffmpegProc = null;

        if (currentProcInfo?.cancelled) {
          return reject(new Error(`Conversion cancelled for item ${itemId}`));
        }
        if (code === 0) {
          sendMessageToClient(clientId, {
            type: "status",
            message: "Conversion complete.",
            itemId,
          });
          resolve();
        } else {
          logger.error(
            `[${itemId}] ffmpeg exited with code ${code}. Full stderr:\n${ffmpegStderr}`,
          );
          reject(
            new Error(
              `ffmpeg conversion failed (code ${code}). Details: ${ffmpegStderr.substring(0, 200)}`,
            ),
          );
        }
      });
    });
  }

  // ==================== HTTP ROUTES ====================
  registerApiRoutes(app, {
    gracefulShutdown,
    checkAndUpdateTools,
    getToolVersion,
    getLastUpdateCheck,
    setLastUpdateCheck,
    ytdlpExecutable,
    ffmpegExecutable,
    getVideoInfo,
    historyIndex,
    getRecoverableDownloads,
    getScheduledDownloads,
    createScheduledDownload,
    deleteScheduledDownload,
    getFailedDownloads,
    retryFailedDownload: queueFailedDownloadRetry,
    retryAllFailedDownloads,
    previewPlaylist,
    logger: logger,
  });

  // ==================== SERVER START & GRACEFUL SHUTDOWN ====================
  server.listen(PORT, "127.0.0.1", async () => {
    logger.info(`Backend server running on http://127.0.0.1:${PORT}`);
    logger.info(`Downloads will be saved to: ${DOWNLOAD_DIR}`);

    // Auto-check for tool updates on server start (after clients have a chance to connect)
    setTimeout(async () => {
      try {
        // Wait a bit longer for client to connect and send preferences
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (wsHub.hasAnyClientAutoUpdateEnabled()) {
          logger.info(
            "🚀 Server started, checking for tool updates (auto-update enabled)...",
          );
          await checkAndUpdateTools(false, true);
        } else {
          logger.info(
            "🚀 Server started, auto-update disabled by user preference",
          );
        }
      } catch (error) {
        logger.error("❌ Error during startup tool check:", error);
      }
    }, 7000);

    // Set up periodic auto-update checks (every 24 hours)
    function startPeriodicAutoUpdate() {
      // Clear any existing interval
      if (autoUpdateInterval) {
        clearInterval(autoUpdateInterval);
      }

      // Check every 24 hours (24 * 60 * 60 * 1000 ms)
      autoUpdateInterval = setInterval(
        async () => {
          try {
            if (wsHub.hasAnyClientAutoUpdateEnabled()) {
              logger.info(
                "🔄 Periodic auto-update check for tools (24h interval)...",
              );
              await checkAndUpdateTools(false, true);
            }
          } catch (error) {
            logger.error("❌ Error during periodic auto-update check:", error);
          }
        },
        24 * 60 * 60 * 1000,
      );

      logger.info("✅ Periodic auto-update checks started (every 24 hours)");
    }

    startPeriodicAutoUpdate();

    if (process.send) {
      logger.info("Sending server_ready message to parent process...");
      process.send({ type: "server_ready", port: PORT, serverToken });
    }

    if (!process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
      await open(`http://127.0.0.1:${PORT}`);
    }

    setTimeout(() => {
      logger.info("WebSocket server should be ready now");
      if (!pLimit)
        logger.warn(
          "p-limit module not loaded yet. Concurrency limiters will be initialized once it loads.",
        );
      else {
        logger.info(`Using yt-dlp executable: ${ytdlpExecutable}`);
        logger.info(`Using ffmpeg executable: ${ffmpegExecutable}`);
      }

      wsHub.broadcast({ type: "ready", message: "Backend server is ready." });
    }, 500);
  });

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  function gracefulShutdown() {
    logger.info("Received shutdown signal. Closing server and cleaning up...");

    // Clear auto-update interval
    if (autoUpdateInterval) {
      clearInterval(autoUpdateInterval);
      autoUpdateInterval = null;
      logger.info("Auto-update interval cleared");
    }

    for (const [, timer] of scheduledDownloadTimers.entries()) {
      clearTimeout(timer);
    }
    scheduledDownloadTimers.clear();

    const shutdownSnapshotPromise = snapshotRecoverableDownloadsForShutdown().catch(
      (error) => {
        logger.error(
          "Failed to snapshot recoverable downloads on shutdown:",
          error,
        );
      },
    );

    wss.clients.forEach((clientWs) => {
      const clientEntry = Array.from(clients.entries()).find(
        ([id, cws]) => cws === clientWs,
      );
      if (clientEntry) {
        sendMessageToClient(clientEntry[0], {
          type: "status",
          message: "Server is shutting down...",
        });
      }
      clientWs.terminate();
    });

    server.close(async () => {
      logger.info("HTTP server closed.");
      await shutdownSnapshotPromise;
      activeProcesses.forEach((procInfo, itemId) => {
        logger.info(
          `Terminating active processes for item: ${itemId} during shutdown.`,
        );
        procInfo.cancelled = true;
        markDirty();
        if (
          procInfo.ytdlpProc &&
          procInfo.ytdlpProc.pid &&
          !procInfo.ytdlpProc.killed
        ) {
          terminateProcessTree(procInfo.ytdlpProc.pid);
        }
        if (
          procInfo.ffmpegProc &&
          procInfo.ffmpegProc.pid &&
          !procInfo.ffmpegProc.killed
        ) {
          terminateProcessTree(procInfo.ffmpegProc.pid);
        }
      });
      logger.info("Cleanup complete. Exiting.");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, 10000);
  }
})();
