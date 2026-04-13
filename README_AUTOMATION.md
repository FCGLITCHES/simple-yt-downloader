# Automation Features

This document describes the high-leverage automation features implemented to reduce maintenance load.

## 1. CI Smoke Tests

**Location:** `.github/workflows/smoke-tests.yml`

Runs automated smoke tests using permissioned test URLs that you control (your own uploads). This detects breakages before users report them.

### Setup

1. Add your test URLs as GitHub Secrets:
   - `TEST_YOUTUBE_URL`: A YouTube video URL you control
   - `TEST_INSTAGRAM_URL`: An Instagram video URL you control (optional)
   - `TEST_TIKTOK_URL`: A TikTok video URL you control (optional)

2. The workflow runs:
   - On push to main/master/develop branches
   - On pull requests
   - Daily at 2 AM UTC (schedule)
   - Manually via workflow_dispatch

### What it tests

- Video info extraction with yt-dlp
- Server startup and health checks
- Tool availability (yt-dlp, FFmpeg)

## 2. Diagnostics Bundle Generator

**Location:** 
- Frontend: Button in Settings modal (`script.js`)
- Backend: `/diagnostics` endpoint (`server.js`)
- Standalone: `scripts/generate-diagnostics.js`

Users can generate a one-click diagnostics bundle that includes:
- Application version
- System information (OS, CPU, memory)
- Tool versions (yt-dlp, FFmpeg)
- Environment information
- Configuration flags

### Usage

1. In-app: Settings → "Generate Diagnostics Bundle"
2. Command line: `node scripts/generate-diagnostics.js`

The bundle is a text file that can be attached to bug reports.

## 3. Issue Template with Diagnostics Requirement

**Location:** `.github/ISSUE_TEMPLATE/bug_report.md`

All bug reports must include a diagnostics bundle. The template clearly indicates this requirement, and issues without diagnostics are automatically labeled and may be auto-closed.

## 4. Opt-in Error Telemetry

**Location:** `script.js` (telemetry initialization)

Privacy-respectful error telemetry that:
- **Opt-in only** (disabled by default)
- Collects only error messages and stack traces
- Sanitizes all data (removes URLs, file paths, PII)
- Uses anonymous IDs only
- Does not collect personal data, URLs, or user content

### Configuration

Users can opt-in via Settings → "Help improve app quality (opt-in error reporting)".

**Note:** The telemetry system is implemented but requires a telemetry endpoint to be configured. By default, errors are queued but not sent unless `TELEMETRY_ENDPOINT` environment variable is set.

## 5. Triage Bot

**Location:** `.github/workflows/triage-bot.yml`

Automated issue triage that:

1. **Labels issues** based on content:
   - `bug` for crashes/errors
   - `enhancement` for feature requests
   - `needs-diagnostics` if diagnostics bundle is missing
   - `has-diagnostics` if diagnostics bundle is provided

2. **Auto-close policy**:
   - Issues without diagnostics are commented requesting them
   - After 7 days with no response, issues are automatically closed
   - Prevents issue backlog collapse

3. **Runs on**:
   - Issue opened/edited
   - Comments added
   - Scheduled (via workflow_dispatch for auto-close checks)

## Benefits

These automation features provide:

1. **Early breakage detection** - CI tests catch issues before users report them
2. **Faster debugging** - Diagnostics bundles provide all necessary info upfront
3. **Quality insights** - Error telemetry (opt-in) helps prioritize real-world issues
4. **Cleaner issue backlog** - Auto-close policy prevents stale issues from accumulating

## Configuration

### Required GitHub Secrets

For smoke tests:
- `TEST_YOUTUBE_URL` (required)
- `TEST_INSTAGRAM_URL` (optional)
- `TEST_TIKTOK_URL` (optional)

### Optional Configuration

- `TELEMETRY_ENDPOINT`: Set to enable error telemetry sending (default: disabled, errors queued only)

## Privacy

- **Telemetry**: Opt-in only, anonymous IDs, no PII
- **Diagnostics**: System info only, no personal data
- **Smoke Tests**: Uses your own test URLs only

