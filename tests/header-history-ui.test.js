"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const stylesheet = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");

test("header counters and theme selector stay flat while the speed indicator remains visible", () => {
  assert.match(
    stylesheet,
    /\.header \.stat-value\s*\{[^}]*background:\s*transparent;[^}]*border-radius:\s*0;/s,
  );
  assert.match(
    stylesheet,
    /\.header #speedValue\s*\{[^}]*font-size:\s*1\.2rem;[^}]*font-weight:\s*800;/s,
  );
  assert.match(
    stylesheet,
    /\.header \.quick-theme-select\s*\{[^}]*background-color:\s*transparent;[^}]*backdrop-filter:\s*none;/s,
  );
});

test("history tabs and history content share one container surface", () => {
  assert.match(
    stylesheet,
    /\.history-layout\s*\{[^}]*overflow:\s*hidden;[^}]*background:\s*var\(--card-bg\);[^}]*border:\s*1px solid var\(--border-color\);/s,
  );
  assert.match(
    stylesheet,
    /\.history-sidebar\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border-color\);[^}]*box-shadow:\s*none;/s,
  );
  const historyContentRule = [
    ...stylesheet.matchAll(/\.history-content\s*\{([^}]*)\}/gs),
  ]
    .map((ruleMatch) => ruleMatch[1])
    .find((ruleBody) => /flex:\s*1;/.test(ruleBody));

  assert.ok(historyContentRule);
  assert.match(historyContentRule, /border:\s*0;/);
  assert.match(historyContentRule, /border-radius:\s*0;/);
  assert.match(historyContentRule, /box-shadow:\s*none;/);
});

test("history toolbar uses a grouped segmented control and aligned filter row", () => {
  assert.match(
    stylesheet,
    /\.history-tabs\s*\{[^}]*padding:\s*0\.25rem;[^}]*background:\s*var\(--input-bg\);[^}]*border-radius:\s*10px;/s,
  );
  const activeHistoryTabRule = stylesheet.match(
    /\.history-tab\.active,\s*\.history-tab:hover\s*\{([^}]*)\}/s,
  )?.[1];

  assert.ok(activeHistoryTabRule);
  assert.match(activeHistoryTabRule, /box-shadow:\s*none;/);
  assert.match(activeHistoryTabRule, /transform:\s*none;/);
  assert.match(
    stylesheet,
    /\.history-header\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;[^}]*margin-top:\s*0;[^}]*padding:\s*0\.75rem 1\.5rem;/s,
  );
});
