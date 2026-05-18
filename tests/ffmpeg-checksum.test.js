const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");

const {
  computeSha256,
  installFfmpegFromZip,
} = require("../backend/services/ffmpeg-update-security");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExistingBinaries(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "ffmpeg.exe"), "old-ffmpeg");
  fs.writeFileSync(path.join(binDir, "ffprobe.exe"), "old-ffprobe");
  fs.writeFileSync(path.join(binDir, "ffplay.exe"), "old-ffplay");
}

function createFfmpegZip(zipPath, contentPrefix = "new") {
  const zip = new AdmZip();
  zip.addFile("ffmpeg-9.9/bin/ffmpeg.exe", Buffer.from(`${contentPrefix}-ffmpeg`));
  zip.addFile("ffmpeg-9.9/bin/ffprobe.exe", Buffer.from(`${contentPrefix}-ffprobe`));
  zip.addFile("ffmpeg-9.9/bin/ffplay.exe", Buffer.from(`${contentPrefix}-ffplay`));
  zip.writeZip(zipPath);
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

test("matching SHA256 installs staged binaries and removes backups", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-pass-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const installTmp = path.join(tmpDir, "install");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);

    const checksum = await computeSha256(sourceZip);
    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: installTmp,
      logger: silentLogger(),
      downloader: async (_, destinationPath) => fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "new-ffmpeg");
    assert.equal(fs.existsSync(path.join(binDir, "ffmpeg.exe.bak")), false);
    assert.equal(fs.existsSync(installTmp), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mismatched SHA256 rejects and leaves current binaries untouched", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-mismatch-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": "0".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) => fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Checksum verification failed/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("version not in manifest aborts before download attempt", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-untrusted-");
  try {
    const binDir = path.join(tmpDir, "bin");
    writeExistingBinaries(binDir);
    let downloadAttempted = false;

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "10.0",
      manifest: { "9.9": "1".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async () => {
        downloadAttempted = true;
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.skippedBeforeDownload, true);
    assert.equal(downloadAttempted, false);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("download failure leaves current ffmpeg untouched", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-download-fail-");
  try {
    const binDir = path.join(tmpDir, "bin");
    writeExistingBinaries(binDir);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": "1".repeat(64) },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async () => {
        throw new Error("network unavailable");
      },
    });

    assert.equal(result.success, false);
    assert.match(result.error, /network unavailable/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("locked existing binary aborts cleanly and keeps current binary", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-locked-");
  const originalRenameSync = fs.renameSync;
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    fs.renameSync = (from, to) => {
      if (from.endsWith("ffmpeg.exe") && to.endsWith("ffmpeg.exe.bak")) {
        const error = new Error("file is locked");
        error.code = "EBUSY";
        throw error;
      }
      return originalRenameSync(from, to);
    };

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) => fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /ffmpeg\.exe is locked/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("working check failure rolls back installed binaries", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-rollback-");
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": checksum },
      binDir,
      testFFmpegWorking: async () => false,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) => fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /rolled back/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
    assert.equal(fs.readFileSync(path.join(binDir, "ffprobe.exe"), "utf8"), "old-ffprobe");
    assert.equal(fs.readFileSync(path.join(binDir, "ffplay.exe"), "utf8"), "old-ffplay");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mid-install move failure rolls back binaries already replaced", async () => {
  const tmpDir = makeTempDir("gvl-ffmpeg-mid-fail-");
  const originalRenameSync = fs.renameSync;
  try {
    const sourceZip = path.join(tmpDir, "source.zip");
    const binDir = path.join(tmpDir, "bin");
    createFfmpegZip(sourceZip);
    writeExistingBinaries(binDir);
    const checksum = await computeSha256(sourceZip);

    fs.renameSync = (from, to) => {
      if (from.endsWith("ffplay.exe") && to.endsWith("ffplay.exe")) {
        throw new Error("simulated move failure");
      }
      return originalRenameSync(from, to);
    };

    const result = await installFfmpegFromZip({
      downloadUrl: "https://example.test/ffmpeg.zip",
      version: "9.9",
      manifest: { "9.9": checksum },
      binDir,
      testFFmpegWorking: async () => true,
      tmpDir: path.join(tmpDir, "install"),
      logger: silentLogger(),
      downloader: async (_, destinationPath) => fs.copyFileSync(sourceZip, destinationPath),
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Failed to install ffplay\.exe/);
    assert.equal(fs.readFileSync(path.join(binDir, "ffmpeg.exe"), "utf8"), "old-ffmpeg");
    assert.equal(fs.readFileSync(path.join(binDir, "ffprobe.exe"), "utf8"), "old-ffprobe");
    assert.equal(fs.readFileSync(path.join(binDir, "ffplay.exe"), "utf8"), "old-ffplay");
  } finally {
    fs.renameSync = originalRenameSync;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
