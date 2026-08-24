const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const rendererSource = fs.readFileSync(
  path.join(projectRoot, "script.js"),
  "utf8",
);
const stylesheet = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");
const onboardingSource = rendererSource.slice(
  rendererSource.indexOf("function initOnboarding()"),
  rendererSource.indexOf("// Ensure default download folder"),
);

test("all five onboarding steps use the shared light setup shell", () => {
  assert.equal(
    (onboardingSource.match(/return renderSetupShell\(\{/g) || []).length,
    5,
  );
  assert.match(onboardingSource, /src="\/public\/Logo1\.ico"/);
  assert.match(onboardingSource, /setup-step-pill/);
  assert.match(onboardingSource, /setup-visual-core/);
  assert.doesNotMatch(onboardingSource, /style="/);
});

test("onboarding actions remain compact and responsive", () => {
  assert.match(stylesheet, /\.setup-btn\s*\{[^}]*height:\s*38px;/s);
  assert.match(
    stylesheet,
    /#onboardingModal \.onboarding-modal-content\s*\{[^}]*calc\(100dvh - 2rem\)/s,
  );
  assert.match(stylesheet, /@media \(max-width: 620px\)/);
  assert.match(stylesheet, /font-family:\s*'Manrope'/);
  assert.equal(
    fs.existsSync(
      path.join(projectRoot, "public", "fonts", "manrope-latin.woff2"),
    ),
    true,
  );
  assert.doesNotMatch(stylesheet, /\.setup-[^}]*!important/s);
});

test("setup retains folder, format, notification, and completion controls", () => {
  for (const controlId of [
    "onboardingFolder",
    "onboardingChooseFolder",
    "onboardingFormatChoices",
    "onboardingQuality",
    "onboardingSoundToggle",
    "onboardingDesktopToggle",
  ]) {
    assert.match(onboardingSource, new RegExp(controlId));
  }

  assert.match(onboardingSource, /data-action="prev"/);
  assert.match(onboardingSource, /data-action="next"/);
  assert.match(onboardingSource, /data-action="finish"/);
});

test("folder selection stays in onboarding and persists to Settings", () => {
  const folderListener = onboardingSource.slice(
    onboardingSource.indexOf(
      "document.getElementById('onboardingChooseFolder')",
    ),
    onboardingSource.indexOf(
      "if (index === 2)",
      onboardingSource.indexOf(
        "document.getElementById('onboardingChooseFolder')",
      ),
    ),
  );

  assert.match(folderListener, /electronAPI\.openFolderDialog\(\)/);
  assert.match(folderListener, /persistDownloadFolder\(normalizedFolderPath\)/);
  assert.match(onboardingSource, /localStorage\.setItem\('ytdUserSettings'/);
  assert.match(onboardingSource, /settingsFolderInput\.value = folderPath/);
  assert.doesNotMatch(folderListener, /settingsModal\.style\.display = 'flex'/);
  assert.match(folderListener, /Saved to Settings\./);
});

test("format, quality, and notification defaults persist from onboarding", () => {
  assert.match(onboardingSource, /defaultFormat: onboardingState\.format/);
  assert.match(onboardingSource, /defaultQuality: onboardingState\.quality/);
  assert.match(onboardingSource, /notificationSound:/);
  assert.match(onboardingSource, /notificationPopup:/);
});

test("fresh installs initialize onboarding without an update-popup startup error", () => {
  const updateConstantsIndex = rendererSource.indexOf(
    "const UPDATE_LAST_SEEN_KEY",
  );
  const updateInitializationIndex = rendererSource.indexOf(
    "// Initialize only after the update constants",
  );

  assert.ok(updateConstantsIndex > -1);
  assert.ok(updateInitializationIndex > updateConstantsIndex);
  assert.match(
    rendererSource,
    /function initUpdateCheck\(\) \{\s*if \(!localStorage\.getItem\('ytdTutorialCompleted'\)\) \{\s*return;/s,
  );
});
