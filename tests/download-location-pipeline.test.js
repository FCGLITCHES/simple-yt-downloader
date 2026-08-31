"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const rendererSource = fs.readFileSync(
  path.join(projectRoot, "script.js"),
  "utf8",
);
const preloadSource = fs.readFileSync(
  path.join(projectRoot, "preload.js"),
  "utf8",
);
const electronMainSource = fs.readFileSync(
  path.join(projectRoot, "electron-main.js"),
  "utf8",
);

test("onboarding_settings_and_first_launch_share_one_download_location_persistence_path", () => {
  assert.match(
    rendererSource,
    /function persistDownloadFolderPath\(folderPath\)[\s\S]*localStorage\.setItem\('ytdUserSettings'[\s\S]*localStorage\.setItem\('downloadFolder'/,
  );
  assert.match(
    rendererSource,
    /function persistDownloadFolder\(folderPath\)\s*{[\s\S]*persistDownloadFolderPath\(folderPath\)/,
  );
  assert.match(
    rendererSource,
    /const initialFolder = savedFolder[\s\S]*persistDownloadFolderPath\(initialFolder\)/,
  );
  const settingsFolderHandlers = rendererSource.slice(
    rendererSource.indexOf("// Folder picker logic"),
    rendererSource.indexOf("// Paste button logic"),
  );
  assert.equal(
    (settingsFolderHandlers.match(/chooseFolderBtn\.onclick/g) || []).length,
    1,
  );
  assert.equal(
    (settingsFolderHandlers.match(/defaultFolderBtn\.onclick/g) || []).length,
    1,
  );
  assert.equal(
    (settingsFolderHandlers.match(/openFolderBtn\.onclick/g) || []).length,
    1,
  );
  assert.doesNotMatch(rendererSource, /C:\/Users\/User\/Downloads/);
});

test("history_play_uses_media_ipc_and_each_item_carries_its_own_validation_root", () => {
  const historyActionHandler = rendererSource.slice(
    rendererSource.indexOf("// History action buttons event listener"),
    rendererSource.indexOf("// Wire the history tabs"),
  );

  assert.match(
    rendererSource,
    /data-action="play" data-root="\$\{escapedHistoryItemRoot\}"/,
  );
  assert.match(historyActionHandler, /electronAPI\?\.openMediaFile/);
  assert.match(historyActionHandler, /openMediaFile\(rootPath, filePath\)/);
  assert.match(
    historyActionHandler,
    /openPathInExplorer\(rootPath, filePath\)/,
  );
  assert.doesNotMatch(
    historyActionHandler,
    /openPathInExplorer\(getDownloadFolder\(\), filePath\)/,
  );
});

test("desktop_bridge_exposes_separate_media_playback_and_explorer_actions", () => {
  assert.match(preloadSource, /openMediaFile:[\s\S]*"open-media-file"/);
  assert.match(electronMainSource, /ipcMain\.handle\('open-media-file'/);
  assert.match(
    electronMainSource,
    /desktopFileActions\.openMediaFile\(rootPath, filePath\)/,
  );
});
