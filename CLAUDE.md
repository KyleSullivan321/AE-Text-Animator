# CLAUDE.md

> Project memory loaded every session. Keep it **short**. Only include what Claude
> can't infer by reading the code. If a rule is already followed without being
> written here, delete it. A bloated CLAUDE.md gets ignored.

## Operating philosophy

This project runs on two complementary disciplines. They live as on-demand skills
so they don't bloat context — invoke or let them auto-trigger:

- **Write less code.** Before writing anything, walk the decision hierarchy:
  does it need to exist (YAGNI) → stdlib → platform feature → installed dep →
  one line → only then minimal code. See `/lazy-senior-dev`.
- **Think before coding.** Surface assumptions, don't hide confusion, make
  surgical changes, and define success criteria you can verify. See
  `/think-before-coding`, `/surgical-changes`, `/verification-loop`.

**Non-negotiable even when minimizing:** trust-boundary input validation,
data-loss prevention, security, and accessibility are never cut to save code.

## Workflow

- **Explore → plan → implement → verify → commit.** For anything touching 2+ files
  or with an unclear approach, plan first (`/plan`). If you could describe the diff
  in one sentence, skip the plan and just do it.
- **Verify before claiming done.** Run the check (test, build, lint, screenshot)
  and show the evidence. "Looks done" is not done. See `/verification-loop`.
- **Separate authoring from review.** The context that wrote code does not approve
  it. Use a fresh review pass (`/review`) or the `code-reviewer` agent.

## Memory model — how context persists across sessions

Three layers carry knowledge between sessions so we don't re-explain things. Put
each fact in the right one:

- **CLAUDE.md (this file)** — stable, team-shared instructions. Committed. Loaded in
  full every session, so keep it lean. Build commands, conventions, architecture.
- **`.claude/rules/`** — modular team-shared instructions, optionally path-scoped so
  they only load when relevant files are touched. Committed. Use as this file grows.
- **Auto memory** (`~/.claude/projects/<project>/memory/`) — learnings Claude writes
  itself (build quirks, debugging insights, discovered preferences). **Private and
  machine-local — not committed, not shared.** On by default. Browse with `/memory`.

Decision rule: *team-shared and stable → CLAUDE.md or `.claude/rules/`. Private,
discovered-as-you-go → let auto memory handle it.* When you correct the same thing
twice, promote it: a shared convention goes in CLAUDE.md; a personal/machine quirk
stays in auto memory.

**When compacting, always preserve the list of modified files and the test/build
commands** so long sessions don't lose working state.

## Project specifics

After Effects text-animator that ports the **Figma "Text Animator"** plugin
(`../../Figma Text Animator/figma-text-animator/`) and exports as a Premiere **MOGRT**.
Reuses that plugin's UI/previews and animation model; separate build/repo.

- **Stack:** Adobe **CEP** extension (panel = HTML/CSS/JS in `client/`) + **ExtendScript**
  engine (`host/textanimator.jsx`) driving the AE DOM. `CSXS/manifest.xml` is the
  CEP manifest. No build step yet (plain files).
- **Run / dev:** see `INSTALL.md` — set `PlayerDebugMode=1`, symlink the folder into
  `%APPDATA%\Adobe\CEP\extensions\`, open **Window → Extensions → AE Text Animator**.
- **Test:** autonomous render loop — drive AE with `AfterFX.exe -r script.jsx`, render a
  frame via `comp.saveFrameToPng(t, file)`, view the PNG. Harness pattern in the session
  scratchpad (`harness_native*.jsx`): cleanup `TA_*` comps → `$.evalFile` engine →
  `comp.openInViewer()` (required, or it animates the wrong comp) → select text → animate
  → render. Syntax-check with the `node -e "new Function(...)"` one-liner too.
- **Debug panel:** Chrome at `localhost:8088` (port from `.debug`).

## Decisions (locked)

- **Engine = NATIVE Text Animators** (pivoted 2026-07-06 from split-layers). One
  editable text layer; animation via native Text Animators + Expression Selectors.
  Gives perfect spacing/kerning/justification for free, keeps text editable, and makes
  editable-text MOGRT trivial. Split-layer approach is retired.
- **Easing = expression-driven selector** — each animator's `ADBE Text Expressible
  Amount` runs a cubic-bezier Newton solver keyed on `textIndex`/`textTotal`, unclamped
  so back/spring curves overshoot. Matches the Figma preview exactly. Technique derived
  from `TypeArray_v2.0.ffx`. IN amount = `(1-e)*100`, OUT = `eo*100`; IN and OUT are
  separate stacked animators that compose. `outStart` is computed live from `textTotal`,
  so retyping in Premiere auto-restaggers.
- **Target = public release** — plan for signed `.zxp` + installer + licensing.

## Conventions

- Panel ↔ engine: `window.__adobe_cep__.evalScript('TA_fn(' + JSON.stringify(params) + ')', cb)`.
  Params are inlined as a JS object literal (ExtendScript has no native JSON), so keep
  params to JSON-safe values. Engine returns `"OK|msg"` or `"ERR|msg"` strings.
- Wrap every DOM-mutating engine action in `app.beginUndoGroup()/endUndoGroup()`.

## Gotchas

- ExtendScript is ES3 — no `JSON`, no `let/const`, no arrow functions, no `Array.map`.
- **Chained ternaries `a ? b : c ? d : e` evaluate LEFT-associative in ExtendScript**
  (non-standard) → `(a ? b : c) ? d : e`, giving wrong results. Use if/else or fully
  parenthesize the else branch `a ? b : (c ? d : e)`. Bit the split-mode `rangeType`
  map hard. This is ExtendScript-only; the panel (Chrome JS) is fine.
- Native animator matchNames: `ADBE Text Animators` → `ADBE Text Animator` →
  `ADBE Text Selectors` → `ADBE Text Expressible Selector` (`ADBE Text Range Type2`:
  1=char, 3=word, 4=line; `ADBE Text Expressible Amount` = the expression). Properties
  under `ADBE Text Animator Properties`: `ADBE Text Position 3D`, `ADBE Text Scale 3D`,
  `ADBE Text Rotation`, `ADBE Text Opacity`, `ADBE Text Blur` (native per-char blur —
  no Gaussian effect needed). Source Text = `ADBE Text Document`.
- Spacing is native now — no `sourceRectAtTime` probe / `"A A"−"AA"` hacks (retired).
- MOGRT export: `comp.exportAsMotionGraphicsTemplate(overwrite, path)`; expose Source
  Text via `srcTextProp(layer).addToMotionGraphicsTemplateAs(comp, "Text")`. AE shows a
  native font/media warning dialog — expected; user confirms it. `-r` headless testing
  can't dismiss that dialog, so verify export interactively.
