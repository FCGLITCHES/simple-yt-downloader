# Feature Implementation Plan

This document outlines the plan to add several new features to the Simple YT Downloader application.

**Requested Features:**

1.  **Cancel Downloads:** Allow users to cancel in-progress downloads (YouTube and Instagram).
2.  **Concurrency for Single YouTube:** Provide an option for users to download 1 or 3 single YouTube videos concurrently.
3.  **UI Layout Change:** Move the download queue/status area to be side-by-side with the main downloader input card.
4.  **Unique Playlist Folders:** Prevent overwriting existing playlist folders by appending numbers `(1)`, `(2)`, etc., if a folder with the same name already exists.

**High-Level Plan:**

1.  **Backend Changes (`server.js`):** Implement unique playlist folder naming, concurrency for single YouTube downloads, and process management for cancellation.
2.  **Frontend Changes (`index.html`, `script.js`, `style.css`):** Add UI elements for concurrency selection and cancellation, and restructure the layout.
3.  **Testing:** Ensure all features work correctly together.

**Detailed Plan:**

**Phase 1: Backend Modifications (`server.js`)**

1.  **Unique Playlist Folder Names:**
    *   **Goal:** Prevent overwriting existing playlist folders.
    *   **Action:** In the playlist processing logic (around line 546):
        *   Before creating the folder, check if `fs.existsSync(playlistFolderPath)`.
        *   If it exists, loop, appending ` (1)`, ` (2)`, etc., to the base name and checking existence until a unique name is found.
        *   Use the first unique name for `playlistFolderPath`.
2.  **Concurrency for Single YouTube Downloads:**
    *   **Goal:** Allow users to download 1 or 3 single YouTube videos concurrently.
    *   **Action:**
        *   Create a new `p-limit` instance: `const singleVideoLimit = pLimit(1);` (initially 1).
        *   Modify the `/download` route handler (around line 517):
            *   Expect `singleConcurrency` in the request body (default 1).
            *   Update the limiter when processing single videos: `singleVideoLimit.concurrency = parseInt(req.body.singleConcurrency) || 1;`
            *   Wrap the `await processSingleVideo(...)` call (around line 593) using this limiter: `return singleVideoLimit(() => processSingleVideo(...))`.
3.  **Cancellation Mechanism:**
    *   **Goal:** Allow users to cancel an in-progress download via WebSocket.
    *   **Action:**
        *   Add a global map: `const activeProcesses = new Map();`
        *   Modify `runYtDlp` and `runFFmpeg`:
            *   Store the spawned `process` object in `activeProcesses` keyed by `itemId` when starting (e.g., `activeProcesses.set(itemId, { ytdlp: process, ffmpeg: null });`). Update with `ffmpeg` process if applicable.
            *   Ensure processes are removed from `activeProcesses` upon normal completion or error (within `runYtDlp`'s final catch or `runFFmpeg`'s close/error handlers).
        *   Modify the WebSocket message handler (`wss.on('message', ...)`):
            *   Add a case for `message.type === 'cancel'`.
            *   Retrieve processes using `message.itemId` from `activeProcesses`.
            *   If found, terminate using `process.kill()`. Handle errors.
            *   Remove the entry from `activeProcesses`.
            *   Clean up associated temporary files (using logic similar to `processSingleVideo`'s `finally` block).
            *   Send a 'status' message back confirming cancellation for that `itemId`.

**Phase 2: Frontend Modifications (`index.html`, `script.js`, `style.css`)**

1.  **Concurrency UI (Single YouTube):**
    *   **Goal:** Add UI element for selecting single video concurrency.
    *   **Action (`index.html`):** Add a form group with radio buttons or a select dropdown inside `#youtubeDownloader` for choosing concurrency (1 or 3).
    *   **Action (`script.js`):**
        *   In `startDownload`, read the selected concurrency value.
        *   Add `singleConcurrency` to the `fetch` request payload for single YouTube videos.
2.  **Cancellation UI:**
    *   **Goal:** Add a cancel button for each download item.
    *   **Action (`script.js`):**
        *   In `createDownloadItemStructure`, add a "Cancel" button (`<button class="item-cancel-btn">Cancel</button>`).
        *   Add an `onclick` handler to send the WebSocket message: `{ type: 'cancel', itemId: itemId }`.
        *   Update status locally to "Cancelling..." and disable the button on click.
    *   **Action (`style.css`):** Add styling for `.item-cancel-btn`.
3.  **UI Layout Change:**
    *   **Goal:** Place the download queue/status area next to the main downloader inputs.
    *   **Action (`index.html`):**
        *   Wrap the `.card.main-downloader` / `.card.instagram-downloader` and its corresponding `#downloadLinksArea` / `#instagramDownloadLinksArea` within a new `<div class="downloader-layout">`.
    *   **Action (`style.css`):**
        *   Apply `display: flex` or `display: grid` to `.downloader-layout`.
        *   Adjust `width`, `flex-basis`, `margin`, etc., for the card and links area for a side-by-side layout.
        *   Update styles for the links areas (e.g., `height`, `border`).
        *   Ensure responsiveness.

**Phase 3: Testing**

*   Test unique playlist folder creation.
*   Test single YouTube downloads with concurrency 1 and 3.
*   Verify the new side-by-side UI layout.
*   Test cancelling downloads at different stages.
*   Test error handling.

**Mermaid Diagram (UI Layout Concept):**

```mermaid
graph LR
    subgraph Main Container
        direction LR
        subgraph Downloader Layout Container (.downloader-layout)
            direction LR
            A[Downloader Card (.card)] --> B(Download Links Area (#downloadLinksArea));
        end
    end

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#ccf,stroke:#333,stroke-width:2px