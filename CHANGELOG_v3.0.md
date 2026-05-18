# GetVideosLocally v3.0.2 Security Patches

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
