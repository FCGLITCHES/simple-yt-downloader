"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const stylesheet = fs.readFileSync(
  path.join(__dirname, "..", "style.css"),
  "utf8",
);

test("settings checkbox rows are compact and do not draw internal separators", () => {
  assert.match(
    stylesheet,
    /\.settings-modal \.setting-item\.checkbox-group,\s*\.settings-modal \.setting-item-with-help\s*\{[^}]*padding-top:\s*0;[^}]*padding-bottom:\s*0;[^}]*border-top:\s*0;[^}]*border-bottom:\s*0;/s,
  );
  assert.match(
    stylesheet,
    /\.settings-modal \.telemetry-setting\s*\{[^}]*padding-top:\s*0;[^}]*border-top:\s*0;/s,
  );
});
