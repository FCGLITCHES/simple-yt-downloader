"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { HistoryIndex } = require("../backend/state/history-index");

test("history_index_preserves_original_folder_after_settings_location_changes", async (t) => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gvl-history-index-"),
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const historyIndexPath = path.join(fixtureRoot, "history-index.json");
  const originalFolder = path.join(fixtureRoot, "original-downloads");
  const originalFile = path.join(originalFolder, "saved-video.mp4");
  const historyIndex = new HistoryIndex({ filePath: historyIndexPath });
  await historyIndex._loadPromise;

  await historyIndex.recordDownload({
    clientId: "desktop-client",
    name: "Saved video",
    path: "/downloads/saved-video.mp4",
    fullPath: originalFile,
    folder: originalFolder,
    mtime: "2026-08-31T00:00:00.000Z",
  });

  const reloadedHistoryIndex = new HistoryIndex({ filePath: historyIndexPath });
  await reloadedHistoryIndex._loadPromise;
  const [storedHistoryItem] =
    reloadedHistoryIndex.getClientHistory("desktop-client").items;

  assert.equal(storedHistoryItem.fullPath, originalFile);
  assert.equal(storedHistoryItem.folder, originalFolder);
});

test("history_index_unifies_legacy_client_ids_after_update", async (t) => {
  const regressionCase = {
    originalScenario:
      "An update preserves history-index.json but Electron creates a new browser client ID.",
    expectedStableBehavior:
      "Every existing local history entry remains visible and the next sync compacts legacy client IDs without duplicates.",
    motivatingFailureMode: "preserved_history_hidden_by_new_client_id",
    reason:
      "Desktop history belongs to the local installation, not an ephemeral renderer ID.",
    caseType: "compatibility test",
  };
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gvl-history-unified-"),
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const historyIndexPath = path.join(fixtureRoot, "history-index.json");
  const historyIndex = new HistoryIndex({ filePath: historyIndexPath });
  await historyIndex._loadPromise;

  await historyIndex.recordDownload({
    clientId: "legacy-client-a",
    name: "First saved video",
    fullPath: path.join(fixtureRoot, "first.mp4"),
    mtime: "2026-08-25T12:00:00.000Z",
  });
  await historyIndex.recordDownload({
    clientId: "legacy-client-b",
    name: "Second saved video",
    fullPath: path.join(fixtureRoot, "second.mp4"),
    mtime: "2026-08-26T12:00:00.000Z",
  });
  await historyIndex.recordDownload({
    clientId: "legacy-client-b",
    name: "First saved video duplicate",
    fullPath: path.join(fixtureRoot, "first.mp4"),
    mtime: "2026-08-25T12:00:00.000Z",
  });

  const unifiedHistory = historyIndex.getUnifiedHistory();
  assert.ok(regressionCase.originalScenario);
  assert.deepEqual(
    unifiedHistory.items.map((historyItem) => historyItem.name),
    ["Second saved video", "First saved video"],
  );

  const syncedHistory = await historyIndex.syncUnifiedHistory(
    "replacement-client",
    unifiedHistory.items,
  );
  assert.equal(syncedHistory.items.length, 2);
  assert.deepEqual(Object.keys(historyIndex.state.clients), [
    "replacement-client",
  ]);

  const reloadedHistoryIndex = new HistoryIndex({ filePath: historyIndexPath });
  await reloadedHistoryIndex._loadPromise;
  assert.equal(reloadedHistoryIndex.getUnifiedHistory().items.length, 2);
});
