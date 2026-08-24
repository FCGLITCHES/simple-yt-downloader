"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createTransferSpeedEstimator,
  getHdrFormatSortKey,
  normalizeVideoTargetHeight,
} = require("../backend/utils/download-job-helpers");

const projectRoot = path.join(__dirname, "..");

test("tiny_initial_disk_sample_does_not_permanently_pin_reported_speed", () => {
  const estimator = createTransferSpeedEstimator();
  const filePath = "C:\\Downloads\\eight-k-video.mp4.part";

  assert.equal(
    estimator.observe({ filePath, fileSize: 0, observedAt: 1_000 }),
    null,
  );
  assert.equal(
    estimator.observe({ filePath, fileSize: 3_750, observedAt: 2_000 }),
    3_750,
  );

  estimator.observe({
    filePath,
    fileSize: 50_003_750,
    observedAt: 3_000,
  });
  const recoveredSpeed = estimator.observe({
    filePath,
    fileSize: 100_003_750,
    observedAt: 4_000,
  });

  assert.ok(
    recoveredSpeed > 5_000_000,
    "two sustained high samples must recover from the original 0.03 Mbps-sized sample",
  );
});

test("native_speed_fallback_wins_when_disk_tracking_is_unreliable", () => {
  const estimator = createTransferSpeedEstimator();
  const filePath = "C:\\Downloads\\video.mp4.part";

  estimator.observe({ filePath, fileSize: 0, observedAt: 1_000 });
  estimator.observe({ filePath, fileSize: 4_000, observedAt: 2_000 });

  assert.equal(
    estimator.getSpeed({ now: 2_000, fallbackSpeed: 50_000_000 }),
    50_000_000,
  );
});

test("speed_estimator_resets_when_yt_dlp_switches_output_streams", () => {
  const estimator = createTransferSpeedEstimator();

  estimator.observe({
    filePath: "C:\\Downloads\\video.f702.mp4.part",
    fileSize: 0,
    observedAt: 1_000,
  });
  estimator.observe({
    filePath: "C:\\Downloads\\video.f702.mp4.part",
    fileSize: 20_000_000,
    observedAt: 2_000,
  });

  assert.equal(
    estimator.observe({
      filePath: "C:\\Downloads\\video.f140.m4a.part",
      fileSize: 1_000,
      observedAt: 3_000,
    }),
    null,
  );
  assert.equal(
    estimator.getSpeed({ now: 3_000, fallbackSpeed: 2_000_000 }),
    2_000_000,
  );
});

test("8k_quality_normalization_and_ui_option_remain_available", () => {
  assert.equal(normalizeVideoTargetHeight("highest"), 4320);
  assert.equal(normalizeVideoTargetHeight("8k"), 4320);
  assert.equal(normalizeVideoTargetHeight("4320p"), 4320);
  assert.equal(normalizeVideoTargetHeight("4k"), 2160);
  assert.equal(normalizeVideoTargetHeight("2160"), 2160);
  assert.equal(normalizeVideoTargetHeight("invalid", 1080), 1080);
  assert.throws(() => normalizeVideoTargetHeight("invalid"), RangeError);

  const clientSource = fs.readFileSync(
    path.join(projectRoot, "script.js"),
    "utf8",
  );
  assert.match(clientSource, /value:\s*'4320',\s*text:\s*'8K \(4320p\)'/);
});

test("video_format_selectors_cap_each_requested_resolution", () => {
  const serverSource = fs.readFileSync(
    path.join(projectRoot, "server.js"),
    "utf8",
  );

  assert.match(
    serverSource,
    /bestvideo\*\[height<=\$\{targetHeight\}\]\+bestaudio/,
  );
  assert.match(serverSource, /getHdrFormatSortKey\(settings\)/);
  assert.doesNotMatch(serverSource, /const qualityMap\s*=/);
});

test("hdr_preference_maps_to_explicit_yt_dlp_sorting", () => {
  assert.equal(getHdrFormatSortKey({ preferHdr: true }), "hdr:12");
  assert.equal(getHdrFormatSortKey({ preferHdr: false }), "+hdr");
  assert.equal(getHdrFormatSortKey({}), "+hdr");
});
