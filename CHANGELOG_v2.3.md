# SimplyYTD v2.3 - Changelog

## Release Date: January 23, 2026

### 🚀 Major Improvements

#### Disk-Based Speed Measurement (Ground Truth)
- **NEW**: Download speed is now measured by tracking actual bytes written to disk
- Previously relied on yt-dlp's parsed speed which could show inflated values (e.g., 640 Mbps on a 512 Mbps connection)
- Speed is now calculated every 500ms by measuring file size changes
- Uses Exponential Moving Average (EMA) smoothing for stable, accurate readings
- Spike rejection: ignores values > 2.5× current average

#### Speed Limit Slider Improvements
- **Minimum 2 MB/s**: Removed impractical low-speed options below 2 MB/s
- **Non-linear mapping** for better usability:
  - Position 0: Unlimited (∞)
  - Positions 1-80: 2-10 MB/s (fine control, ~0.1 MB/s steps)
  - Positions 80-160: 10-100 MB/s (~1 MB/s steps)
  - Positions 160-200: 100-500 MB/s (10 MB/s steps)
- **Wider slider** (160px instead of 100px) for easier selection
- **Better display**: Shows "X MB/s" format instead of raw KB/s values
- **Fixed sync issue**: Settings modal and header slider now stay in sync

### 🔧 Bug Fixes

#### Speed Limit Now Applies Correctly
- Fixed issue where speed limit set in Settings modal wasn't being applied
- Both header slider and settings modal now correctly update the limit
- Added debug logging to confirm speed limit is applied to yt-dlp

#### Removed Confusing Raw yt-dlp Output
- Progress updates no longer show cryptic yt-dlp messages
- Unknown/unparseable lines are handled gracefully
- Always shows percentage with last known speed

### 📝 Technical Details

#### New Speed Calculation Flow:
1. When download destination is detected, a 500ms interval starts
2. Measures actual file size on disk (including .part files)
3. Calculates bytes/second: `(currentSize - lastSize) / deltaTime * 1000`
4. Applies EMA smoothing: `ema = ema * 0.8 + bps * 0.2`
5. Falls back to parsed yt-dlp speed only before file path is known

#### Files Modified:
- `server.js`: Disk-based speed measurement, speed limit debug logging
- `script.js`: Non-linear slider mapping, settings sync, speed formatting
- `style.css`: Wider slider, better output styling
- `index.html`: Updated slider max value

### 🎯 Known Limitations
- Speed measurement requires the download file to exist on disk
- Initial 1-2 seconds may use parsed speed as fallback
- Some very short downloads may not have accurate speed data

---

## Previous Version: v2.2
See previous changelog for v2.2 features.
