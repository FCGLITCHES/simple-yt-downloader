"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createDesktopFileActions,
} = require("../backend/services/desktop-file-actions");

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gvl-history-actions-"),
  );
  const downloadFolder = path.join(fixtureRoot, "chosen-download-folder");
  const mediaFile = path.join(downloadFolder, "original-history-video.webm");
  const outsideFolder = path.join(fixtureRoot, "different-download-folder");
  const outsideFile = path.join(outsideFolder, "outside-video.webm");
  fs.mkdirSync(downloadFolder, { recursive: true });
  fs.mkdirSync(outsideFolder, { recursive: true });
  fs.writeFileSync(mediaFile, "video");
  fs.writeFileSync(outsideFile, "outside");
  return { fixtureRoot, downloadFolder, mediaFile, outsideFile };
}

test("history_play_launches_media_file_with_default_os_application", async (t) => {
  const fixture = createFixture();
  t.after(() =>
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }),
  );
  const openedPaths = [];
  const desktopFileActions = createDesktopFileActions({
    shell: {
      openPath: async (filePath) => {
        openedPaths.push(filePath);
        return "";
      },
      showItemInFolder() {},
    },
  });

  const actionResult = await desktopFileActions.openMediaFile(
    fixture.downloadFolder,
    fixture.mediaFile,
  );

  assert.deepEqual(actionResult, { success: true });
  assert.deepEqual(openedPaths, [fs.realpathSync.native(fixture.mediaFile)]);
});

test("history_open_folder_opens_the_item_specific_download_directory", async (t) => {
  const fixture = createFixture();
  t.after(() =>
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }),
  );
  const openedPaths = [];
  const desktopFileActions = createDesktopFileActions({
    shell: {
      openPath: async (folderPath) => {
        openedPaths.push(folderPath);
        return "";
      },
      showItemInFolder() {},
    },
  });

  const actionResult = await desktopFileActions.openPathInExplorer(
    fixture.downloadFolder,
    fixture.downloadFolder,
  );

  assert.deepEqual(actionResult, { success: true });
  assert.deepEqual(openedPaths, [
    fs.realpathSync.native(fixture.downloadFolder),
  ]);
});

test("history_action_rejects_a_file_outside_its_recorded_download_folder", async (t) => {
  const fixture = createFixture();
  t.after(() =>
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }),
  );
  const desktopFileActions = createDesktopFileActions({
    shell: {
      openPath: async () => "",
      showItemInFolder() {},
    },
  });

  await assert.rejects(
    desktopFileActions.openMediaFile(
      fixture.downloadFolder,
      fixture.outsideFile,
    ),
    /outside the downloads directory/,
  );
});
