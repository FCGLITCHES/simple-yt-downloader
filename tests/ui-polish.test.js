const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const stylesheet = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");

test("Manrope is the primary app, heading, and header wordmark typeface", () => {
  assert.match(stylesheet, /body\s*\{[^}]*font-family:\s*'Manrope'/s);
  assert.match(
    stylesheet,
    /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-family:\s*'Manrope'[^}]*font-weight:\s*800/s,
  );
  assert.match(
    stylesheet,
    /\.logo-text\s*\{[^}]*font-family:\s*'Manrope'[^}]*font-weight:\s*800/s,
  );
});

test("onboarding step numbers use a flat visual treatment", () => {
  assert.match(
    stylesheet,
    /\.setup-step-pill\.onboarding-step-dot\s*\{[^}]*box-shadow:\s*none/s,
  );
  assert.match(
    stylesheet,
    /\.setup-step-pill\.is-active\s*\{[^}]*background:\s*var\(--setup-red\)[^}]*box-shadow:\s*none/s,
  );
});

test("light theme support control keeps white content without a shadow", () => {
  assert.doesNotMatch(indexHtml, /fa-heart[^>]*style=/);
  assert.match(
    stylesheet,
    /\[data-theme="light"\] \.footer \.support-btn[\s\S]*?color:\s*#fff;/,
  );
  assert.match(stylesheet, /\.support-btn\s*\{[^}]*box-shadow:\s*none/s);
  assert.match(stylesheet, /\.support-btn:hover\s*\{[^}]*box-shadow:\s*none/s);
});

test("LAN guidance is a hover and keyboard-focus tooltip", () => {
  assert.match(indexHtml, /class="settings-help-trigger"/);
  assert.match(indexHtml, /id="lanAccessHelp"[^>]*role="tooltip"/);
  assert.match(indexHtml, /aria-describedby="lanAccessHelp"/);
  assert.equal(
    (indexHtml.match(/Allows other devices on\s+your local network/g) || [])
      .length,
    1,
  );
  assert.match(
    stylesheet,
    /\.settings-hover-help-wrap:hover \.settings-hover-help,[\s\S]*?\.settings-hover-help-wrap:focus-within \.settings-hover-help/,
  );
});

test("Settings checkboxes and labels share a centered line box", () => {
  assert.match(
    stylesheet,
    /\.settings-modal \.setting-item\.checkbox-group input\[type="checkbox"\]\s*\{[^}]*width:\s*var\(--settings-checkbox-size\)[^}]*height:\s*var\(--settings-checkbox-size\)[^}]*margin:\s*0;[^}]*transform:\s*none;/s,
  );
  assert.match(
    stylesheet,
    /\.settings-modal \.setting-item\.checkbox-group label\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*margin:\s*0;[^}]*line-height:\s*1\.25;/s,
  );
});
