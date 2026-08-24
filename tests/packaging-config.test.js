const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const builderConfig = require("../electron-builder.json");
const packageManifest = require("../package.json");
const packageLock = require("../package-lock.json");

test("3.2.0 release metadata stays aligned across package and UI boundaries", () => {
  const indexHtml = fs.readFileSync(
    path.join(projectRoot, "index.html"),
    "utf8",
  );
  const rendererScript = fs.readFileSync(
    path.join(projectRoot, "script.js"),
    "utf8",
  );

  assert.equal(packageManifest.version, "3.2.0");
  assert.equal(packageLock.version, "3.2.0");
  assert.equal(packageLock.packages[""].version, "3.2.0");
  assert.match(indexHtml, /window\.APP_VERSION = '3\.2\.0'/);
  assert.match(rendererScript, /DEFAULT_APP_VERSION = '3\.2\.0'/);
  assert.match(indexHtml, /Choose A Folder Directly/);
  assert.match(rendererScript, /Choose A Folder Directly/);
  assert.match(indexHtml, /Bolder, More Readable Type/);
  assert.match(rendererScript, /Bolder, More Readable Type/);
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

test("Windows brand icon owns executable, installer, window, and tray surfaces", () => {
  const canonicalIcon = "public/Logo1.ico";
  const electronMain = fs.readFileSync(
    path.join(projectRoot, "electron-main.js"),
    "utf8",
  );
  const portableIconScript = fs.readFileSync(
    path.join(projectRoot, "set-icon.js"),
    "utf8",
  );
  const windowsBranding = fs.readFileSync(
    path.join(projectRoot, "scripts", "windows-branding.js"),
    "utf8",
  );
  const afterPackBranding = fs.readFileSync(
    path.join(projectRoot, "scripts", "brand-packaged-windows-executable.js"),
    "utf8",
  );
  const iconVerifier = fs.readFileSync(
    path.join(projectRoot, "verify-icon.js"),
    "utf8",
  );

  assert.equal(builderConfig.win.icon, canonicalIcon);
  assert.equal(builderConfig.win.signAndEditExecutable, false);
  assert.equal(
    builderConfig.afterPack,
    "scripts/brand-packaged-windows-executable.js",
  );
  assert.equal(builderConfig.nsis.installerIcon, canonicalIcon);
  assert.equal(builderConfig.nsis.uninstallerIcon, canonicalIcon);
  assert.equal(builderConfig.nsis.installerHeaderIcon, canonicalIcon);
  assert.equal(builderConfig.mac.icon, canonicalIcon);
  assert.equal(builderConfig.linux.icon, canonicalIcon);
  assert.match(electronMain, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
  assert.match(
    electronMain,
    /path\.join\(__dirname, 'public', 'Logo1\.ico'\)/,
  );
  assert.match(electronMain, /new Tray\(trayIcon\.resize/);
  assert.equal(
    (electronMain.match(/icon: WINDOWS_BRAND_ICON_PATH/g) || []).length,
    2,
  );
  assert.match(windowsBranding, /"public",\s*"Logo1\.ico"/);
  assert.match(windowsBranding, /["']product-version["']: version/);
  assert.match(portableIconScript, /brandWindowsExecutable\(exePath\)/);
  assert.match(afterPackBranding, /brandWindowsExecutable\(executablePath\)/);
  assert.match(
    iconVerifier,
    /["']public["'],\s*["']Logo1\.ico["']/,
  );
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

  const portableBuildScript = fs.readFileSync(
    path.join(projectRoot, "build-portable.js"),
    "utf8",
  );
  assert.match(
    portableBuildScript,
    /"public",\s*"Logo1\.ico"/,
  );
  assert.doesNotMatch(portableBuildScript, /Logo_1|public[\\/]icons/);
});

test("public branding keeps only the canonical Logo1 icon", () => {
  const publicBrandAssets = fs
    .readdirSync(path.join(projectRoot, "public"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes("logo") ||
        entry.name.toLowerCase() === "icons",
    )
    .map((entry) => entry.name);

  assert.deepEqual(publicBrandAssets, ["Logo1.ico"]);
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
