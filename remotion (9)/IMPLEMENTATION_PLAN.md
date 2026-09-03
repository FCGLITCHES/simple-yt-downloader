# GetVideosLocally — Product Demo Implementation Plan

**Format:** 1920×1080, 30fps, 45.0s (1350 frames)

**Promise:** Download and convert videos in the quality and format you want, locally, without a subscription.

> The supplied Credential Pools blueprint is used only for pacing/motion grammar. Every product surface, claim, color, and asset here is GetVideosLocally-specific.

| Scene | Time | Frames | On-screen copy | Assets / camera / transition | Implementation notes |
|---|---:|---:|---|---|---|
| 1. Product reveal | 0:00–0:04 | 0–119 | “GetVideosLocally” / “Your videos. Your formats. Your machine.” | White field, red accent bar. Gentle 22px rise + opacity fade. | Minimal title establishes product identity; Manrope typography. |
| 2. Primary workflow | 0:04–0:09 | 120–269 | “Paste a link. Pick the quality. Keep the file.” | `public/Pic1.png`; subtle 1.02→1.09 camera push; cursor travels toward primary URL/download surface. | Keep screenshot readable. Cursor movement is one clean eased path. |
| 3. Action transition | 0:09–0:13 | 270–389 | Existing UI copy only. | `Pic1.png`; red outline isolates primary action. Cursor click triggers radial red wipe. | The red wipe is motivated by the product action rather than decorative motion. |
| 4. Options / setup | 0:13–0:19 | 390–569 | “Choose exactly what you want: format, quality and audio.” | `Pic2.png`; red wipe reveals screenshot. Overlay input types a neutral sample URL. | Use target UI as base plate; overlays clarify interaction without pretending screenshot controls are live. |
| 5. History / after-state | 0:19–0:24 | 570–719 | “Files stay easy to find.” / “Search, filter, play, or open the original folder.” | `Pic3.png`; 1.05 crop; red focus rectangle settles around a history row. | Outcome beat: the downloaded file remains manageable after completion. |
| 6. Format carousel | 0:24–0:30 | 720–899 | “One app. The formats you actually use.” | Reconstructed cards: MP4/8K, MKV/WEBM/MOV, MP3/WAV/FLAC, M4A/OPUS, 1,000+ sites. Vertical clipped carousel with edge fade. | Claims come from the product README. Avoid third-party logos; use typographic option marks. |
| 7. Focused download interaction | 0:30–0:35 | 900–1049 | “Best available quality → MP4 → Download Now” | `Pic1.png`; spring-based macro zoom toward primary composer/download area. | One relatable task, one clear submit action. No frantic cursor motion. |
| 8. Proof | 0:35–0:41 | 1050–1229 | “High quality without the paywall.” / “Download, convert and keep control of your files.” | Four proof tiles: 8K, 1000+, Free, Local. Tiles spring from varied offsets/depths around fixed statement. | Proof is product-backed: up to 8K, 1000+ sites, free desktop/local workflow. |
| 9. Brand signoff | 0:41–0:45 | 1230–1349 | “GetVideosLocally” / “Free. Local. Up to 8K.” | Dark field; `assets/Logo.png`; logo fade/sharpen feel, then still hold. | Hold final lockup for recognition. No competing motion. |

## Asset requirements

- Existing repo screenshots: `public/Pic1.png`, `public/Pic2.png`, `public/Pic3.png` (Pic4 remains available for future alternates).
- Existing repo logo: `assets/Logo.png` copied or referenced in the Remotion project's `public/` directory when running as a standalone folder.
- Manrope loaded through `@remotion/google-fonts` to match the product's current typography direction.
- No external source-company branding or UI is used.

## Remotion implementation

- Main composition: `ProductDemo`, 1350 frames, 30fps, 1920×1080.
- All motion is frame-driven with `useCurrentFrame`, `interpolate`, and `spring`; no CSS keyframe animations.
- Scenes are assembled with `Sequence` so timings are explicit and editable.
- Screenshot zooms are deliberately restrained (roughly 1.02–1.18) to preserve legibility.
- The demo intentionally does not render an MP4 yet; Studio is the review surface.

## Local Studio

From the repository root, make sure `remotion (9)/public` contains the product screenshots and logo (copy `public/Pic1.png`…`Pic4.png` and `assets/Logo.png` into it), then:

```bash
cd "remotion (9)"
npm install
npm run studio -- --no-open
```

Open the URL printed by Remotion and select **ProductDemo**.
