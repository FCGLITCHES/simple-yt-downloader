const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("portable build ships the FFmpeg trust manifest", () => {
  const buildPortable = readProjectFile("build-portable.js");
  assert.match(buildPortable, /ffmpeg-checksums\.json/);
});

test("IPC sender check only allows exact 127.0.0.1 origin on the real port", () => {
  const electronMain = readProjectFile("electron-main.js");
  assert.match(electronMain, /function assertTrustedIpcSender/);
  assert.match(electronMain, /parsed\.origin === `http:\/\/127\.0\.0\.1:\$\{serverPort\}`/);
  assert.doesNotMatch(electronMain, /parsed\.origin === `http:\/\/localhost:\$\{serverPort\}`/);
  assert.doesNotMatch(electronMain, /includes\(parsed\.origin\)/);
});

test("file and folder delete handlers use Recycle Bin without permanent fallback", () => {
  const electronMain = readProjectFile("electron-main.js");
  const deleteFileHandler = electronMain.match(
    /ipcMain\.handle\('delete-file'[\s\S]*?\n\}\);/,
  )?.[0];
  const deleteFolderHandler = electronMain.match(
    /ipcMain\.handle\('delete-folder'[\s\S]*?\n\}\);/,
  )?.[0];

  assert.ok(deleteFileHandler);
  assert.ok(deleteFolderHandler);
  assert.match(deleteFileHandler, /assertTrustedIpcSender/);
  assert.match(deleteFileHandler, /validateDownloadPath/);
  assert.match(deleteFileHandler, /stats\.isFile\(\)/);
  assert.match(deleteFileHandler, /shell\.trashItem/);
  assert.doesNotMatch(deleteFileHandler, /unlinkSync|rmSync/);

  assert.match(deleteFolderHandler, /assertTrustedIpcSender/);
  assert.match(deleteFolderHandler, /validateDownloadPath/);
  assert.match(deleteFolderHandler, /stats\.isDirectory\(\)/);
  assert.match(deleteFolderHandler, /isDownloadsRoot/);
  assert.match(deleteFolderHandler, /shell\.trashItem/);
  assert.doesNotMatch(deleteFolderHandler, /unlinkSync|rmSync/);
});

test("silent firewall setup is not called during window creation", () => {
  const electronMain = readProjectFile("electron-main.js");
  const createWindow = electronMain.match(/async function createWindow\(\)[\s\S]*?function startServer\(\)/)?.[0];
  assert.ok(createWindow);
  assert.doesNotMatch(createWindow, /setupFirewallRule\(\)\.catch/);
  assert.match(electronMain, /ipcMain\.handle\('enable-firewall-rule'/);
  assert.match(electronMain, /dialog\.showMessageBox/);
});
