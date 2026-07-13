/*
 * AE Text Animator — ExtendScript engine (NATIVE text-animator port)
 * Full port of the Figma Text Animator model. Drives ONE editable text layer
 * with native AE Text Animators + Expression Selectors. Each selector's Amount
 * evaluates the exact cubic-bezier easing per character/word/line (via textIndex)
 * so the AE output matches the panel's CSS previews — including overshoot — with
 * perfect native spacing/kerning and no layer splitting.
 *
 * Panel calls:  TA_animate({...params...})  -> "OK|msg" | "ERR|msg"
 *               TA_selection()              -> "OK|<enabled 0/1>|<text>"
 *               TA_ping()                   -> "OK|engine ready ..."
 */

// ── Easing -> cubic-bezier (same curves the panel's CSS preview uses) ────────
function resolveBz(type, bz) {
    switch (String(type)) {
        case "LINEAR":               return [0, 0, 1, 1];
        case "EASE_IN":              return [0.42, 0, 1, 1];
        case "EASE_OUT":             return [0, 0, 0.58, 1];
        case "EASE_IN_AND_OUT":      return [0.42, 0, 0.58, 1];
        case "EASE_OUT_BACK":        return [0.34, 1.56, 0.64, 1];
        case "BOUNCY":               return [0.34, 1.4, 0.5, 1];
        case "GENTLE":               return [0.25, 0.46, 0.45, 0.94];
        case "CUSTOM_SPRING":        return [0.175, 0.885, 0.32, 1.275];
        case "DECELERATE":           return [0, 0, 0, 1];
        case "ACCELERATE":           return [0, 0, 1, 0];
        case "SMOOTH":               return [0.5, 0, 0.05, 1];
        case "CUSTOM_CUBIC_BEZIER":  return bz;
        default:                     return [0, 0, 0.58, 1]; // VARIABLE/unknown -> ease out
    }
}

// Cubic-bezier solver as an expression-language snippet (defines CB(t,...)).
// Unclamped in y so back/spring curves overshoot exactly like the CSS preview.
// Bracketed Newton+bisection: curves with a vertical initial/final tangent
// (e.g. Decelerate [0,0,0,1], Accelerate [0,0,1,0]) have derivative ~0 near the
// ends, which makes plain Newton diverge (x explodes -> garbage y -> characters
// "pop"). Keeping x inside a [lo,hi] bracket and bisecting on a bad step is stable.
var CB_JS =
    "function CB(t,x1,y1,x2,y2){if(t<=0)return 0;if(t>=1)return 1;" +
    "var cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by,x=t,lo=0,hi=1,i,z,d;" +
    "for(i=0;i<20;i++){z=((ax*x+bx)*x+cx)*x-t;if(z>0)hi=x;else lo=x;if(Math.abs(z)<1e-6)break;" +
    "d=(3*ax*x+2*bx)*x+cx;if(d>1e-6){x=x-z/d;if(x<lo||x>hi)x=(lo+hi)/2;}else x=(lo+hi)/2;}" +
    "return((ay*x+by)*x+cy)*x;}";

// Stagger-order helper: ord(i,N,dir,seed) -> stagger slot for 0-based index i.
// 'random' matches the panel's seeded Fisher-Yates so preview & render line up.
var ORD_JS =
    "function ord(i,N,dir,seed){if(dir=='backward')return N-1-i;if(dir!='random')return i;" +
    "var a=[],q;for(q=0;q<N;q++)a[q]=q;" +
    "for(q=N-1;q>0;q--){var r=Math.sin(seed*9301+q*49297+233)*10000;r=r-Math.floor(r);" +
    "var k=Math.floor(r*(q+1));var t=a[q];a[q]=a[k];a[k]=t;}" +
    "for(q=0;q<N;q++)if(a[q]==i)return q;return i;}";

function n2(v) { v = Math.round(v * 1e6) / 1e6; return String(v); }
function bzArgs(bz) { return n2(bz[0]) + "," + n2(bz[1]) + "," + n2(bz[2]) + "," + n2(bz[3]); }
function num(v, fb) { var x = Number(v); return isNaN(x) ? fb : x; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
// "#rrggbb" -> [r,g,b] in 0..1, or null if not a usable color.
function hexToArr(hex) {
    if (!hex || typeof hex !== "string") return null;
    var h = hex.replace(/^#/, "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (h.length < 6) return null;
    var r = parseInt(h.substring(0, 2), 16) / 255, g = parseInt(h.substring(2, 4), 16) / 255, b = parseInt(h.substring(4, 6), 16) / 255;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
}

// ── Selector Amount expressions ─────────────────────────────────────────────
// Index prelude. Normally N/i come live from textTotal/textIndex. In multi-line mask
// mode the text is split into per-line layers, so we bake the GLOBAL total (nOv) and add
// this line's index offset (iOff) to keep the stagger continuous across the whole block.
function idxPre(nOv, iOff) {
    return nOv ? ("var N=" + n2(nOv) + ";var i=textIndex-1+" + n2(iOff || 0) + ";")
               : "var N=textTotal;var i=textIndex-1;";
}
// IN: amount 100 -> 0 over the in window (char goes offset -> settled).
function inSelExpr(bz, delay, dur, stag, dir, seed, nOv, iOff) {
    return CB_JS + ORD_JS + idxPre(nOv, iOff) +
        "var slot=ord(i,N,'" + dir + "'," + seed + ");" +
        "var p=(time-" + n2(delay) + "-slot*" + n2(stag) + ")/" + n2(Math.max(1e-4, dur)) + ";" +
        "if(p<0)p=0;if(p>1)p=1;var e=CB(p," + bzArgs(bz) + ");(1-e)*100";
}
// OUT: amount 0 -> 100 over the out window (char goes settled -> out offset).
// outStart is computed live from textTotal so timing self-adjusts on text edits.
// headOffset delays this channel's start after outStart — used to TAIL-ALIGN a
// separate (shorter) fade-out so the char stays visible during the exit move and
// fades at the end, rather than fading up front.
function outSelExpr(bz, delay, inSettle, inStag, hold, outDur, outStag, dir, seed, headOffset, nOv, iOff) {
    headOffset = headOffset || 0;
    return CB_JS + ORD_JS + idxPre(nOv, iOff) +
        "var inEnd=" + n2(delay) + "+" + n2(inSettle) + "+" + n2(inStag) + "*(N-1);" +
        "var outStart=inEnd+" + n2(hold) + "+" + n2(headOffset) + ";" +
        "var slot=ord(i,N,'" + dir + "'," + seed + ");" +
        "var po=(time-outStart-slot*" + n2(outStag) + ")/" + n2(Math.max(1e-4, outDur)) + ";" +
        "if(po<0)po=0;if(po>1)po=1;var eo=CB(po," + bzArgs(bz) + ");eo*100";
}

// ── Marker-driven variants (optional "Markers" timing mode) ─────────────────
// The phase window comes from an IN / OUT duration-marker on the layer: the marker's
// position sets WHEN the phase fires, its length HOW LONG. stagger/duration set the
// SHAPE and are scaled (sc) to fit the marker span. `refDur` is the transform's per-unit
// duration; a separate fade passes refDur=transform-dur + its own actualDur so it shares
// the same span scale and can tail-align inside it (headOffset). Expression selectors can
// read `thisLayer.marker` directly since they evaluate in the layer's context.
function inSelExprMarker(bz, stag, dir, seed, refDur, actualDur, nOv, iOff) {
    return CB_JS + ORD_JS + idxPre(nOv, iOff) +
        "var mk=thisLayer.marker,nM=mk.numKeys,mT=0,mD=-1,q,k;" +
        "for(q=1;q<=nM;q++){k=mk.key(q);if(k.comment=='IN'){mT=k.time;mD=k.duration;break;}}" +
        "var amt=0;" +
        "if(mD>=0){if(mD<1e-4)mD=1e-4;var STAG=" + n2(stag) + ",RD=" + n2(Math.max(1e-4, refDur)) + ",AD=" + n2(Math.max(1e-4, actualDur)) + ";" +
        "var sc=mD/(STAG*(N-1)+RD);var slot=ord(i,N,'" + dir + "'," + seed + ");" +
        "var p=(time-mT-slot*STAG*sc)/(AD*sc);if(p<0)p=0;if(p>1)p=1;amt=(1-CB(p," + bzArgs(bz) + "))*100;}" +
        "amt";
}
function outSelExprMarker(bz, outStag, dir, seed, refDur, actualDur, headOffset, nOv, iOff) {
    headOffset = headOffset || 0;
    return CB_JS + ORD_JS + idxPre(nOv, iOff) +
        "var mk=thisLayer.marker,nM=mk.numKeys,oT=-1,oD=0,q,k;" +
        "for(q=1;q<=nM;q++){k=mk.key(q);if(k.comment=='OUT'){oT=k.time;oD=k.duration;break;}}" +
        "var amt=0;" +
        "if(oT>=0){if(oD<1e-4)oD=1e-4;var STAG=" + n2(outStag) + ",RD=" + n2(Math.max(1e-4, refDur)) + ",AD=" + n2(Math.max(1e-4, actualDur)) + ",HO=" + n2(headOffset) + ";" +
        "var sc=oD/(STAG*(N-1)+RD);var slot=ord(i,N,'" + dir + "'," + seed + ");" +
        "var po=(time-oT-(slot*STAG+HO)*sc)/(AD*sc);if(po<0)po=0;if(po>1)po=1;amt=CB(po," + bzArgs(bz) + ")*100;}" +
        "amt";
}

function srcTextProp(layer) { return layer.property("ADBE Text Properties").property("ADBE Text Document"); }
function animatorsOf(layer) { return layer.property("ADBE Text Properties").property("ADBE Text Animators"); }

// Add a Text Animator with an Expression Selector driven by `expr`.
// rangeType: 1=Characters, 3=Words, 4=Lines. Returns its Animator Properties group.
function addAnimator(layer, name, rangeType, expr) {
    var anim = animatorsOf(layer).addProperty("ADBE Text Animator");
    anim.name = name;
    var sel = anim.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
    try { sel.property("ADBE Text Range Type2").setValue(rangeType); } catch (e) {}
    sel.property("ADBE Text Expressible Amount").expression = expr;
    return anim.property("ADBE Text Animator Properties");
}

// ── Selection info for the panel (preview text + enabled state) ─────────────
var _taSelSig = "", _taSelText = "";
function TA_selection(force) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "OK|0|";
    var sel = comp.selectedLayers;
    if (sel.length !== 1 || !(sel[0] instanceof TextLayer)) return "OK|0|";
    var layer = sel[0];
    // Reading .value while the user edits that layer commits the edit and throws the
    // caret back to the start, so only re-read when the selected layer CHANGES -- or on
    // an explicit refresh, which the panel sends when it regains focus (by then the user
    // has stopped typing in the comp).
    //
    // The early returns above must NOT clear the cache: entering text-edit mode makes AE
    // briefly report no selected layer, and clearing would make the very next poll see a
    // "changed" layer, re-read .value, and eat the caret every 600ms while typing.
    var sig = comp.id + "/" + layer.index;
    if (sig === _taSelSig && !force) return "OK|1|" + _taSelText;
    _taSelSig = sig;
    var txt = "";
    try { txt = srcTextProp(layer).value.text; } catch (e) {}
    txt = String(txt).replace(/[\r\n]/g, "\n").substring(0, 200);
    _taSelText = txt;
    return "OK|1|" + _taSelText;
}

function TA_ping() { return "OK|engine ready (native) — AE " + app.version; }

// Export the active comp as a Premiere .mogrt. Adds the text layer's Source Text
// to Essential Graphics first, so editors can retype in Premiere and the
// expression selectors (keyed on textTotal) auto-restagger. AE shows its native
// export dialog for any font/media warnings — that's expected Adobe behaviour.
function TA_exportMogrt() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "ERR|Open the animated composition first.";
    var layer = null, i;
    for (i = 1; i <= comp.numLayers; i++) { if (comp.layer(i) instanceof TextLayer) { layer = comp.layer(i); break; } }
    if (!layer) return "ERR|No text layer found in the composition.";
    try {
        var st = srcTextProp(layer);
        if (!st.canAddToMotionGraphicsTemplate(comp)) return "ERR|This text can't be exposed to Essential Graphics.";
        try { st.addToMotionGraphicsTemplateAs(comp, "Text"); } catch (eDup) {} // already added -> ignore

        // Let the user choose where it goes (so the location is never a mystery).
        var safe = String(comp.name).replace(/[\\\/:*?"<>|]/g, "_");
        var def = new File(Folder.desktop.fsName + "/" + safe + ".mogrt");
        var f = def.saveDlg("Save Motion Graphics Template", "Motion Graphics Template:*.mogrt");
        if (!f) return "ERR|Export cancelled.";
        var target = f.fsName;
        if (!/\.mogrt$/i.test(target)) target += ".mogrt";

        var ok = comp.exportAsMotionGraphicsTemplate(true, target);
        if (!ok) return "ERR|Export was cancelled or not completed.";

        // Reveal the result in Explorer so it's immediately findable. AE sometimes
        // nests the file inside a same-named folder; /select shows either case.
        try { system.callSystem('explorer.exe /select,"' + target + '"'); } catch (eRev) {
            try { new File(target).parent.execute(); } catch (e2) {}
        }
        return "OK|Saved: " + target;
    } catch (e) {
        return "ERR|" + e.toString();
    }
}

// Count units for comp-duration sizing (mirrors textTotal per range mode).
function unitCount(full, splitMode) {
    if (splitMode === "line") {
        var ls = full.split(/[\r\n]/), c = 0, i;
        for (i = 0; i < ls.length; i++) if (ls[i].replace(/\s/g, "").length) c++;
        return Math.max(c, 1);
    }
    if (splitMode === "word") {
        var m = full.match(/\S+/g);
        return Math.max(m ? m.length : 1, 1);
    }
    return Math.max(full.replace(/[\r\n]/g, "").length, 1); // characters
}

// ── Main ────────────────────────────────────────────────────────────────────
function TA_animate(p) {
    p = p || {};
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "ERR|Open a composition, then select a text layer.";
    var sel = comp.selectedLayers;
    if (sel.length !== 1 || !(sel[0] instanceof TextLayer)) return "ERR|Select exactly one text layer.";
    var src = sel[0];

    var full = "";
    try { full = srcTextProp(src).value.text; } catch (e) {}
    if (!full || !full.replace(/\s/g, "").length) return "ERR|The selected text layer has no text.";

    var splitMode = (p.splitMode === "word" || p.splitMode === "line") ? p.splitMode : "character";
    var rangeType = 1;                              // Characters
    if (splitMode === "word") rangeType = 3;        // Words
    else if (splitMode === "line") rangeType = 4;   // Lines

    var timingMode = (p.timingMode === "markers") ? "markers" : "numeric";
    var doIn      = !(p.animateIn === false);
    var duration  = clamp(num(p.duration, 0.5), 0.01, 30);
    var stagger   = clamp(num(p.stagger, 0.08), 0, 5);
    var delay     = clamp(num(p.delayStart, 0), 0, 30);
    var staggerDir = p.staggerDir || "forward";
    var bzIn      = resolveBz(p.easing, [num(p.bezierX1, 0.25), num(p.bezierY1, 0.1), num(p.bezierX2, 0.25), num(p.bezierY2, 1)]);

    var translateX = num(p.translateX, 0), translateY = num(p.translateY, 40);
    var scaleFrom  = num(p.scaleStart, 100), opFrom = num(p.opacityStart, 0);
    var blurFrom   = num(p.blurStart, 0), rotFrom = num(p.rotateZ, 0);
    var colIn      = hexToArr(p.colorIn); // in: char animates FROM this color to its own fill

    var doOut   = (p.animateOut === true);
    var hold    = clamp(num(p.holdTime, 1), 0, 60);
    var outDur  = clamp(num(p.outDuration, 0.4), 0.01, 30);
    var outStag = clamp(num(p.outStagger, 0.04), 0, 5);
    var outDir  = p.outStaggerDir || "forward";
    var bzOut   = resolveBz(p.outEasing, [num(p.outBezierX1, 0.42), num(p.outBezierY1, 0), num(p.outBezierX2, 1), num(p.outBezierY2, 1)]);
    var outTX = num(p.outTranslateX, 0), outTY = num(p.outTranslateY, 40);
    var outScale = num(p.outScale, 100), outOp = num(p.outOpacity, 0);
    var outBlur = num(p.outBlur, 0), outRot = num(p.outRotate, 0);
    var colOut  = hexToArr(p.outColor); // out: char animates TO this color

    var fadeInSep  = (p.fadeInSeparate === true);
    var fadeInDur  = fadeInSep ? clamp(num(p.fadeInDuration, 0.3), 0.01, 30) : duration;
    var fadeOutSep = (p.fadeOutSeparate === true);
    var fadeOutDur = fadeOutSep ? clamp(num(p.fadeOutDuration, 0.3), 0.01, 30) : outDur;

    var maskReveal = (p.maskReveal === true);
    var maskPad    = clamp(num(p.maskPadding, 0), -200, 400);

    if (!doIn) { translateX = 0; translateY = 0; scaleFrom = 100; opFrom = 100; blurFrom = 0; rotFrom = 0; colIn = null; }

    app.beginUndoGroup("Text Animator");
    try {
        // Idempotent: strip what a previous run left — TA animators + masks on the source,
        // and any "TA Line N" split layers from a previous multi-line mask run.
        var ag = animatorsOf(src);
        for (var a = ag.numProperties; a >= 1; a--) { if (/^TA /.test(ag.property(a).name)) ag.property(a).remove(); }
        var mpar0 = src.property("ADBE Mask Parade");
        for (var mm0 = mpar0.numProperties; mm0 >= 1; mm0--) { if (/^TA /.test(mpar0.property(mm0).name)) mpar0.property(mm0).remove(); }
        for (var ll0 = comp.numLayers; ll0 >= 1; ll0--) { if (/^TA Line /.test(comp.layer(ll0).name)) comp.layer(ll0).remove(); }
        src.enabled = true; // undo any split-version disable

        var n = unitCount(full, splitMode);
        var inSettle = Math.max(duration, fadeInDur);
        var inEnd  = doIn ? (delay + inSettle + stagger * Math.max(0, n - 1)) : 0;
        var outStart = inEnd + hold;
        var outEnd = doOut ? (outStart + Math.max(outDur, fadeOutDur) + outStag * Math.max(0, n - 1)) : inEnd;
        if (comp.duration < outEnd + 0.5) comp.duration = outEnd + 0.5;

        // Center pivot for scale/rotate. Grouping matches split mode so a word/line scales
        // as one unit around its own centre. Applied per animated layer.
        function setGrouping(layer) {
            if (scaleFrom === 100 && rotFrom === 0 && outScale === 100 && outRot === 0) return;
            try {
                var grp = 1; if (splitMode === "word") grp = 2; else if (splitMode === "line") grp = 3;
                var mo = layer.property("ADBE Text Properties").property("ADBE Text More Options");
                mo.property("ADBE Text Anchor Point Option").setValue(grp);
                mo.property("ADBE Text Anchor Point Align").setValue([-50, -50]);
            } catch (eMO) {}
        }
        // Markers mode: add IN/OUT duration-markers to `layer` if missing (numeric-timing
        // defaults), so modes match and the user's marker moves survive a re-run.
        function phaseMarkers(layer) {
            if (timingMode !== "markers") return;
            var mp = layer.property("ADBE Marker"), hi = false, ho = false, z;
            for (z = 1; z <= mp.numKeys; z++) { var c = mp.keyValue(z).comment; if (c === "IN") hi = true; else if (c === "OUT") ho = true; }
            if (doIn && !hi) { var vI = new MarkerValue("IN"); vI.duration = Math.max(0.1, inEnd - delay); mp.setValueAtTime(delay, vI); }
            if (doOut && !ho) { var vO = new MarkerValue("OUT"); vO.duration = Math.max(0.1, outEnd - outStart); mp.setValueAtTime(outStart, vO); }
        }
        // Tight rectangle mask around a pre-measured (rest) box, expanded by pad on all sides.
        function addTightMask(layer, box, pad) {
            var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            m.name = "TA Mask";
            var sh = new Shape();
            sh.vertices = [[box.left - pad, box.top - pad], [box.left + box.width + pad, box.top - pad], [box.left + box.width + pad, box.top + box.height + pad], [box.left - pad, box.top + box.height + pad]];
            sh.closed = true;
            m.property("ADBE Mask Shape").setValue(sh);
        }
        // Build the IN/OUT animators on `layer`. nOv/iOff bake a global unit total + index
        // offset for split line-layers (keeps stagger continuous); 0 = live textTotal/textIndex.
        function applyInOut(layer, nOv, iOff) {
            setGrouping(layer);
            phaseMarkers(layer);
            if (doIn) {
                var inExpr = (timingMode === "markers")
                    ? inSelExprMarker(bzIn, stagger, staggerDir, 42, duration, duration, nOv, iOff)
                    : inSelExpr(bzIn, delay, duration, stagger, staggerDir, 42, nOv, iOff);
                if (translateX !== 0 || translateY !== 0 || scaleFrom !== 100 || rotFrom !== 0 || blurFrom > 0 || colIn || (opFrom !== 100 && !fadeInSep)) {
                    var pi = addAnimator(layer, "TA In", rangeType, inExpr);
                    if (translateX !== 0 || translateY !== 0) pi.addProperty("ADBE Text Position 3D").setValue([translateX, translateY, 0]);
                    if (scaleFrom !== 100) pi.addProperty("ADBE Text Scale 3D").setValue([scaleFrom, scaleFrom, 100]);
                    if (rotFrom !== 0)     pi.addProperty("ADBE Text Rotation").setValue(rotFrom);
                    if (blurFrom > 0)      pi.addProperty("ADBE Text Blur").setValue([blurFrom, blurFrom]);
                    if (colIn)             pi.addProperty("ADBE Text Fill Color").setValue([colIn[0], colIn[1], colIn[2], 1]);
                    if (opFrom !== 100 && !fadeInSep) pi.addProperty("ADBE Text Opacity").setValue(opFrom);
                }
                if (opFrom !== 100 && fadeInSep) {
                    var inOpExpr = (timingMode === "markers")
                        ? inSelExprMarker(bzIn, stagger, staggerDir, 42, duration, fadeInDur, nOv, iOff)
                        : inSelExpr(bzIn, delay, fadeInDur, stagger, staggerDir, 42, nOv, iOff);
                    addAnimator(layer, "TA In Opacity", rangeType, inOpExpr).addProperty("ADBE Text Opacity").setValue(opFrom);
                }
            }
            if (doOut) {
                var outExpr = (timingMode === "markers")
                    ? outSelExprMarker(bzOut, outStag, outDir, 84, outDur, outDur, 0, nOv, iOff)
                    : outSelExpr(bzOut, delay, inSettle, stagger, hold, outDur, outStag, outDir, 84, 0, nOv, iOff);
                if (outTX !== 0 || outTY !== 0 || outScale !== 100 || outRot !== 0 || outBlur > 0 || colOut || (outOp !== 100 && !fadeOutSep)) {
                    var po = addAnimator(layer, "TA Out", rangeType, outExpr);
                    if (outTX !== 0 || outTY !== 0) po.addProperty("ADBE Text Position 3D").setValue([outTX, outTY, 0]);
                    if (outScale !== 100) po.addProperty("ADBE Text Scale 3D").setValue([outScale, outScale, 100]);
                    if (outRot !== 0)     po.addProperty("ADBE Text Rotation").setValue(outRot);
                    if (outBlur > 0)      po.addProperty("ADBE Text Blur").setValue([outBlur, outBlur]);
                    if (colOut)           po.addProperty("ADBE Text Fill Color").setValue([colOut[0], colOut[1], colOut[2], 1]);
                    if (outOp !== 100 && !fadeOutSep) po.addProperty("ADBE Text Opacity").setValue(outOp);
                }
                if (outOp !== 100 && fadeOutSep) {
                    var fadeHead = Math.max(0, outDur - fadeOutDur);
                    var outOpExpr = (timingMode === "markers")
                        ? outSelExprMarker(bzOut, outStag, outDir, 84, outDur, fadeOutDur, fadeHead, nOv, iOff)
                        : outSelExpr(bzOut, delay, inSettle, stagger, hold, fadeOutDur, outStag, outDir, 84, fadeHead, nOv, iOff);
                    addAnimator(layer, "TA Out Opacity", rangeType, outOpExpr).addProperty("ADBE Text Opacity").setValue(outOp);
                }
            }
        }

        // ── Single native layer, or per-line split when masking multi-line text ─────
        // AE unions all masks on one layer, so per-line independent clipping needs one
        // layer per line. Single-line masking stays fully native (one mask on the source).
        var rawLines = full.split(/[\r\n]/), nonEmpty = 0, li2;
        for (li2 = 0; li2 < rawLines.length; li2++) if (rawLines[li2].replace(/\s/g, "").length) nonEmpty++;

        if (maskReveal && nonEmpty > 1) {
            var td = srcTextProp(src).value;
            var fs = td.fontSize, leading = td.autoLeading ? fs * 1.2 : td.leading;
            if (!leading || leading <= 0) leading = fs * 1.2;
            var basePos = src.property("ADBE Transform Group").property("ADBE Position").value;
            var offset = 0;
            for (li2 = 0; li2 < rawLines.length; li2++) {
                var lineTxt = rawLines[li2];
                if (!lineTxt.replace(/\s/g, "").length) continue;
                var dup = src.duplicate(); dup.name = "TA Line " + (li2 + 1);
                var dag = animatorsOf(dup);
                for (var da = dag.numProperties; da >= 1; da--) if (/^TA /.test(dag.property(da).name)) dag.property(da).remove();
                var dtd = srcTextProp(dup).value; dtd.text = lineTxt; srcTextProp(dup).setValue(dtd);
                dup.property("ADBE Transform Group").property("ADBE Position").setValue([basePos[0], basePos[1] + li2 * leading]);
                var box = dup.sourceRectAtTime(0, false); // rest box, before animators offset it
                applyInOut(dup, n, offset);
                addTightMask(dup, box, maskPad);
                offset += unitCount(lineTxt, splitMode);
            }
            src.enabled = false;
        } else {
            var sbox = maskReveal ? src.sourceRectAtTime(0, false) : null;
            applyInOut(src, 0, 0);
            if (sbox) addTightMask(src, sbox, maskPad);
        }

        var noun = "characters";
        if (splitMode === "line") noun = "lines";
        else if (splitMode === "word") noun = "words";
        return "OK|Animated " + n + " " + noun + " — " + (Math.round(outEnd * 100) / 100) + "s total.";
    } catch (e) {
        return "ERR|" + e.toString() + (e.line ? (" (line " + e.line + ")") : "");
    } finally {
        app.endUndoGroup();
    }
}
