# Render handoff — Remotion (9)

The project is already authored. Do not redesign it, replace its screenshots, or invent additional UI states.

## What the rendering agent should do

1. Pull the latest `main` branch.
2. Enter `remotion (9)`.
3. Run `npm install`.
4. Run `npm run studio` for review, or `npm run render` for the final MP4.
5. Review the `ProductDemo` composition at 1920×1080 / 30fps / 1350 frames.

## Source-image rule

`npm run studio` runs the asset sync first. The composition uses the source repository's own `Pic1.png`, `Pic2.png`, `Pic3.png`, `Pic4.png`, `Logo.png`, and Manrope font. Do not replace them with web images, generated images, screenshots from another product, or reconstructed interface panels.

If the sync script reports a missing source asset, stop and fix the repository path. Do not make a substitute.

## Review checklist

- Scene 2 cursor lands on the real URL input.
- Scene 3 cursor/focus remains attached to the real Format and Quality controls.
- Scene 4 click originates inside the real Download Now button.
- Scene 5 progress framing shows the real captured download row and keeps percentage/bitrate legible.
- Scene 6 reads clearly as an editorial capability interstitial, not application UI.
- Scene 7 camera isolates a real history card and cursor approaches its real folder control.
- Scene 8 proof tiles do not overlap the main outcome claim.
- Scene 9 logo and lockup hold cleanly to the final frame.
- No synthetic input fields, status panels, dropdowns, result cards, copy tooltips, or fake screenshots are introduced.

## If visual adjustment is needed

Only adjust camera center/zoom, caption placement, focus-ring coordinates, cursor path timing, spring parameters, or scene duration. Preserve the authentic product surfaces and the source-asset sync mechanism.
