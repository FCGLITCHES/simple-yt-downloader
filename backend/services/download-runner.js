"use strict";

const path = require("path");

function sanitizeFilename(title) {
  if (!title) {
    return "downloaded_media";
  }

  const sanitized = title.replace(/[<>:"/\\|?*~]/g, " ").replace(/\s+/g, " ");
  return sanitized.trim().substring(0, 180);
}

async function getUniqueFolderPath(fs, basePath, baseName) {
  let folderPath = path.join(basePath, sanitizeFilename(baseName));
  let counter = 1;

  try {
    await fs.promises.access(folderPath);
  } catch {
    return folderPath;
  }

  let numberedFolderPath = path.join(
    basePath,
    `${sanitizeFilename(baseName)} (${counter})`,
  );
  while (true) {
    try {
      await fs.promises.access(numberedFolderPath);
    } catch {
      break;
    }
    counter += 1;
    numberedFolderPath = path.join(
      basePath,
      `${sanitizeFilename(baseName)} (${counter})`,
    );
  }

  return numberedFolderPath;
}

function createDownloadCompletionService({
  fs,
  pathModule = path,
  downloadDir,
  formatBytes,
  verifyDownload,
  sendMessageToClient,
  historyIndex,
  logger = require("../utils/logger").logger,
}) {
  function buildDownloadLink(finalFilePathValue) {
    const relativePathCheck = pathModule.relative(
      downloadDir,
      finalFilePathValue,
    );

    if (
      relativePathCheck.startsWith("..") ||
      pathModule.isAbsolute(relativePathCheck)
    ) {
      return `/downloads/${encodeURIComponent(finalFilePathValue.replace(/\\/g, "/"))}`;
    }

    return `/downloads/${encodeURIComponent(relativePathCheck.replace(/\\/g, "/"))}`;
  }

  function buildPayload({
    itemId,
    source,
    targetDir,
    finalFilePath,
    itemData,
    itemProcInfo,
    title,
    message,
    actualSize,
    downloadUrl,
    filename,
  }) {
    return {
      type: "complete",
      message: message || "Download complete!",
      itemId,
      title: title || itemData?.title || filename,
      source,
      fullPath: finalFilePath,
      actualSize,
      downloadUrl: downloadUrl || buildDownloadLink(finalFilePath),
      filename: filename || pathModule.basename(finalFilePath),
      downloadFolder: targetDir,
      thumbnail: itemProcInfo?.thumbnail || null,
      isPlaylistItem: itemData?.isPlaylistItem || false,
      playlistId: itemData?.parentPlaylistId || null,
      playlistTitle: itemData?.playlistTitle || null,
      format: itemData?.format || null,
      quality: itemData?.quality || null,
    };
  }

  async function recordHistory(clientId, payload) {
    if (!historyIndex) {
      return;
    }

    try {
      await historyIndex.recordDownload({
        clientId,
        name: payload.title || payload.filename || "Download complete",
        filename: payload.filename,
        path: payload.downloadUrl,
        fullPath: payload.fullPath,
        size: payload.actualSize,
        mtime: new Date().toISOString(),
        source: payload.source,
        thumbnail: payload.thumbnail,
        isPlaylistItem: payload.isPlaylistItem,
        playlistId: payload.playlistId,
        playlistTitle: payload.playlistTitle,
        format: payload.format,
        quality: payload.quality,
      });
    } catch (error) {
      logger.error(
        "[HistoryIndex] Failed to record completed download:",
        error,
      );
    }
  }

  async function sendAndRecord(clientId, payload) {
    sendMessageToClient(clientId, payload);
    await recordHistory(clientId, payload);
  }

  async function createPayloadFromFileStats({
    itemId,
    source,
    targetDir,
    finalFilePath,
    itemData,
    itemProcInfo,
    title,
    message,
    expectedFormat = null,
  }) {
    let verification = null;
    if (typeof verifyDownload === "function") {
      verification = await verifyDownload({
        expectedFormat,
        filePath: finalFilePath,
        itemId,
      });
    }

    const stats =
      verification?.stats || (await fs.promises.stat(finalFilePath));
    const actualSize = formatBytes(stats.size);
    return buildPayload({
      itemId,
      source,
      targetDir,
      finalFilePath,
      itemData,
      itemProcInfo,
      title,
      message,
      actualSize,
    });
  }

  return {
    buildDownloadLink,
    buildPayload,
    createPayloadFromFileStats,
    recordHistory,
    sendAndRecord,
  };
}

module.exports = {
  createDownloadCompletionService,
  getUniqueFolderPath,
  sanitizeFilename,
};
