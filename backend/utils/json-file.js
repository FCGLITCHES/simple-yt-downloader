"use strict";

const fs = require("fs");
const path = require("path");

async function readJsonFile(filePath, fallbackValue = null) {
  if (!filePath) {
    return fallbackValue;
  }

  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  if (!filePath) {
    return;
  }

  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const directory = path.dirname(filePath);
  const tempFilePath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const backupPath = `${filePath}.bak`;

  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(tempFilePath, serialized, "utf8");

  try {
    await fs.promises.rename(tempFilePath, filePath);
    return;
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error.code)) {
      await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});
      throw error;
    }
  }

  await fs.promises.rm(backupPath, { force: true }).catch(() => {});
  if (fs.existsSync(filePath)) {
    await fs.promises.rename(filePath, backupPath).catch(() => {});
  }

  try {
    await fs.promises.rename(tempFilePath, filePath);
  } finally {
    await fs.promises.rm(backupPath, { force: true }).catch(() => {});
    await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});
  }
}

module.exports = {
  readJsonFile,
  writeJsonAtomic,
};
