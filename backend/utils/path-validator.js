"use strict";

const fs = require("fs");
const path = require("path");

function validateDownloadPath(downloadsRoot, targetPath) {
  if (typeof downloadsRoot !== "string" || downloadsRoot.length === 0) {
    throw new TypeError("Invalid downloads root: must be a non-empty string");
  }

  if (typeof targetPath !== "string" || targetPath.length === 0) {
    throw new TypeError("Invalid path: must be a non-empty string");
  }

  let resolvedRoot;
  let resolvedTarget;

  try {
    resolvedRoot = fs.realpathSync.native(downloadsRoot);
  } catch (_) {
    throw new Error(
      `Downloads root does not exist or is inaccessible: ${downloadsRoot}`,
    );
  }

  try {
    resolvedTarget = fs.realpathSync.native(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Path does not exist: ${targetPath}`);
    }
    throw new Error(`Cannot resolve path: ${targetPath} (${error.message})`);
  }

  const normalizedRoot = ensureTrailingSeparator(resolvedRoot);
  const normalizedTarget = ensureTrailingSeparator(resolvedTarget);

  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error(
      `Path traversal rejected: "${targetPath}" resolves outside the downloads directory`,
    );
  }

  return resolvedTarget;
}

function isDownloadsRoot(resolvedPath, resolvedRoot) {
  return (
    path.normalize(ensureTrailingSeparator(resolvedPath)) ===
    path.normalize(ensureTrailingSeparator(resolvedRoot))
  );
}

function ensureTrailingSeparator(filePath) {
  return filePath.endsWith(path.sep) ? filePath : filePath + path.sep;
}

module.exports = { validateDownloadPath, isDownloadsRoot };
