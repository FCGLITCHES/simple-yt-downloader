# Backend Architecture

## Overview

The backend is still a local Node.js service started by Electron, but it is no longer shaped as one giant file with every responsibility mixed together.

The current design keeps `server.js` as the composition root and moves the main responsibilities into focused backend modules:

- `backend/config/download-config.js`
- `backend/state/download-state.js`
- `backend/state/history-index.js`
- `backend/services/metadata-service.js`
- `backend/services/playlist-service.js`
- `backend/services/download-runner.js`
- `backend/websocket/client-hub.js`
- `backend/routes/api-routes.js`

That keeps the Electron-friendly runtime model, while making queue logic, metadata, routes, websocket messaging, and history persistence easier to reason about.

## Runtime Shape

`server.js` now does four main jobs:

1. Resolve environment paths and tool executables.
2. Create shared state and service instances.
3. Mount HTTP routes and websocket handlers.
4. Own server startup and graceful shutdown.

Everything else is delegated to modules.

## Module Responsibilities

### `backend/state/download-state.js`

Centralizes backend maps that used to be created ad hoc inside `server.js`:

- connected websocket clients
- active child processes
- queued downloads
- paused downloads
- client auto-update preferences

It also owns paused job persistence through `paused_jobs.json`, so pause/resume state is loaded and saved through one small state module instead of being scattered through the file.

### `backend/state/history-index.js`

Provides a lightweight persisted history/index layer backed by `data/history-index.json`.

It stores normalized history entries per `clientId`, keeps summary counts, and lets the backend:

- record completed downloads immediately
- rebuild the index from renderer history when needed
- return indexed history to the renderer without making the history tab reconstruct everything from raw local storage every time

### `backend/services/metadata-service.js`

Owns video metadata lookup and metadata prefetch scheduling.

It now handles:

- in-memory metadata caching
- in-flight request deduplication
- separate prefetch lanes for single items and playlist items
- centralized metadata concurrency settings

This is the main anti-throttling improvement: metadata prefetch is still parallel, but singles and playlist items are limited independently through one shared config entry point.

### `backend/services/playlist-service.js`

Wraps playlist discovery work:

- fetch playlist items
- fetch playlist title
- fetch both in parallel through `fetchPlaylistContext`

That keeps playlist resolution logic out of the middle of the download request handler.

### `backend/services/download-runner.js`

Holds shared download-runner support logic:

- filename sanitizing
- unique folder creation
- completion payload creation
- completion message dispatch
- history index recording for finished downloads

The heavy `yt-dlp` and `ffmpeg` process control still lives in `server.js`, but completion handling is now standardized and routed through one shared service.

### `backend/websocket/client-hub.js`

Owns websocket connection lifecycle and message broadcasting:

- client registration
- client removal
- websocket message parsing
- targeted sends
- broadcast sends
- auto-update preference awareness

This keeps websocket broadcasting out of the main route/download logic.

### `backend/routes/api-routes.js`

Owns HTTP API registration for:

- support email
- video info lookup
- history index sync/read
- tool update endpoints
- diagnostics
- shutdown

That separates HTTP concerns from process orchestration.

## History Flow

The history system now has two layers:

### Renderer layer

The renderer still writes local history to `localStorage` for resilience and backward compatibility.

### Backend index layer

The renderer now syncs that history to `/history-index/sync`, and reads indexed history from `/history-index`.

That means:

- the renderer can still fall back safely if the backend is unavailable
- the backend has a persisted normalized history view
- playlist folder counts and grouped metadata can be reused without rebuilding everything from raw local storage on every render

## Download Request Flow

1. The renderer sends a websocket `download_request`.
2. `client-hub` routes the message into `handleDownloadRequest`.
3. Singles and playlists are split early.
4. Playlist discovery runs through `playlist-service`.
5. Metadata prefetch runs through `metadata-service`.
6. Download execution still runs through `yt-dlp` and `ffmpeg` orchestration in `server.js`.
7. Completion payloads go through `download-runner`.
8. Completed downloads are recorded into `history-index`.
9. The renderer updates local UI state and syncs its history snapshot back to the backend.

## Concurrency Model

Concurrency is now centralized in `backend/config/download-config.js`.

There are separate knobs for:

- single download concurrency
- playlist item download concurrency
- single-item metadata prefetch concurrency
- playlist-item metadata prefetch concurrency

This matters because metadata and downloads have different throttling risks. Playlist metadata in particular needs tighter control than normal download throughput.

## Why Node Still Fits

Node is still the right runtime for the current desktop architecture because the backend needs:

- local child-process control
- tight Electron integration
- filesystem-heavy workflows
- simple packaging with the desktop app

FastAPI is still a possible future option if the app becomes a real client/server product, but for the current Electron-first design, the modular Node backend is the lower-risk and more maintainable path.
