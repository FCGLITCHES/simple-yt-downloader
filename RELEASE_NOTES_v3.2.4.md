# GetVideosLocally v3.2.4 Hotfix

## Download Location, History, And Safety Fixes

- Fixed download-folder choices not staying synchronized between onboarding, Settings, and first-launch defaults.
- Kept completed history items linked to the folder where they were actually downloaded, even after the destination for future downloads changes.
- Fixed Windows in-place updates so the new installer protects user data before any older uninstaller runs, then restores the backend history index, Electron local storage, and other persisted state; the History tab remains visible after upgrading.
- Unified legacy local history records across renderer client IDs so preserved downloads always appear after an update or browser-storage reset.
- Fixed the Play action so it opens the selected media file in the Windows default application instead of only revealing it in Explorer.
- Retained trusted IPC and downloads-root validation for Play, Open Folder, and related desktop file actions.
- Escaped remote titles and other dynamic history/toast content before HTML rendering.
- Refined the header, history toolbar, filters, and Settings checkbox groups into a clearer, flatter interface.
- Updated bundled yt-dlp to `2026.08.19` and refreshed vulnerable release dependencies.
- Added regression coverage for persistence, historical folder ownership, playback, path traversal rejection, renderer sanitization, and the affected UI states.

Downloaded media remains protected during uninstall. This hotfix changes the destination for future downloads only; existing history entries keep their original location.
