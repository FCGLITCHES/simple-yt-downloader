const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  isDownloadsRoot,
  validateDownloadPath,
} = require("../backend/utils/path-validator");

let tmpRoot;
let downloadsDir;
let outsideDir;
let insideFile;
let insideFolder;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gvl-path-"));
  downloadsDir = path.join(tmpRoot, "downloads");
  outsideDir = path.join(tmpRoot, "outside");
  insideFile = path.join(downloadsDir, "video.mp4");
  insideFolder = path.join(downloadsDir, "playlist");

  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(insideFile, "video");
  fs.mkdirSync(insideFolder, { recursive: true });

  const symlinkTarget = path.join(outsideDir, "escaped.exe");
  const symlinkInside = path.join(downloadsDir, "escape-link");
  fs.writeFileSync(symlinkTarget, "outside");
  try {
    fs.symlinkSync(symlinkTarget, symlinkInside);
  } catch (_) {
    // Windows may require elevated privileges for symlink creation.
  }
});

test.after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {}
});

test("accepts file inside downloads", () => {
  assert.equal(
    validateDownloadPath(downloadsDir, insideFile),
    fs.realpathSync.native(insideFile),
  );
});

test("accepts folder inside downloads", () => {
  assert.equal(
    validateDownloadPath(downloadsDir, insideFolder),
    fs.realpathSync.native(insideFolder),
  );
});

test("rejects path outside downloads", () => {
  assert.throws(
    () => validateDownloadPath(downloadsDir, outsideDir),
    /Path traversal rejected/,
  );
});

test("rejects ../ traversal", () => {
  assert.throws(
    () => validateDownloadPath(downloadsDir, path.join(downloadsDir, "..", "outside")),
    /Path traversal rejected/,
  );
});

test("rejects symlink escape outside downloads", () => {
  const symlinkInside = path.join(downloadsDir, "escape-link");
  if (fs.existsSync(symlinkInside)) {
    assert.throws(
      () => validateDownloadPath(downloadsDir, symlinkInside),
      /Path traversal rejected/,
    );
  }
});

test("rejects non-existent path", () => {
  assert.throws(
    () => validateDownloadPath(downloadsDir, path.join(downloadsDir, "missing.mp4")),
    /Path does not exist/,
  );
});

test("rejects deleting downloads root", () => {
  const resolvedRoot = fs.realpathSync.native(downloadsDir);
  assert.equal(isDownloadsRoot(resolvedRoot, resolvedRoot), true);
  assert.equal(isDownloadsRoot(fs.realpathSync.native(insideFolder), resolvedRoot), false);
});

test("rejects non-string input", () => {
  assert.throws(() => validateDownloadPath(downloadsDir, null), /non-empty string/);
  assert.throws(() => validateDownloadPath(downloadsDir, ""), /non-empty string/);
  assert.throws(() => validateDownloadPath(downloadsDir, 42), /non-empty string/);
});
