# B&F - Bugs and Fixes Encyclopedia

> **Purpose:** A living reference for all issues encountered in Simply YTD. Each entry includes root causes, solutions, code fixes, and lessons learned for rapid debugging.

---

## 📋 Changelog

|    Date    | Bug # | Description | Status |
|------------|-------|-------------|--------|
| 2025-12-27 | [#1](#-bug-1-4k-downloads-limited-to-1080p) | 4K downloads limited to 1080p | ✅ Fixed |
| 2025-12-29 | [#2](#-bug-2-playlist-detection-not-working-with-paste-button) | Playlist detection not working with paste button | ✅ Fixed |
| 2025-12-29 | [#3](#-bug-3-cookie-path-mismatch-frontend-vs-backend) | Cookie path mismatch (frontend vs backend) | ✅ Fixed |
| 2025-12-29 | [#4](#-bug-4-yt-dlp---timeout-argument-not-supported) | yt-dlp `--timeout` argument not supported | ✅ Fixed |
| 2025-12-31 | [#5](#-bug-5-modal-scrolling-issues) | Modal scrolling issues | ✅ Fixed |
| 2026-01-01 | [#6](#-bug-6-header-dropdown-disappearing) | Header dropdown disappearing | ✅ Fixed |
| 2026-01-03 | [#7](#-bug-7-background-freezing-when-minimized-to-tray) | Background freezing when minimized to tray | ✅ Fixed |
| 2026-01-06 | [#8](#-bug-8-electron-build-path-error-module-not-found) | Electron build path error (module not found) | ✅ Fixed |
| 2026-01-07 | [#9](#-bug-9-ebusy-file-lock-preventing-app-close) | EBUSY file lock preventing app close | ✅ Fixed |
| 2026-01-07 | [#10](#-bug-10-thumbnail-files-not-cleaned-up-after-download) | Thumbnail files not cleaned up | ✅ Fixed |
| 2026-01-07 | [#11](#-bug-11-referenceerror---namenoext-not-defined) | `nameNoExt` not defined error | ✅ Fixed |
| 2026-01-07 | [#12](#-bug-12-referenceerror---finalfilepathvalue-not-defined) | `finalFilePathValue` not defined error | ✅ Fixed |
| 2026-01-08 | [#13](#-bug-13-history-thumbnails-showing-placeholders) | History thumbnails showing placeholders | ✅ Fixed |
| 2026-01-23 | [#14](#-bug-14-inflatedinaccurate-download-speed-display) | Inflated/Inaccurate download speed display | ✅ Fixed |
| 2026-01-23 | [#15](#-bug-15-download-speed-limit-not-applying-or-syncing) | Speed limit not applying or syncing | ✅ Fixed |

---

## 🐛 Bug #1: 4K Downloads Limited to 1080p

`Tags: 4K, ffmpeg, yt-dlp, format, merge, production`

### Problem
4K video downloads were being capped at 1080p in the production build even though they worked in development.

### Root Cause
yt-dlp wasn't properly using ffmpeg for merging high-resolution video and audio streams. The `--js-runtimes node` argument was also causing issues.

### Solution
1. Ensure ffmpeg path is properly set with `--ffmpeg-location`
2. Remove problematic `--js-runtimes node` argument
3. Use proper format selectors for 4K content

### Code Fix

**File: `server.js` - In `runYtDlpCommand`:**
```javascript
const finalArgs = [
    ...cookieArgs,
    ...baseArgs,
    '--ffmpeg-location', ffmpegExecutable, // CRITICAL: Enables stream merging for 4K
    '--encoding', 'utf-8',
    '--no-colors',
    '--user-agent', 'Mozilla/5.0 ...'
];
```

### Lessons Learned
- High-resolution videos require stream merging (video + audio)
- Always verify ffmpeg path is correctly set in production builds
- Test with 4K content specifically during QA

---

## 🐛 Bug #2: Playlist Detection Not Working with Paste Button

`Tags: paste, clipboard, input, event, playlist, dispatchEvent`

### Problem
When using the paste button to paste a playlist URL, the playlist options weren't appearing.

### Root Cause
The paste button wasn't dispatching input events after setting the value, so the URL change detection wasn't triggered.

### Solution
Dispatch `input` and `change` events after programmatically setting the URL value.

### Code Fix

**File: `script.js` - In paste button handler:**
```javascript
pasteButton.addEventListener('click', async () => {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    // Dispatch events to trigger URL change detection
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    urlInput.dispatchEvent(new Event('change', { bubbles: true }));
});
```

### Lessons Learned
- Programmatic value changes don't trigger native events
- Always dispatch both `input` and `change` for full compatibility
- Test paste functionality separately from manual typing

---

## 🐛 Bug #3: Cookie Path Mismatch (Frontend vs Backend)

`Tags: cookies, path, mismatch, appData, authentication`

### Problem
Frontend could detect cookies, but backend couldn't find them. Cookie testing was failing.

### Root Cause
Path mismatch between expected paths:
- Backend expected: `SimplyYTD`
- Frontend was using: `video-downloader-gemini` or `simply-ytd`

### Solution
Simplify cookie path to use a fixed location: `project_folder/cookies/cookies.txt`

### Code Fix

**File: `server.js`:**
```javascript
async function getCookiesPath() {
    const cookiesDir = path.join(__dirname, 'cookies');
    const cookiesPath = path.join(cookiesDir, 'cookies.txt');
    
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }
    
    if (fs.existsSync(cookiesPath)) {
        const stats = fs.statSync(cookiesPath);
        if (stats.size > 50) {
            return cookiesPath;
        }
    }
    return null;
}
```

### Lessons Learned
- Use `__dirname` for consistent paths, not app name-based paths
- Document expected paths in both frontend and backend
- Validate paths exist before using them

---

## 🐛 Bug #4: yt-dlp `--timeout` Argument Not Supported

`Tags: yt-dlp, timeout, argument, version, compatibility`

### Problem
Cookie testing was failing with errors about unsupported arguments.

### Root Cause
The yt-dlp version didn't support the `--timeout` argument being used in cookie validation.

### Solution
Remove `--timeout` argument and use internal JavaScript timeout instead.

### Code Fix

**File: `server.js` - In `testCookieValidity`:**
```javascript
const testArgs = [
    '--cookies', cookieFilePath,
    '--no-download',
    '--print', '%(title)s',
    '--no-warnings',
    // Removed: '--timeout', '15',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
];

// Use JavaScript timeout instead
setTimeout(() => {
    if (!resolved) {
        resolved = true;
        testProc.kill('SIGTERM');
        resolve({ code: -1, stdout: stdout.trim(), stderr: 'Process timeout', timeout: true });
    }
}, 15000);
```

### Lessons Learned
- Check yt-dlp version compatibility for arguments
- Prefer JavaScript-level timeouts for better control
- Wrap external tool calls with process management

---

## 🐛 Bug #5: Modal Scrolling Issues

`Tags: modal, scroll, overflow, CSS, settings, about`

### Problem
Settings panel was scrolling when it shouldn't, while the About/Help modal needed scrolling enabled.

### Root Cause
Event listeners for scroll control weren't correctly targeting specific modals.

### Solution
Implement modal-specific scroll control that only enables scrolling for modals that need it.

### Code Fix

**File: `script.js`:**
```javascript
// When opening About modal - enable scroll
aboutModal.style.overflowY = 'auto';
document.body.style.overflow = 'hidden';

// When opening Settings - prevent scroll
settingsPanel.style.overflowY = 'hidden';
```

### Lessons Learned
- Each modal may need different scroll behavior
- Always lock body scroll when modal is open
- Test scroll behavior with varying content heights

---

## 🐛 Bug #6: Header Dropdown Disappearing

`Tags: z-index, dropdown, header, CSS, visibility, stacking`

### Problem
The custom header dropdown menu (now "Tabs") was disappearing or being partially obscured.

### Root Cause
Z-index conflicts between header styling and sidebar logic. Dropdown z-index was too low.

### Solution
Separate header styling from sidebar logic and ensure dropdown has proper z-index.

### Code Fix

**File: `style.css`:**
```css
.header-dropdown-menu {
    z-index: 10001; /* Above header and other elements */
    position: absolute;
}
```

### Lessons Learned
- Establish a z-index scale for the project (e.g., header: 1000, dropdown: 1001, modal: 2000)
- Always test dropdowns with all other UI elements visible
- Document z-index values centrally

---

## 🐛 Bug #7: Background Freezing When Minimized to Tray

`Tags: Electron, tray, background, freeze, powerSaveBlocker, throttling`

**Ref:** Conversation `dc398bd6-c55c-44bc-a5fc-e8268c7ae094`

### Problem
Downloads stopped/froze when the app was minimized to the system tray.

### Root Cause
Electron was throttling background processes. Power save blocker wasn't active when running in background.

### Solution
Implement power save blocker that activates during downloads and maintains activity in background.

### Code Fix

**File: `electron-main.js`:**
```javascript
const { powerSaveBlocker } = require('electron');
let powerSaveBlockerId = null;

ipcMain.handle('start-power-save-blocker', async () => {
    if (powerSaveBlockerId === null) {
        powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
        console.log('Power save blocker started:', powerSaveBlockerId);
    }
    return powerSaveBlockerId;
});

ipcMain.handle('stop-power-save-blocker', async () => {
    if (powerSaveBlockerId !== null) {
        powerSaveBlocker.stop(powerSaveBlockerId);
        powerSaveBlockerId = null;
    }
});
```

### Lessons Learned
- Electron throttles background processes by default
- Use `powerSaveBlocker` for long-running tasks
- Start blocker when download begins, stop when all downloads complete

---

## 🐛 Bug #8: Electron Build Path Error (Module Not Found)

`Tags: Electron, build, path, module, package.json, main`

**Ref:** Conversation `877520be-74af-481a-89af-bf355d0f7491`

### Problem
```
Cannot find module Projects\Video downloader Website - 2.1.1 launch\. ..\indexjs'
```

### Root Cause
Issue with `main` entry point in `package.json` or related path reference during build.

### Solution
Ensure proper path resolution and correct main entry point in package.json.

### Code Fix

**File: `package.json`:**
```json
{
    "main": "electron-main.js"
}
```

### Lessons Learned
- Verify `main` field in package.json matches actual entry file
- Watch for path escaping issues in Windows builds
- Test built executable, not just dev mode

---

## 🐛 Bug #9: EBUSY File Lock Preventing App Close

`Tags: EBUSY, file lock, cleanup, process, terminate, shutdown, ffmpeg, yt-dlp`

**Ref:** Conversation `96566670-0925-4ec1-882a-a414b6b37c21`

### Problem
`EBUSY` file lock error prevented the Electron application from closing properly.

### Root Cause
Backend server and child processes (yt-dlp, ffmpeg) weren't being gracefully terminated when the app exited.

### Solution
Implement robust shutdown process that terminates all child processes before quitting.

### Code Fix

**File: `electron-main.js`:**
```javascript
const cleanupAndQuit = async () => {
    console.log('Terminating server process and waiting for cleanup...');
    
    try {
        if (processInfo.ytdlpProc && processInfo.ytdlpProc.pid && !processInfo.ytdlpProc.killed) {
            await terminateProcessGracefully(processInfo.ytdlpProc.pid, itemId);
            processInfo.ytdlpProc.killed = true;
        }
        if (processInfo.ffmpegProc && processInfo.ffmpegProc.pid && !processInfo.ffmpegProc.killed) {
            await terminateProcessGracefully(processInfo.ffmpegProc.pid, itemId);
            processInfo.ffmpegProc.killed = true;
        }
    } catch (killError) {
        console.error('Error during process termination:', killError);
    }
    
    // Wait for file locks to release
    await new Promise(resolve => setTimeout(resolve, 500));
};
```

### Lessons Learned
- Always terminate child processes before app exit
- Add delay after termination to release file locks
- Use `taskkill /T /F` on Windows for process trees
- Track all spawned processes for cleanup

---

## 🐛 Bug #10: Thumbnail Files Not Cleaned Up After Download

`Tags: thumbnail, cleanup, jpg, webp, png, temp files, yt-dlp`

**Ref:** Conversation `2f1a7afc-3abb-4fac-a070-71ac65e88980`

### Problem
Thumbnail image files (.jpg, .webp, .png) were being created separately and left behind after download completed or when cancelling.

### Root Cause
The yt-dlp command uses `--write-thumbnail --convert-thumbnails jpg` which creates a separate thumbnail file. The cleanup logic didn't include thumbnail extensions.

### Solution
1. Add `.jpg`, `.webp`, `.png` to the cleanup patterns in `cleanupFilesByTemplate`
2. Add thumbnail cleanup logic in the `processVideo` finally block

### Code Fix

**File: `server.js` - In `cleanupFilesByTemplate`:**
```javascript
const nameNoExt = basePattern.replace(/\.[^.]+$/, '');

const patterns = [
    basePattern,
    `${basePattern}.part`,
    `${basePattern}.ytdl`,
    `${basePattern}.temp`,
    // Thumbnail files
    `${nameNoExt ? nameNoExt : basePattern}.jpg`,
    `${nameNoExt ? nameNoExt : basePattern}.webp`,
    `${nameNoExt ? nameNoExt : basePattern}.png`
];
```

**File: `server.js` - In `processVideo` finally block:**
```javascript
// THUMBNAIL CLEANUP after successful download
if (finalFilePathValue && fs.existsSync(finalFilePathValue)) {
    const videoDir = path.dirname(finalFilePathValue);
    const videoBase = path.basename(finalFilePathValue, path.extname(finalFilePathValue));
    const thumbnailExtensions = ['.jpg', '.webp', '.png'];
    
    thumbnailExtensions.forEach(thumbExt => {
        const thumbPath = path.join(videoDir, videoBase + thumbExt);
        if (fs.existsSync(thumbPath)) {
            try {
                fs.unlinkSync(thumbPath);
                console.log(`[${itemId}] 🗑️ Cleaned up thumbnail: ${thumbPath}`);
            } catch (thumbErr) {
                console.warn(`Could not delete thumbnail: ${thumbErr.message}`);
            }
        }
    });
}
```

### Lessons Learned
- Audit all file extensions created by external tools
- Cleanup logic must cover all temp file types
- Test cancellation at various download stages

---

## 🐛 Bug #11: ReferenceError - `nameNoExt` Not Defined

`Tags: ReferenceError, undefined, variable scope, declaration order`

**Ref:** Conversation `2f1a7afc-3abb-4fac-a070-71ac65e88980`

### Problem
```
ReferenceError: nameNoExt is not defined
```
Server crashes when cancelling a download.

### Root Cause
Variable `nameNoExt` was being used in the patterns array before it was defined. The definition was placed after where it was first referenced.

### Solution
Move `nameNoExt` declaration to before the patterns array.

### Code Fix

**File: `server.js` - In `cleanupFilesByTemplate`:**
```javascript
function cleanupFilesByTemplate(template, itemId) {
    try {
        const dir = path.dirname(template);
        const base = path.basename(template);
        const basePattern = base.replace(/%\([^)]+\)s/g, '*');
        const glob = require('glob');
        
        // IMPORTANT: Define BEFORE using in patterns array
        const nameNoExt = basePattern.replace(/\.[^.]+$/, '');

        const patterns = [
            basePattern,
            `${basePattern}.part`,
            `${nameNoExt ? nameNoExt : basePattern}.jpg`, // Now nameNoExt exists
            // ...
        ];
    }
}
```

### Lessons Learned
- **Declaration order matters** - variables must be declared before use
- Review entire scope when adding new variables
- Test edge cases (cancellation) that hit different code paths

---

## 🐛 Bug #12: ReferenceError - `finalFilePathValue` Not Defined

`Tags: ReferenceError, undefined, try-finally, scope, cancellation`

**Ref:** Conversation `2f1a7afc-3abb-4fac-a070-71ac65e88980`

### Problem
```
ReferenceError: finalFilePathValue is not defined
    at processVideo (server.js:2054:13)
```
Server crashes when cancelling a download mid-progress.

### Root Cause
`finalFilePathValue` was declared inside the `try` block but accessed in the `finally` block. When cancelled early (before assignment), the variable is undefined.

### Solution
Declare `finalFilePathValue` at function scope (before the try block).

### Code Fix

**File: `server.js` - In `processVideo`:**
```javascript
async function processVideo(clientId, itemId, itemData) {
    const { videoUrl, format, quality, source, settings, isPlaylistItem, playlistIndex } = itemData;
    let currentVideoTitle = itemData.title || 'video';
    let tempFilesCreated = [];
    let finalFilePathValue; // Declare at function scope for access in finally block

    const itemProcInfo = { /* ... */ };
    
    try {
        // finalFilePathValue gets assigned here when download succeeds
    } finally {
        // Now accessible (may be undefined if cancelled early - that's OK)
        if (finalFilePathValue && fs.existsSync(finalFilePathValue)) {
            // Thumbnail cleanup
        }
    }
}
```

### Lessons Learned
- **Variables accessed in `finally` must be declared before `try`**
- Use `let` at function scope for variables needed in cleanup
- Always check for undefined before using in finally blocks

---

## 🐛 Bug #13: History Thumbnails Showing Placeholders

`Tags: thumbnail, history, placeholder, fullPath, network URL, path resolution`

**Ref:** Conversation `93544f74-a716-41ae-97c7-55592ee9679d`

### Problem
History panel was displaying placeholder images instead of actual video thumbnails.

### Root Cause
Multiple issues:
1. **Separate thumbnail files were being deleted** after download (cleanup code removed `.jpg` files)
2. **`fullPath` not stored in history** - history only stored relative paths, making file location unreliable when user changes download folder
3. **Local thumbnail lookup code** was searching for files that no longer existed

### Solution
1. **Only embed thumbnails** (remove `--write-thumbnail`), no separate files left in folder
2. **Store `fullPath`** in history item for reliable file location
3. **Use network thumbnail URL** (`item.thumbnail`) for history display
4. **Ensure all formats get metadata/thumbnail embedding**

### Code Fix

**File: `script.js` - History item storage (add `fullPath`):**
```javascript
const historyItem = {
    name: displayTitle || filename,
    path: downloadUrl,
    fullPath: fullPath || null,  // Absolute path from server for reliable file location
    folder: data.downloadFolder || getDownloadFolder(),
    type: subtabKey === 'youtube' ? 'youtubeSingles' : subtabKey,
    // ... other fields
    thumbnail: (thumbnail || currentItemState?.thumbnail) || null,
};
```

**File: `script.js` - History item rendering (use fullPath + network thumbnail):**
```javascript
async function createHistoryItemElement(item, index, rootFolder) {
    let absPath;
    
    // Priority: use fullPath if available (most reliable)
    if (item.fullPath) {
        absPath = item.fullPath;
    } else {
        // Fallback to path resolution from folder
        // ...
    }
    
    // Use network thumbnail URL (thumbnails are embedded, not saved as separate files)
    let thumbnailSrc = item.thumbnail || 'https://placehold.co/120x90/e0e0e0/7f7f7f?text=Video';
}
```

**File: `server.js` - Remove `--write-thumbnail` (only embed):**
```javascript
// Audio formats
audioArgs.push('--embed-metadata');
audioArgs.push('--add-metadata');
audioArgs.push('--embed-thumbnail');  // Embed only, no separate file

// Video formats (MP4, MKV)
videoArgs.push('--embed-chapters', '--embed-thumbnail');  // No --write-thumbnail

// MOV/WEBM (thumbnail embedding not well supported)
videoArgs.push('--embed-chapters');  // Chapters only
```

### Lessons Learned
- **Store `fullPath`** for reliable file location regardless of where user saves
- **Don't write separate thumbnail files** if embedding is sufficient
- **Network thumbnail URLs** stored in history work for display without local files
- **All formats should get metadata extraction** (`--embed-metadata`, `--add-metadata`)

---

## 🐛 Bug #14: Inflated/Inaccurate Download Speed Display

`Tags: speed, download, measurement, disk-i/o, ground-truth, EMA, yt-dlp`

### Problem
Download speed readings were often inaccurate or "fake" (e.g., showing 640 Mbps on a 512 Mbps connection). This was due to yt-dlp reporting instantaneous peak speeds or buffer speeds rather than steady-state throughput.

### Root Cause
Relying solely on string-parsing yt-dlp's standard output. yt-dlp calculates speed based on its own internal buffers, which often includes file system caching effects, leading to inflated "burst" readings.

### Solution
Implemented a **Disk-Based Ground Truth** measurement system:
1.  Track actual bytes written to the physical disk every 500ms.
2.  Use `fs.statSync` to measure real file size changes.
3.  Apply **Exponential Moving Average (EMA)** smoothing (`α=0.2`) to provide a stable, readable display.
4.  Implement **Outlier Rejection** to ignore extreme spikes caused by OS write-buffering.

### Code Fix

**File: `server.js` - Dynamic Speed Tracking:**
```javascript
// Every 500ms while downloading
const stats = fs.statSync(filePath);
const currentSize = stats.size;
const bytesSinceLast = currentSize - lastMeasuredSize;
const bps = (bytesSinceLast / deltaTime) * 1000;

// Apply EMA Smoothing
smoothedBps = (smoothedBps * 0.8) + (bps * 0.2);
```

### Lessons Learned
- **Disk never lies**: For real download progress, actual file growth on disk is the only reliable metric.
- **Smoothing is essential**: Raw I/O speeds are jumpy; EMA provides the "premium" feel users expect.
- **Fallbacks are necessary**: Use parsed speed only as a placeholder until the destination file is actually created.

---

## 🐛 Bug #15: Download Speed Limit Not Applying or Syncing

`Tags: speed-limit, settings, throttle, slider, UI-sync, yt-dlp, rate-limit`

### Problem
Setting a download speed limit in the Settings modal didn't actually slow down the download. Additionally, the header speed slider and the settings modal input often showed different values.

### Root Cause
1.  The `maxSpeed` setting was being sent to the server but not consistently added to the `yt-dlp` arguments using `--limit-rate`.
2.  UI components (Header Slider vs. Settings Modal) were reading/writing to `localStorage` independently without triggering updates in each other.
3.  The slider used a linear mapping that made it impossible to set precise low speeds (like 50 KB/s).

### Solution
1.  **Server side**: Ensured `--limit-rate <value>K` is prepended to ALL video and audio download commands.
2.  **Client side**: Centralized the `maxSpeed` state and added explicit synchronization in the `saveSettings` function.
3.  **UX Improvement**: Implemented a **Non-linear Slider Mapping** that provides 100 KB/s resolution at lower speeds and 10 MB/s resolution at high speeds, with a minimum floor of 2 MB/s.

### Code Fix

**File: `script.js` - Non-linear Mapping & Sync:**
```javascript
// Slider 0-200 mapping to 0-500 MB/s
function sliderToSpeed(sliderVal) {
    if (sliderVal === 0) return 0; // Unlimited
    if (sliderVal <= 80) return 2000 + (sliderVal - 1) * 100; // 2-10 MB/s range
    // ... higher ranges
}

// In saveSettings() - keep both UI elements in sync
if (headerSpeedSlider) {
    headerSpeedSlider.value = speedToSlider(userSettings.maxSpeed);
}
```

### Lessons Learned
- **One source of truth**: Complex settings should have a single update handler that broadcasts to all relevant UI components.
- **Scale matters**: Linear sliders are poor for values that span orders of magnitude (KB/s to GB/s).
- **Minimum common sense**: If a limit is too low to be useful (e.g., 1 byte/s), it's better to enforce a sensible minimum (2 MB/s) to prevent "broken" user experiences.

---

## 🔧 Common Patterns & Quick Reference

### Accuracy Metrics (New)
- **Prefer disk I/O over process stdout**: For real download progress, actual file growth on disk is the only reliable metric.
- **Smoothing is essential**: Use EMA (Exponential Moving Average) or Median filters to handle jumpy I/O data and filter outliers.

### UX Scaling (New)
- **Non-linear Sliders**: Use logarithmic or multi-step linear mapping for range inputs that cover many orders of magnitude (e.g., KB/s to MB/s).

### Variable Scope Issues
- Variables used in `finally` must be declared before `try`
- Variables used in callbacks/closures must be defined before use
- Use `let` at outer scope when value changes across try/catch/finally

### Path Issues (Windows)
- Always use `path.join()` for cross-platform compatibility
- Use `__dirname` for relative paths from current file
- Watch for case sensitivity in app names
- Escape backslashes in strings: `\\` not `\`

### Process Cleanup
- Always terminate child processes gracefully
- Wait for file locks to release (add delay after kill)
- Use `taskkill /T /F` on Windows for process trees
- Track spawned processes in a registry for cleanup

### Cleanup Patterns
- Include ALL file extensions that might be created
- Check if file exists before deleting
- Wrap in try/catch to prevent crashes on cleanup failure
- Test cleanup during cancellation, not just completion

### Electron-Specific
- Use `powerSaveBlocker` for background tasks
- Handle `will-quit` and `before-quit` events properly
- Verify `main` in package.json after any restructuring

---

## 📋 Template for New Bugs

```markdown
## 🐛 Bug #X: [Short Description]

`Tags: keyword1, keyword2, keyword3`

**Ref:** Conversation `[conversation-id]` (if applicable)

### Problem
[Describe what happens - error messages, symptoms, when it occurs]

### Root Cause
[Explain WHY this happens - the underlying technical reason]

### Solution
[Describe the fix approach]

### Code Fix

**File: `[filename]` - [location in file]:**

\`\`\`javascript
// Code snippet with the fix
\`\`\`

### Lessons Learned
- [Key takeaway 1]
- [Key takeaway 2]
```

---

*Last updated: 2026-01-23*
