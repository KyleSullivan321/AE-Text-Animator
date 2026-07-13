# AE Text Animator

An After Effects text-animator that ports the Figma Motion "Text Animator" plugin —
same panel UI and live previews, driving After Effects instead of Figma — and whose
output can be exported as a **Motion Graphics Template (.mogrt)** for Premiere Pro.

> Separate project from the Figma plugin (kept in its own folder). It **reuses** the
> Figma panel's UI and animation model; it does **not** share a build or repo.

## What it ports from the Figma plugin

- Animate a text layer by **character / word / line** (native selector ranges).
- Per-unit **stagger** (forward / backward / random), **duration**, **start delay**.
- **Animate in** and **Animate out** phases with a **hold** between them; each phase
  has its own duration, stagger, order, easing, direction, and target transforms.
- Transforms: translate X/Y, scale, opacity, blur, rotate.
- **Separate opacity-fade duration** (left-aligned in, right-aligned out).
- Easings: Linear, Ease in/out/in-and-out, **Decelerate / Accelerate / Smooth**,
  Overshoot, Bouncy, Gentle, Spring, Custom bezier.
- Presets (built-in + saved), the live CSS preview, and the simple/advanced view.

## Architecture

| Layer | Tech | Notes |
|------|------|-------|
| **Panel UI** | **Adobe CEP extension** (HTML/CSS/JS) | Ports the Figma panel almost verbatim — the CSS live preview, presets, easing menus, in/out phases, collapsed view. CEP is chosen over ScriptUI (can't do the CSS preview / rich controls) and over UXP (AE UXP is still immature). |
| **Engine** | **ExtendScript** (`host/*.jsx`) | Ports `code.ts`'s logic onto **native AE Text Animators + Expression Selectors** on one editable text layer, wrapped in undo groups. |
| **Bridge** | `CSInterface.js` | Panel ↔ ExtendScript via `evalScript`. Replaces the Figma `postMessage` contract. |
| **MOGRT** | Essential Graphics + `comp.exportAsMotionGraphicsTemplate()` | Expose parameters as Essential Graphics controls, then export for Premiere. |

Planned layout:

```
AE Text Animator/
  CSXS/manifest.xml         CEP extension manifest
  client/                   panel: index.html, css/, js/ (ported UI), CSInterface.js
  host/                     ExtendScript engine (animation + MOGRT)
  .debug                    CEP remote-debug ports (dev)
  README.md
```

## Easing in After Effects (the tricky part)

Figma easings are cubic-beziers and springs. AE's standard **temporal ease can't
overshoot** past a keyframe's value, so Overshoot / Bounce / Spring / arbitrary
custom-bezier curves can't be reproduced with two keyframes + temporal ease alone.
The faithful, MOGRT-friendly approach is **expression-driven easing**: each animated
value is computed by an expression evaluating the exact cubic-bezier / spring per
frame. This matches the Figma preview precisely and stays parametric (great for
Essential Graphics sliders). Simple monotonic eases can also use native keyframe ease.

## Engine approach — DECIDED: native Text Animators (editable text)

The engine drives **one editable text layer** with **native AE Text Animators +
Expression Selectors** (pivoted from an earlier split-into-layers approach). Each
animator's `ADBE Text Expressible Amount` runs a cubic-bezier Newton solver keyed on
`textIndex`/`textTotal`, **unclamped** so overshoot/spring/custom-bezier curves match
the Figma CSS preview exactly. Technique derived from `TypeArray_v2.0.ffx`.

Why native beats splitting layers:
- **Perfect spacing/kerning/justification for free** — no glyph-advance measuring.
- **Text stays editable** — retype in AE (or in Premiere via MOGRT) and the animation
  auto-restaggers, because `textTotal`-derived timing is computed live in the expression.
- **Per-character blur is native** (`ADBE Text Blur`) — no Gaussian-effect-per-layer.
- IN and OUT are separate stacked animators that compose (additive/multiplicative).

**Target: public release** — plan for a signed `.zxp`, licensing, and polish.

## Roadmap

1. ✅ **Scaffold** — CEP extension shell + host bridge (round-trip proven).
2. ✅ **Full UI panel** — the whole Figma panel ported (previews, custom-bezier graphs,
   easing menus incl. Decelerate/Accelerate/Smooth, in/out phases, simple/advanced view).
   CEP integration: `evalScript` instead of postMessage, selection polling, `localStorage`
   persistence (presets, last params, view state).
3. ✅ **Engine (native)** — Text Animators + expression selectors; char/word/line ranges,
   expression-driven exact cubic-bezier easing incl. overshoot (matches the CSS previews),
   in → hold → out, all transforms + native per-char blur, separate opacity-fade duration,
   stagger orders. Verified in AE via the render-to-PNG loop.
4. ✅ **AE-context** — spacing/kerning/justification handled natively; scale/rotate pivot
   verified; overshoot verified. (Remaining nicety: center-pivot for scale/rotate to match
   Figma glyph-center exactly — currently native baseline anchor.)
5. ✅ **MOGRT** — Source Text exposed to Essential Graphics + one-click `.mogrt` export
   button (uses AE's native export dialog).
6. 🔜 **Packaging** — ZXP signing + installer, licensing.

Everything through #5 is **built, installed, and verified**; #6 is packaging for release.

## Dev setup (CEP)

- Enable unsigned extensions during dev: set `PlayerDebugMode = 1` in the CSXS prefs
  (`~/Library/Preferences/com.adobe.CSXS.<n>.plist` on macOS; `HKCU\Software\Adobe\CSXS.<n>`
  on Windows), then place/symlink the extension into the CEP `extensions` folder.
- Remote-debug the panel via the port in `.debug` (Chrome at `localhost:<port>`).
- Distribution later requires signing the extension into a **.zxp** (ZXPSignCmd).
