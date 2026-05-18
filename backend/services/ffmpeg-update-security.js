"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");
const AdmZip = require("adm-zip");

const FFMPEG_BINARIES = ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"];

function loadFfmpegChecksumManifest(manifestPath, logger = console) {
  try {
    if (!fs.existsSync(manifestPath)) {
      logger.warn?.(
        "[ffmpeg-update] ffmpeg-checksums.json not found; unlisted versions will not auto-update",
      );
      return {};
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    delete manifest._comment;
    return manifest;
  } catch (error) {
    logger.warn?.(
      "[ffmpeg-update] Could not load ffmpeg checksums manifest:",
      error.message,
    );
    return {};
  }
}

function getManifestChecksum(manifest, version) {
  const checksum = manifest[version];
  if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum)) {
    return null;
  }
  return checksum.toLowerCase();
}

async function computeSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function downloadFile(downloadUrl, destinationPath) {
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);

    const cleanup = (error) => {
      file.destroy();
      if (error) reject(error);
    };

    const requestUrl = (currentUrl, redirectCount = 0) => {
      const request = https.get(currentUrl, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          if (redirectCount >= 5) {
            cleanup(new Error("Too many redirects while downloading FFmpeg"));
            return;
          }
          requestUrl(response.headers.location, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          cleanup(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      });

      request.on("error", cleanup);
      request.setTimeout(120000, () => {
        request.destroy();
        cleanup(new Error("Download timed out"));
      });
    };

    requestUrl(downloadUrl);
  });
}

async function installFfmpegFromZip({
  downloadUrl,
  version,
  manifest,
  binDir,
  testFFmpegWorking,
  tmpDir,
  logger = console,
  downloader = downloadFile,
}) {
  const expectedChecksum = getManifestChecksum(manifest, version);
  if (!expectedChecksum) {
    return {
      success: false,
      error: `Version ${version} is not in the trust manifest - update the app first`,
      skippedBeforeDownload: true,
    };
  }

  const updateTmpDir = tmpDir || path.join(require("os").tmpdir(), `ffmpeg-update-${Date.now()}`);
  const zipPath = path.join(updateTmpDir, "ffmpeg-essentials.zip");
  const stageDir = path.join(updateTmpDir, "stage");
  const backups = [];
  const installedFiles = [];

  try {
    fs.mkdirSync(updateTmpDir, { recursive: true });
    fs.mkdirSync(stageDir, { recursive: true });

    logger.info?.(`Downloading FFmpeg ${version} from ${downloadUrl}...`);
    await downloader(downloadUrl, zipPath);

    const computedHash = await computeSha256(zipPath);
    if (computedHash !== expectedChecksum) {
      return {
        success: false,
        error: "Checksum verification failed",
        expectedChecksum,
        computedHash,
      };
    }

    const extractedFiles = extractFfmpegBinariesToStage(zipPath, stageDir);
    if (extractedFiles.length === 0) {
      return { success: false, error: "No binaries found in archive" };
    }

    for (const baseName of extractedFiles) {
      const destinationPath = path.join(binDir, baseName);
      const backupPath = destinationPath + ".bak";
      const stagePath = path.join(stageDir, baseName);

      if (fs.existsSync(destinationPath)) {
        try {
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
          fs.renameSync(destinationPath, backupPath);
          backups.push({ baseName, backupPath, destinationPath });
        } catch (error) {
          rollbackBackups(backups);
          return {
            success: false,
            error: `${baseName} is locked - close active downloads and try again`,
          };
        }
      }

      try {
        fs.renameSync(stagePath, destinationPath);
        installedFiles.push(baseName);
      } catch (error) {
        rollbackInstalledFiles(installedFiles, binDir, backups);
        rollbackBackups(backups);
        return {
          success: false,
          error: `Failed to install ${baseName}: ${error.message}`,
        };
      }
    }

    if (!(await testFFmpegWorking())) {
      rollbackInstalledFiles(extractedFiles, binDir, backups);
      return {
        success: false,
        error: "FFmpeg binary not working after update - rolled back",
      };
    }

    cleanupBackups(backups);
    return { success: true, extractedFiles };
  } catch (error) {
    rollbackInstalledFiles(installedFiles, binDir, backups);
    rollbackBackups(backups);
    return { success: false, error: error.message };
  } finally {
    try {
      if (fs.existsSync(updateTmpDir)) {
        fs.rmSync(updateTmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

function extractFfmpegBinariesToStage(zipPath, stageDir) {
  const zip = new AdmZip(zipPath);
  const extractedFiles = [];

  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName;
    const baseName = path.basename(entryName);
    if (FFMPEG_BINARIES.includes(baseName) && entryName.includes("/bin/")) {
      fs.writeFileSync(path.join(stageDir, baseName), entry.getData());
      extractedFiles.push(baseName);
    }
  }

  return extractedFiles;
}

function rollbackInstalledFiles(extractedFiles, binDir, backups) {
  for (const baseName of extractedFiles) {
    const destinationPath = path.join(binDir, baseName);
    const backup = backups.find((entry) => entry.baseName === baseName);
    try {
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
      if (backup && fs.existsSync(backup.backupPath)) {
        fs.renameSync(backup.backupPath, backup.destinationPath);
      }
    } catch (_) {}
  }
}

function rollbackBackups(backups) {
  for (const backup of backups.reverse()) {
    try {
      if (!fs.existsSync(backup.destinationPath) && fs.existsSync(backup.backupPath)) {
        fs.renameSync(backup.backupPath, backup.destinationPath);
      }
    } catch (_) {}
  }
}

function cleanupBackups(backups) {
  for (const backup of backups) {
    try {
      if (fs.existsSync(backup.backupPath)) {
        fs.unlinkSync(backup.backupPath);
      }
    } catch (_) {}
  }
}

module.exports = {
  computeSha256,
  downloadFile,
  getManifestChecksum,
  installFfmpegFromZip,
  loadFfmpegChecksumManifest,
};
