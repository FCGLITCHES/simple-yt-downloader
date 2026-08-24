"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const rendererSource = fs.readFileSync(
  path.join(projectRoot, "script.js"),
  "utf8",
);
const stylesheet = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");
const cookiesHtml = fs.readFileSync(
  path.join(projectRoot, "public", "cookies.html"),
  "utf8",
);

test("hdr_defaults_off_and_saved_or_per_download_overrides_share_one_payload", () => {
  assert.match(indexHtml, /id="preferHdr"/);
  assert.match(indexHtml, /id="hdrModeOverride"/);
  assert.match(indexHtml, /value="settings" selected/);
  assert.match(indexHtml, /value="enabled">Prefer HDR/);
  assert.match(indexHtml, /value="disabled">Prefer SDR/);
  assert.match(rendererSource, /preferHdr:\s*false/);
  assert.match(
    rendererSource,
    /preferHdr:\s*preferHdrCheckbox \? preferHdrCheckbox\.checked : false/,
  );
  assert.match(rendererSource, /userSettings\.preferHdr === true/);
  assert.match(rendererSource, /\.\.\.userSettings,\s*preferHdr,/s);
  assert.match(
    rendererSource,
    /includeAutoCaptionsCheckbox\.checked = userSettings\.includeAutoCaptions === true;\s*updateSubtitleVisibility\(\);/s,
  );
});

test("advanced_download_options_and_subtitles_use_flat_integrated_sections", () => {
  assert.match(indexHtml, /class="advanced-options-title"/);
  assert.match(indexHtml, /class="settings-subsection-heading"/);
  assert.doesNotMatch(indexHtml, /HDR is used when the source/);
  assert.doesNotMatch(indexHtml, /Select HDR when available/);
  assert.doesNotMatch(indexHtml, /Choose how captions are included/);
  assert.doesNotMatch(indexHtml, />Subtitle handling</);
  assert.match(indexHtml, /id="subtitleMode"[^>]*aria-label="Subtitles"/);
  assert.match(
    stylesheet,
    /\.advanced-options-panel\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.doesNotMatch(
    stylesheet,
    /\.advanced-options-panel\s*\{[^}]*box-shadow:/s,
  );
  assert.match(
    stylesheet,
    /\.subtitle-settings-group\s*\{[^}]*border-top:\s*1px solid var\(--border-color\)/s,
  );
  assert.match(
    stylesheet,
    /\.settings-modal \.setting-item\.checkbox-group\.is-hidden-initial\s*\{[^}]*display:\s*none;/s,
  );
});

test("compact_whats_new_keeps_close_actions_visible", () => {
  assert.match(rendererSource, /id="updateCloseBtn"/);
  assert.match(rendererSource, /id="updateDismissBtn"[^>]*>Got it</);
  assert.match(
    rendererSource,
    /getElementById\('updateCloseBtn'\)\?\.addEventListener\('click', dismiss\)/,
  );
  assert.match(
    stylesheet,
    /\.update-items-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
  );
  assert.match(
    stylesheet,
    /\.update-modal-content\s*\{[^}]*max-height:\s*min\(640px, calc\(100dvh - 2rem\)\)/s,
  );
  assert.match(
    stylesheet,
    /#updateModal \.onboarding-nav-bar\s*\{[^}]*padding:\s*0\.7rem 1\.25rem;/s,
  );
});

test("modal headings_are_bold_and_support_actions_are_flat", () => {
  assert.doesNotMatch(indexHtml, /style="/);
  assert.match(
    stylesheet,
    /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-weight:\s*800;/s,
  );
  assert.match(stylesheet, /\.modal-content h2\s*\{[^}]*font-weight:\s*800;/s);
  assert.match(
    stylesheet,
    /\.support-modal-actions \.action-btn\s*\{[^}]*box-shadow:\s*none;[^}]*transform:\s*none;/s,
  );
});

test("cookie_importer_uses_responsive_flat_red_and_white_flow", () => {
  const cookieMarkup = cookiesHtml.slice(0, cookiesHtml.indexOf("<script>"));

  assert.match(cookiesHtml, /min-height:\s*100dvh/);
  assert.doesNotMatch(cookiesHtml, /100vh/);
  assert.match(cookiesHtml, /--cookies-accent:\s*#d7192d/);
  assert.match(cookiesHtml, /class="upload-zone-content"/);
  assert.match(cookiesHtml, /class="cookie-note"/);
  assert.equal((cookieMarkup.match(/<li><span>/g) || []).length, 5);
  assert.doesNotMatch(cookieMarkup, /style="/);
  assert.match(cookiesHtml, /\.cookie-btn\s*\{[^}]*box-shadow:\s*none;/s);
  assert.doesNotMatch(
    cookiesHtml,
    /\.cookie-btn-(?:clear|save)\s*\{[^}]*linear-gradient/s,
  );
});
