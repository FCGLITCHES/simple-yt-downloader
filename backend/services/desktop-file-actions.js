"use strict";

const fs = require("fs");
const { validateDownloadPath } = require("../utils/path-validator");

function createDesktopFileActions({ shell }) {
  if (!shell || typeof shell.openPath !== "function") {
    throw new TypeError(
      "Desktop file actions require an Electron shell adapter",
    );
  }

  async function openPathInExplorer(downloadsRoot, targetPath) {
    const resolvedPath = validateDownloadPath(downloadsRoot, targetPath);
    const pathStats = fs.statSync(resolvedPath);

    if (pathStats.isDirectory()) {
      const shellError = await shell.openPath(resolvedPath);
      if (shellError) {
        return { success: false, error: shellError };
      }
    } else {
      shell.showItemInFolder(resolvedPath);
    }

    return { success: true };
  }

  async function openMediaFile(downloadsRoot, filePath) {
    const resolvedPath = validateDownloadPath(downloadsRoot, filePath);
    const pathStats = fs.statSync(resolvedPath);

    if (!pathStats.isFile()) {
      return { success: false, error: "Path is not a file" };
    }

    const shellError = await shell.openPath(resolvedPath);
    return shellError
      ? { success: false, error: shellError }
      : { success: true };
  }

  return {
    openMediaFile,
    openPathInExplorer,
  };
}

module.exports = { createDesktopFileActions };
