# GetVideosLocally v3.2.3

## HDR, Download Accuracy, And Interface Polish

- Fixed a speed-estimator failure where a tiny initial disk-write sample could pin the UI near zero even while yt-dlp was transferring at full speed.
- Reset disk measurement when yt-dlp switches between video and audio output files and added a smoothed native-speed fallback for unreliable disk samples.
- Added an explicit 8K (4320p) quality option and shared quality normalization for initial and resumed downloads.
- Capped every video format selector to the requested height so 4K stays at 4K while 8K can select a real 7680×4320 source stream.
- Added a persisted Prefer HDR setting and a per-download Advanced Options override; disabling it explicitly prefers SDR for broader playback compatibility.
- Made HDR opt-in for fresh settings while preserving an existing user's saved preference.
- Preserved HDR at the requested resolution when enabled by sorting frame rate and dynamic range before bitrate and codec preference.
- Flattened and clarified Advanced Options, integrated subtitle choices into Download Options, and strengthened heading weight throughout modal surfaces.
- Redesigned the cookie importer and coffee support popup around the approved red-and-white direction with flat action buttons.
- Compacted What’s New into a two-column layout with a visible top-right close control and an always-visible Got it action.
- Added permanent regressions for the reported low-speed display, stream switching, native fallback, quality normalization, and selector ceilings.

# GetVideosLocally v3.2.1

## UI Clarity

- Promoted locally bundled Manrope to the primary application typeface, including the header wordmark and main download heading.
- Flattened onboarding step numbers by removing their gradients and shadows.
- Corrected light-mode Support Me contrast so the heart and label stay white, and removed the button shadow.
- Replaced the permanent LAN discovery explanation with an accessible hover and keyboard-focus tooltip.
- Removed the conflicting Settings section overflow rule that clipped the new tooltip and created an unnecessary internal scrollbar.
- Normalized native checkbox sizing, margins, and label line boxes so Settings controls align centrally across themes.
- Added focused UI-system regressions and desktop visual captures for the main screen, onboarding, and Settings tooltip states.

# GetVideosLocally v3.2.0

## Smarter Setup

- Redesigned all five onboarding steps with a consistent red-and-white layout, approved `Logo1.ico` branding, clearer progress, and compact actions.
- Changed Step 2 so Choose opens the native Windows folder picker directly and immediately persists the selected path to Settings.
- Added format-aware preferred quality selection to Step 3 and persisted both defaults for the main download form.
- Persisted sound and desktop notification choices from Step 4.
- Bundled the open-source Manrope font locally for bolder, modern, offline-readable onboarding typography.
- Added desktop and compact-width visual verification plus onboarding, persistence, startup-order, and packaging regressions.

# GetVideosLocally v3.1.2

## Approved Brand Logo Correction

- Made `public/Logo1.ico` the sole public brand asset and removed conflicting logo files.
- Replaced the generic or incorrect executable icons with the approved GetVideosLocally brand icon.
- Unified the icon used by web favicons, the installer, uninstaller, installed and portable executables, desktop and Start Menu shortcuts, taskbar windows, cookie helper, system tray, and Apps & Features registration.
- Added the Windows AppUserModelID so taskbar and notification identity matches the installed application.
- Corrected portable executable version metadata to use the package version.
- Added icon ownership and packaging regressions.

# GetVideosLocally v3.1.0

## Smaller Installation And Cleaner Uninstall

- Reduced the unpacked Windows application from 1,165.30 MiB to 651.78 MiB, a 44.1% reduction.
- Reduced the Windows installer from 340.60 MiB to 189.12 MiB, a 44.5% reduction.
- Removed duplicate packaging of the binary and asset payloads.
- Removed the unused FFplay executable while retaining FFmpeg, FFprobe, yt-dlp, and Node support.
- Added current and legacy cleanup for shortcuts, startup entries, registry entries, caches, settings, queues, logs, and updater artifacts.
- Preserved downloaded videos by default and added explicit confirmation before deleting them during uninstall.
- Added packaging and uninstall regression coverage.

# GetVideosLocally v3.0.2 Security Patches

## Storage And Uninstall Improvements

- Removed duplicate packaging of binaries and web assets from Windows installer payloads.
- Stopped shipping the unused FFplay executable while retaining FFmpeg and FFprobe functionality.
- Updated uninstall cleanup for current and legacy shortcuts, startup entries, registry entries, caches, settings, queues, logs, and updater artifacts.
- Added an uninstall confirmation before deleting videos in the default app-managed downloads folder.

## Required Security Patches

- Marked the in-app release notice with a visible `Required` badge so users know this update should be applied.
- Added a brief in-app security patch description covering local file handling, FFmpeg update integrity, and firewall access controls.
- Regenerated release metadata for the `3.0.2` security patch build.

# GetVideosLocally v3.0.1 Security Patch

## Security Patch

- Bumped the desktop application release version to `3.0.1`.
- Added downloads-root path validation for open/delete IPC operations.
- Changed file and folder deletion to use the Recycle Bin with no permanent fallback.
- Added exact-origin IPC sender validation for local destructive handlers.
- Added FFmpeg SHA256 verification through the shipped trust manifest.
- Changed Windows Firewall access from silent startup mutation to explicit Settings opt-in.
- Upgraded Electron to `42.1.0` and documented the temporary CommonJS preload sandbox exception.

# GetVideosLocally v3.0

## Highlights

- Replaced the old tutorial carousel with a guided onboarding flow for download location, format preferences, and notifications.
- Simplified the main download form by moving concurrency controls into Advanced Options.
- Reorganized Settings so download options, notifications, subtitles, and appearance controls are easier to scan.
- Added conditional subtitle settings so language and auto-caption controls only show when subtitle downloads are enabled.
- Improved history safety and clarity with refined bulk actions, cleaner labels, and safer button visibility.
- Refreshed popup styling, spacing, branding text, changelog presentation, and other interface details across the app.

## Backend And Reliability

- Split key backend responsibilities into modules for routes, metadata, playlist handling, download state, and WebSocket broadcasting.
- Added safer metadata and playlist caching to reduce repeated site requests.
- Added rate-limit-aware retry and request pacing logic for more reliable downloads without unnecessary site pressure.
- Moved runtime state toward writable app/user-data paths so packaged builds do not rely on writing inside the installed app bundle.
