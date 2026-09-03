# GetVideosLocally — Source-authentic product demo

**Composition:** `ProductDemo`  
**Format:** 1920×1080 · 30fps · 45.0s · 1350 frames  
**Promise:** Paste a video link, choose the format/quality, download locally, and keep the result under your control.

## Non-negotiable composition rule

Every screenshot shown in this demo is copied at Studio/render time from the GetVideosLocally repository itself. The project does not download, generate, recreate, trace, or substitute product screenshots.

`npm run studio` automatically executes `scripts/sync-source-assets.mjs`, which copies:

- `../public/Pic1.png` → `remotion (9)/public/Pic1.png`
- `../public/Pic2.png` → `remotion (9)/public/Pic2.png`
- `../public/Pic3.png` → `remotion (9)/public/Pic3.png`
- `../public/Pic4.png` → `remotion (9)/public/Pic4.png`
- `../assets/Logo.png` → `remotion (9)/public/Logo.png`
- `../public/fonts/manrope-latin.woff2` → `remotion (9)/public/manrope-latin.woff2`

If any source asset is missing, the sync script intentionally fails instead of fabricating a replacement.

The UI screenshots are treated as 1286×972 source-coordinate planes. Camera transforms and cursor points are expressed against those source coordinates so zooms, rings and cursor movement remain geometrically attached to the original interface.

## Scene plan

| Scene | Time | Frames | Story job | Source / exact focus | Copy + motion |
|---|---:|---:|---|---|---|
| 1. Product reveal | 0:00–0:04 | 0–119 | Opening hook | Source `Logo.png`; no product screenshot yet. | `GetVideosLocally` / `Paste a link. Choose your quality. Keep the file.` Logo + title settle with one restrained spring. |
| 2. Paste URL | 0:04–0:09 | 120–269 | Primary task entry | `Pic2.png`; authentic URL field around source rect **x 35, y 441, w 505, h 56**. | Camera moves from full application context to the real input. Cursor lands in the field. No replacement input and no fake typed URL. |
| 3. Format + quality | 0:09–0:13 | 270–389 | Choice / control | `Pic2.png`; Format around **x 36, y 553, w 244, h 55**; Quality around **x 295, y 553, w 242, h 55**. | Cursor travels from the real Format dropdown toward the real Quality dropdown. Camera stays locked to their shared row so spatial relationships remain authentic. |
| 4. Download action | 0:13–0:17 | 390–509 | Primary action + transition | `Pic2.png`; Download Now around **x 35, y 686, w 505, h 59**. | Cursor presses the actual button position. The product red expands outward from the click location and becomes the transition. |
| 5. Active progress | 0:17–0:23 | 510–689 | Outcome begins | `Pic1.png`; real active download row in the right-hand panel, focus approx **x 615, y 323, w 624, h 175**. | Red wipe reveals the captured active-download state. Slow camera push emphasizes thumbnail, title, bitrate, percentage and queue state already present in the source image. |
| 6. Capability carousel | 0:23–0:29 | 690–869 | Breadth / flexibility | Editorial motion only; **not presented as app UI**. | Fixed statement + vertical list: `MP4 · up to 8K`, `MKV · WEBM · MOV`, `MP3 · WAV · FLAC`, `M4A · OPUS`, `1000+ supported sites`. Soft edge clipping and steady vertical travel. |
| 7. History | 0:29–0:35 | 870–1049 | After-state | `Pic3.png`; first real history item approx **x 12, y 358, w 402, h 185**; folder control approx source **x 382, y 427**. | Camera reframes one actual history card. Cursor moves toward the real folder button. No fake tooltip, no fake status card. |
| 8. Proof | 0:35–0:41 | 1050–1229 | Results-backed proof | Editorial proof tiles; no fake interface. | Fixed claim: `High quality. Without the paywall.` Proof tiles: `8K`, `1000+`, `Free`, `Local`. Each settles from a different offset with light parallax. |
| 9. Signoff | 0:41–0:45 | 1230–1349 | Brand hold | Source `Logo.png`. | Cut to near-black. Logo resolves center. `GetVideosLocally` / `Free. Local. Up to 8K.` Final still hold. |

## Asset-composition decisions

The middle of the previous render was rejected because it drew substitute UI over screenshots. This version removes that behavior entirely. The source screenshots themselves carry the product states. The only overlays allowed on product screenshots are cursor graphics, focus rings and editorial captions; these overlays never masquerade as controls.

When a state is not present in the supplied screenshots, the demo does **not** invent it. For example, Scene 2 intentionally shows the cursor entering the real URL field but does not fake a filled version of that input. Scene 5 then cuts to the authentic captured active-download state in `Pic1.png`.

## Camera language

- Keep one real component dominant per UI scene.
- Start wide only when surrounding app context explains where the component lives.
- Finish UI zooms between roughly 1.6× and 2.1× on the 1286×972 source plane.
- Do not use a generic whole-window scale if the actual story lives in one control.
- Cursor travel should be smooth and sparse. One move should correspond to one decision.
- Product red is reserved for authentic product emphasis, focus rings and the Download transition.
- Do not add decorative fake panels over captured controls.

## Typography

Manrope is taken directly from `public/fonts/manrope-latin.woff2` in the source repository. No remote font request is needed.

## Remotion notes

- All motion is frame-driven with `useCurrentFrame`, `interpolate`, and `spring`.
- No CSS transitions or keyframe animation.
- Scene timings are explicit `Sequence` boundaries.
- Source screenshot geometry is preserved by a native-coordinate camera stage rather than `object-fit: cover` crops that change coordinate meaning.
- `Pic4.png` is synced for source completeness but is not required by the current cut.

## Studio / render

From the repository root:

```bash
cd "remotion (9)"
npm install
npm run studio
```

The `prestudio` hook copies the real source assets automatically. Select **ProductDemo** in Remotion Studio.

For a final render after review:

```bash
npm run render
```

Output: `remotion (9)/out/ProductDemo.mp4`.
