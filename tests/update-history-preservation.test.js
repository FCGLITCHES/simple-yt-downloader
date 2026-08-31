"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const installerSource = fs.readFileSync(
  path.join(projectRoot, "installer", "installer.nsh"),
  "utf8",
);
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const rendererSource = fs.readFileSync(
  path.join(projectRoot, "script.js"),
  "utf8",
);

test("installer_update_preserves_history_storage_and_static_history_tab_remains_visible", () => {
  const regressionCase = {
    originalScenario:
      "Install a newer setup over an existing GetVideosLocally installation with saved history.",
    expectedStableBehavior:
      "The upgrade preserves Electron Local Storage and history-index.json, then renders the History navigation and panel.",
    motivatingFailureMode: "installer_update_deleted_or_hid_download_history",
    reason:
      "Version updates must never make a user's completed-download history disappear.",
    caseType: "compatibility test",
  };

  const customUninstallStart = installerSource.indexOf(
    "!macro customUnInstall",
  );
  const customUninstallMacro = installerSource.slice(
    customUninstallStart,
    installerSource.indexOf("!macroend", customUninstallStart),
  );
  const updateGuardStart = customUninstallMacro.indexOf(
    "${ifNot} ${isUpdated}",
  );
  const appDataCleanup = customUninstallMacro.indexOf(
    'RMDir /r "$APPDATA\\GetVideosLocally"',
  );
  const updateGuardEnd = customUninstallMacro.lastIndexOf("${endIf}");
  const customInitMacro = installerSource.slice(
    installerSource.indexOf("!macro customInit"),
    installerSource.indexOf("!macro customInstall"),
  );
  const customInstallMacro = installerSource.slice(
    installerSource.indexOf("!macro customInstall"),
    installerSource.indexOf("!macro customUnInstall"),
  );

  assert.ok(regressionCase.originalScenario);
  assert.ok(updateGuardStart >= 0);
  assert.ok(appDataCleanup > updateGuardStart);
  assert.ok(updateGuardEnd > appDataCleanup);
  assert.match(
    customInitMacro,
    /Rename "\$APPDATA\\GetVideosLocally" "\$gvlUpdateUserDataBackup"/,
  );
  assert.match(customInitMacro, /IfErrors gvl_update_snapshot_failed/);
  assert.match(
    customInstallMacro,
    /Rename "\$gvlUpdateUserDataBackup" "\$APPDATA\\GetVideosLocally"/,
  );
  assert.match(customInstallMacro, /IfErrors gvl_update_restore_failed/);
  assert.match(
    indexHtml,
    /<a href="#" id="historyTab" class="nav-link">History<\/a>/,
  );
  assert.match(indexHtml, /<div id="historyPanel" class="is-hidden-initial">/);
  assert.match(rendererSource, /tab === 'history' \? 'historyPanel'/);
  assert.match(
    rendererSource,
    /if \(historyTab\) historyTab\.onclick = .*showTab\('history'\)/,
  );
  assert.match(
    rendererSource,
    /localStorage\.setItem\('ytdHistory', JSON\.stringify\(nextBackendItems\)\)/,
  );
  assert.doesNotMatch(
    rendererSource,
    /allHistory\.filter\(item => !item\.clientId \|\| item\.clientId === clientId\)/,
  );
});
