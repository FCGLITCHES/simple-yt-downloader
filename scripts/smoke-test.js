const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_URLS = {
  youtube: process.env.TEST_YOUTUBE_URL || "",
  tiktok: process.env.TEST_TIKTOK_URL || "",
};

const binDir = path.join(__dirname, "..", "bin");
const ytdlpPath = path.join(binDir, "yt-dlp.exe");
const ffmpegPath = path.join(binDir, "ffmpeg.exe");
const ffprobePath = path.join(binDir, "ffprobe.exe");

const ytdlpExecutable = fs.existsSync(ytdlpPath) ? ytdlpPath : "yt-dlp";
const ffmpegExecutable = fs.existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg";

let passed = 0;
let failed = 0;
let skipped = 0;

function logResult(name, status, detail) {
  const icon = status === "pass" ? "✅" : status === "fail" ? "❌" : "⚠️";
  console.log(`${icon} ${name}: ${detail}`);
  if (status === "pass") passed++;
  else if (status === "fail") failed++;
  else skipped++;
}

async function testFFmpegBinaryExists() {
  const name = "FFmpeg binary exists";
  if (fs.existsSync(ffmpegPath)) {
    const stats = fs.statSync(ffmpegPath);
    logResult(
      name,
      "pass",
      `Found at ${ffmpegPath} (${Math.round(stats.size / 1024 / 1024)}MB)`,
    );
  } else {
    logResult(name, "fail", `Not found at ${ffmpegPath}`);
    throw new Error("FFmpeg binary not found");
  }
}

async function testFFprobeBinaryExists() {
  const name = "FFprobe binary exists";
  if (fs.existsSync(ffprobePath)) {
    logResult(name, "pass", `Found at ${ffprobePath}`);
  } else {
    logResult(name, "fail", `Not found at ${ffprobePath}`);
  }
}

async function testFFmpegVersion() {
  const name = "FFmpeg version";
  return new Promise((resolve) => {
    const proc = spawn(ffmpegExecutable, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data));
    proc.stderr.on("data", (data) => (stderr += data));

    proc.on("close", (code) => {
      const output = (stdout + stderr).trim();
      if (code === 0 && output) {
        const firstLine = output.split("\n")[0];
        logResult(name, "pass", firstLine);
        resolve(true);
      } else {
        logResult(name, "fail", `Exit code ${code}`);
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      logResult(name, "fail", err.message);
      resolve(false);
    });
  });
}

async function testFFmpegEncoding() {
  const name = "FFmpeg encoding (lavfi test)";
  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegExecutable,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1:size=320x240:rate=1",
        "-f",
        "null",
        "-",
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 15000,
      },
    );

    let stderr = "";
    proc.stderr.on("data", (data) => (stderr += data));

    proc.on("close", (code) => {
      if (code === 0) {
        logResult(name, "pass", "Test source encoding succeeded");
        resolve(true);
      } else {
        logResult(
          name,
          "fail",
          `Exit code ${code}: ${stderr.substring(0, 200)}`,
        );
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      logResult(name, "fail", err.message);
      resolve(false);
    });
  });
}

async function testFFmpegAudioEncoding() {
  const name = "FFmpeg audio encoding (sine test)";
  const tmpOut = path.join(os.tmpdir(), `smoke_test_audio_${Date.now()}.wav`);

  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegExecutable,
      [
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-y",
        tmpOut,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 15000,
      },
    );

    let stderr = "";
    proc.stderr.on("data", (data) => (stderr += data));

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(tmpOut)) {
        const stats = fs.statSync(tmpOut);
        try {
          fs.unlinkSync(tmpOut);
        } catch (e) {
          void e;
        }
        logResult(
          name,
          "pass",
          `Audio encoding succeeded (${stats.size} bytes)`,
        );
        resolve(true);
      } else {
        try {
          fs.unlinkSync(tmpOut);
        } catch (e) {
          void e;
        }
        logResult(
          name,
          "fail",
          `Exit code ${code}: ${stderr.substring(0, 200)}`,
        );
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      try {
        fs.unlinkSync(tmpOut);
      } catch (e) {
        void e;
      }
      logResult(name, "fail", err.message);
      resolve(false);
    });
  });
}

async function testFFmpegMuxing() {
  const name = "FFmpeg muxing (video+audio merge)";
  const tmpDir = os.tmpdir();
  const tmpVideo = path.join(tmpDir, `smoke_test_v_${Date.now()}.mp4`);
  const tmpOutput = path.join(tmpDir, `smoke_test_muxed_${Date.now()}.mp4`);

  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegExecutable,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1:size=320x240:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-y",
        tmpVideo,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30000,
      },
    );

    let stderr = "";
    proc.stderr.on("data", (data) => (stderr += data));

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(tmpVideo)) {
        const muxProc = spawn(
          ffmpegExecutable,
          ["-i", tmpVideo, "-c", "copy", "-y", tmpOutput],
          {
            stdio: ["ignore", "ignore", "pipe"],
            timeout: 15000,
          },
        );

        let muxStderr = "";
        muxProc.stderr.on("data", (data) => (muxStderr += data));

        muxProc.on("close", (muxCode) => {
          const success = muxCode === 0 && fs.existsSync(tmpOutput);
          const outSize = fs.existsSync(tmpOutput)
            ? fs.statSync(tmpOutput).size
            : 0;
          try {
            fs.unlinkSync(tmpVideo);
          } catch (_) {}
          try {
            fs.unlinkSync(tmpOutput);
          } catch (_) {}

          if (success) {
            logResult(name, "pass", `Muxing succeeded (${outSize} bytes)`);
          } else {
            logResult(name, "fail", `Muxing failed: exit code ${muxCode}`);
          }
          resolve(success);
        });

        muxProc.on("error", () => {
          try {
            fs.unlinkSync(tmpVideo);
          } catch (_) {}
          try {
            fs.unlinkSync(tmpOutput);
          } catch (_) {}
          logResult(name, "fail", "Muxing spawn error");
          resolve(false);
        });
      } else {
        try {
          fs.unlinkSync(tmpVideo);
        } catch (_) {}
        logResult(name, "fail", `Encode failed: exit code ${code}`);
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      try {
        fs.unlinkSync(tmpVideo);
      } catch (_) {}
      logResult(name, "fail", err.message);
      resolve(false);
    });
  });
}

async function testYtDlpFFmpegIntegration() {
  const name = "yt-dlp --ffmpeg-location flag";
  return new Promise((resolve) => {
    const proc = spawn(ytdlpExecutable, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });

    let stdout = "";
    proc.stdout.on("data", (data) => (stdout += data));

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        logResult(name, "pass", `yt-dlp version ${stdout.trim()}`);
        resolve(true);
      } else {
        logResult(name, "fail", `Exit code ${code}`);
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      logResult(name, "fail", err.message);
      resolve(false);
    });
  });
}

async function testVideoInfo(url, extractor) {
  return new Promise((resolve, reject) => {
    if (!url) {
      return resolve({
        skipped: true,
        extractor,
        reason: "No test URL provided",
      });
    }

    const args = [
      "--dump-json",
      "--no-download",
      "--no-playlist",
      "--ffmpeg-location",
      ffmpegExecutable,
      url,
    ];

    const proc = spawn(ytdlpExecutable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const info = JSON.parse(stdout);
          logResult(
            `${extractor} extractor`,
            "pass",
            `Title: ${(info.title || "N/A").substring(0, 60)}, Duration: ${info.duration || "N/A"}s`,
          );
          resolve({
            success: true,
            extractor,
            title: info.title,
            duration: info.duration,
          });
        } catch (e) {
          logResult(
            `${extractor} extractor`,
            "fail",
            `JSON parse error: ${e.message}`,
          );
          reject(new Error(`JSON parse error for ${extractor}: ${e.message}`));
        }
      } else {
        logResult(
          `${extractor} extractor`,
          "fail",
          `Exit code ${code}: ${stderr.substring(0, 200)}`,
        );
        reject(
          new Error(
            `${extractor} extraction failed: ${stderr.substring(0, 200)}`,
          ),
        );
      }
    });

    proc.on("error", (error) => {
      logResult(`${extractor} extractor`, "fail", error.message);
      reject(new Error(`${extractor} spawn error: ${error.message}`));
    });
  });
}

async function runSmokeTests() {
  console.log("🚀 Starting smoke tests...\n");
  console.log("═══════════════════════════════════════");
  console.log("  FFmpeg & Binary Tests");
  console.log("═══════════════════════════════════════\n");

  await testFFmpegBinaryExists();
  await testFFprobeBinaryExists();
  await testFFmpegVersion();
  await testFFmpegEncoding();
  await testFFmpegAudioEncoding();
  await testFFmpegMuxing();
  await testYtDlpFFmpegIntegration();

  console.log("\n═══════════════════════════════════════");
  console.log("  yt-dlp Extractor Tests");
  console.log("═══════════════════════════════════════\n");

  const extractorResults = [];

  if (TEST_URLS.youtube) {
    try {
      const result = await testVideoInfo(TEST_URLS.youtube, "youtube");
      extractorResults.push(result);
    } catch (_) {}
  } else {
    console.log("⚠️  YouTube test URL not provided, skipping...");
    skipped++;
  }

  if (TEST_URLS.tiktok) {
    try {
      const result = await testVideoInfo(TEST_URLS.tiktok, "tiktok");
      extractorResults.push(result);
    } catch (_) {}
  }

  console.log("\n═══════════════════════════════════════");
  console.log("  Test Summary");
  console.log("═══════════════════════════════════════");
  console.log(`   Passed:  ${passed}`);
  console.log(`   Failed:  ${failed}`);
  console.log(`   Skipped: ${skipped}`);

  if (failed > 0) {
    console.log("\n❌ Smoke tests failed!");
    process.exit(1);
  } else if (passed === 0) {
    console.log("\n⚠️  No tests were run");
    process.exit(0);
  } else {
    console.log("\n✅ All smoke tests passed!");
    process.exit(0);
  }
}

runSmokeTests().catch((error) => {
  console.error("\n💥 Fatal error running smoke tests:", error);
  process.exit(1);
});
