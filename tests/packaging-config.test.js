const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const builderConfig = require("../electron-builder.json");
const packageManifest = require("../package.json");
const packageLock = require("../package-lock.json");

test("3.1 release metadata stays aligned across package and UI boundaries", () => {
  const indexHtml = fs.readFileSync(
    path.join(projectRoot, "index.html"),
    "utf8",
  );
  const rendererScript = fs.readFileSync(
    path.join(projectRoot, "script.js"),
    "utf8",
  );

  assert.equal(packageManifest.version, "3.1.0");
  assert.equal(packageLock.version, "3.1.0");
  assert.equal(packageLock.packages[""].version, "3.1.0");
  assert.match(indexHtml, /window\.APP_VERSION = '3\.1\.0'/);
  assert.match(rendererScript, /DEFAULT_APP_VERSION = '3\.1\.0'/);
  assert.match(indexHtml, /44% Smaller Installation/);
  assert.match(rendererScript, /44% Smaller Installation/);
});

test("installer packages each resource family exactly once", () => {
  const packagedFiles = builderConfig.files;
  const extraResourceNames = builderConfig.extraResources.map(
    ({ from }) => from,
  );

  assert.equal(packagedFiles.includes("**/*"), false);
  assert.equal(packagedFiles.includes("public/**/*"), true);
  assert.equal(packagedFiles.includes("!bin/**"), true);
  assert.equal(packagedFiles.includes("!assets/**"), true);
  assert.deepEqual(extraResourceNames, ["bin", "assets"]);
});

test("portable release ZIP includes the package version", () => {
  const zipBuildScript = fs.readFileSync(
    path.join(projectRoot, "zip-build.js"),
    "utf8",
  );

  assert.match(zipBuildScript, /require\("\.\/package\.json"\)/);
  assert.match(
    zipBuildScript,
    /`\$\{productName\}-Portable-\$\{version\}\.zip`/,
  );
});

test("runtime tool payload excludes unused ffplay", () => {
  const binDir = path.join(projectRoot, "bin");
  const ffmpegUpdater = fs.readFileSync(
    path.join(projectRoot, "backend", "services", "ffmpeg-update-security.js"),
    "utf8",
  );

  assert.equal(fs.existsSync(path.join(binDir, "ffplay.exe")), false);
  assert.equal(fs.existsSync(path.join(binDir, "ffmpeg.exe")), true);
  assert.equal(fs.existsSync(path.join(binDir, "ffprobe.exe")), true);
  assert.doesNotMatch(ffmpegUpdater, /"ffplay\.exe"/);
});

test("uninstaller cleans current identifiers and preserves downloads by default", () => {
  const installerScript = fs.readFileSync(
    path.join(projectRoot, "installer", "installer.nsh"),
    "utf8",
  );

  assert.match(installerScript, /DeleteRegValue HKCU .* "GetVideosLocally"/);
  assert.match(installerScript, /RMDir \/r "\$LOCALAPPDATA\\GetVideosLocally"/);
  assert.match(installerScript, /MB_DEFBUTTON2/);
  assert.match(
    installerScript,
    /Rename "\$0" "\$APPDATA\\GetVideosLocally\\downloads"/,
  );
  assert.match(installerScript, /IfErrors gvl_preserve_failed/);
  assert.match(installerScript, /IfErrors gvl_restore_failed/);
});
