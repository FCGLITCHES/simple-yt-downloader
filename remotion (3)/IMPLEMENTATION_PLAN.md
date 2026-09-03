# GetVideosLocally — Product Demo 3

**Render target:** 1920×1080, 30fps, 30.0s (900 frames), H.264.

## Product promise
Paste a video link, choose the output you want, and save the best available version locally without a subscription workflow.

## Scene 1 — Opening problem statement
**Duration:** 0:00–0:05.5 (165f)

**On-screen copy**
- “Downloading a video should not mean”
- “subscriptions, limits, or compromise.”

**Visual**
Solid GetVideosLocally red. White Manrope-style type, centered. The second line is the kinetic phrase.

**Motion**
0.6s fade/settle. At ~2.5s the key phrase creates three low-opacity duplicates that cascade down 64px apart, then collapse visually as the master copy fades. No third-party interface or wording is reproduced.

**Transition**
Red field hard-cuts into the bright app canvas after the kinetic phrase has cleared. The contrast is intentional: pain → product.

## Scene 2 — Paste a URL / inspect
**Duration:** 0:05.5–0:12.5 (210f)

**Asset:** `public/Pic1.png`

**Crop**
Use the screenshot as the base plate, enlarged to 108%. Frame the main URL-entry / primary download area. The Remotion overlay reconstructs only the interaction highlight; it does not modify the screenshot file.

**On-screen copy**
- Heading: “One link. No account maze.”
- URL: “https://www.youtube.com/watch?v=example”
- Caption: “Paste a video URL and let GetVideosLocally inspect what is available.”

**Motion**
Screenshot rises 42px with a soft scale 0.97→1.00. Camera eases 1.04→1.00. URL types over ~1.7s. Cursor moves attention to the primary action and clicks once.

**Implementation note**
If the current Pic1 layout changes, tune `ScreenshotCrop` x/y/scale and the overlay input coordinates in `PasteAndAnalyze`; keep the source screenshot intact.

## Scene 3 — Choose the download instruction
**Duration:** 0:12.5–0:18.5 (180f)

**Asset:** `public/Pic2.png`

**Crop**
Enlarge to 118% and bias toward the download options/quality controls. The command-style overlay is a narrative device that maps the blueprint’s “AI command input” beat onto GetVideosLocally’s actual task: selecting the desired output.

**On-screen copy**
- Heading: “Choose what you want to keep.”
- Input: “Download this in the highest available quality”

**Motion**
Text types for ~2.1s. Cursor blinks. Red send/action control springs from 82%→100%, then receives one deliberate cursor click.

**Transition**
The click provides the continuity match into the active download state.

## Scene 4 — Download outcome
**Duration:** 0:18.5–0:25.0 (195f)

**Asset:** `public/Pic3.png`

**Crop**
Enlarge to 128% and focus on the download/progress card area. A render-layer status card is placed over the relevant region to make progress legible at 1080p.

**On-screen copy**
- Status: “Downloading” → “Downloaded”
- Detail: “Highest available quality • saved locally”
- Benefit: “From link to local file.”
- Support: “Up to 8K, highest bitrate prioritised, with progress, speed and ETA visible while it works.”

**Motion**
Progress fills 0→100 over ~2.3s. Status changes from brand red to success green at completion. Benefit statement enters from +35px with a fade. No confetti or decorative particles.

**Transition**
Dark outcome scene fades conceptually into a clean white signoff; no busy wipe.

## Scene 5 — CTA / brand signoff
**Duration:** 0:25.0–0:30.0 (150f)

**Asset:** `public/Logo1.ico` (approved product logo)

**On-screen copy**
- “Get Videos Locally”
- “Paste a link. Choose the quality. Keep the file.”
- “Download free for Windows”
- “getvideoslocally.com”
- “Free • Open source • Windows”

**Motion**
Logo spring reveal, then wordmark, CTA button, URL. Hold the final CTA long enough to read/capture.

## Asset map
- `../public/Pic1.png`: URL/paste workflow.
- `../public/Pic2.png`: options / desired output.
- `../public/Pic3.png`: progress / result.
- `../public/Pic4.png`: reserved alternate screen if the current UI makes Pic3 less suitable.
- `../public/Logo1.ico`: official product mark.

The Remotion project intentionally points its public directory to the repository’s existing `public/` folder so screenshots are not duplicated or altered.

## Render
From `remotion (3)`:

```bash
npm install
npm run studio
npm run render
```

The render command outputs `out/GetVideosLocallyDemo.mp4`.

## Timing table
| Scene | Frames | Duration |
|---|---:|---:|
| Problem | 0–164 | 5.5s |
| Paste / inspect | 165–374 | 7.0s |
| Choose output | 375–554 | 6.0s |
| Outcome | 555–749 | 6.5s |
| CTA | 750–899 | 5.0s |
| **Total** | **900** | **30.0s** |
