const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "script.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

function loadEscapeHtml() {
  const mapMatch = scriptSource.match(
    /const HTML_ESCAPE_MAP = \{[\s\S]*?\n\};/,
  );
  const helperMatch = scriptSource.match(
    /function escapeHtml\(rawValue\) \{[\s\S]*?\n\}/,
  );

  assert.ok(mapMatch, "HTML_ESCAPE_MAP must exist in script.js");
  assert.ok(helperMatch, "escapeHtml helper must exist in script.js");

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${mapMatch[0]}\n${helperMatch[0]}\nthis.escapeHtml = escapeHtml;`,
    context,
  );
  return context.escapeHtml;
}

test("history and toast HTML boundaries escape remote-title payloads", () => {
  const escapeHtml = loadEscapeHtml();

  const regressionCase = {
    failureMode: "download_title_renderer_html_injection",
    input:
      `"><img src=x onerror="window.electronAPI.getServerToken()">` +
      `<script>alert(1)</script>`,
    expectedStableBehavior:
      "Payload is rendered as inert text before insertion into innerHTML.",
    reason:
      "Remote video titles can become local filenames and toast text in the Electron renderer.",
    caseType: "negative test",
  };

  const escapedPayload = escapeHtml(regressionCase.input);

  assert.equal(
    escapedPayload,
    "&quot;&gt;&lt;img src=x onerror=&quot;window.electronAPI.getServerToken()&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
  );
  assert.doesNotMatch(escapedPayload, /<script|<img|onerror="/i);
});

test("history item templates use escaped dynamic file values", () => {
  const expectedEscapedBindings = [
    "${escapedThumbnailSrc}",
    "${escapedName}",
    "${escapedMtime}",
    "${escapedSize}",
    "${escapedAbsPath}",
  ];
  const blockedRawBindings = [
    "${thumbnailSrc}",
    "${item.name}",
    "${item.size}",
    "${absPath}",
  ];

  for (const binding of expectedEscapedBindings) {
    assert.ok(
      scriptSource.includes(binding),
      `Expected escaped binding in history template: ${binding}`,
    );
  }

  for (const binding of blockedRawBindings) {
    assert.equal(
      scriptSource.includes(binding),
      false,
      `Raw binding must not be inserted into history innerHTML: ${binding}`,
    );
  }
});
