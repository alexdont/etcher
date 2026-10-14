// The text tool makes POINT text, the way Affinity's Artistic Text works.
//
//   - A click starts default-size text; a drag sets the size from its height
//     (text_drag_size_test). Either way it is selected and being typed into.
//   - Lines are the author's (Shift+Enter) and never wrap; spaces are kept;
//     the box is always exactly the text.
//   - Every handle scales it evenly — a corner about the opposite corner, an
//     edge about the middle of the opposite edge; Shift frees it (a corner
//     each way on its own, an edge a one-axis stretch). All eight show, in
//     black, and they work WHILE typing, the box dashed meanwhile.
//   - What is on screen while typing is the text itself, rendered live, so
//     Enter or a click away changes nothing.
//   - Text from before becomes point text when picked up, looking the same.
//
//   node test/js/text_tool_point_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

function body(name) {
  const start = src.indexOf(`    ${name}: function`);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  return src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function");
}

// Minimal SVG element stand-in: attributes, children, style.
function fakeEl(tag) {
  const attrs = {};
  return {
    tag, attrs, children: [], style: {}, textContent: "",
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
    get firstChild() { return this.children[0] || null; },
    querySelectorAll() { return this.children; }
  };
}
const DEFAULT_LABEL_FONT_SIZE = Number(src.match(/var DEFAULT_LABEL_FONT_SIZE = (\d+)/)[1]);
const POINT_HANDLE_MIN_PX = Number(src.match(/var POINT_HANDLE_MIN_PX = (\d+)/)[1]);
const POINT_EDGE_MIN_PX = Number(src.match(/var POINT_EDGE_MIN_PX = (\d+)/)[1]);
const POINT_HANDLE_COLOR = src.match(/var POINT_HANDLE_COLOR = "([^"]+)"/)[1];
const POINT_FRAME_OUT_PX = Number(src.match(/var POINT_FRAME_OUT_PX = (\d+)/)[1]);
const POINT_FRAME_IN_PX = Number(src.match(/var POINT_FRAME_IN_PX = (\d+)/)[1]);
const make = (name) => new Function("svgEl", "DEFAULT_LABEL_FONT_SIZE", "POINT_HANDLE_MIN_PX", "POINT_EDGE_MIN_PX",
  "POINT_HANDLE_COLOR", "POINT_FRAME_OUT_PX", "POINT_FRAME_IN_PX", "return " + body(name))(
  (tag, a) => { const e = fakeEl(tag); Object.entries(a || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; },
  DEFAULT_LABEL_FONT_SIZE, POINT_HANDLE_MIN_PX, POINT_EDGE_MIN_PX, POINT_HANDLE_COLOR,
  POINT_FRAME_OUT_PX, POINT_FRAME_IN_PX
);

const isPointText = make("_isPointText");
const pointStretch = make("_pointStretch");
const pointTextLines = make("_pointTextLines");
const renderPointText = make("_renderPointText");
const resizePointText = make("_resizePointText");
const ensurePointText = make("_ensurePointText");
const pointHandleBox = make("_pointHandleBox");
const syncPointEdgeRoom = make("_syncPointEdgeRoom");

// A board at 2 container px per image px; text 10 px wide per character at
// font 20 (0.5em a character), so the arithmetic below is readable.
function board(over) {
  return Object.assign({
    _markerScale: () => 2,
    _zoomPx: (n) => n * 2,
    _fontSizeFor: (shape) => shape.style.font_size * 2,
    _measureTextWidth: (t, size) => t.length * size * 0.5,
    _orientedBox: (g) => ({ x: g.x * 2, y: g.y * 2, w: g.w * 2, h: g.h * 2, deg: 0 }),
    _setRotateTransform() {},
    _applyLabelBg() {},
    _textboxFixed: (s) => !!(s.style && s.style.box === "fixed"),
    _isPointText: isPointText,
    _pointStretch: pointStretch,
    _pointTextLines: pointTextLines,
    _pointHandleBox: pointHandleBox,
    // Letters reach 0.75em up and 0.25em down: 1em in all, for easy sums.
    _pointTextMetrics: () => ({ asc: 0.75, desc: 0.25, fontAsc: 0.95, fontDesc: 0.25 }),
    _textEditor: null
  }, over || {});
}
function render(shape, over) {
  const el = fakeEl("g"), trect = fakeEl("rect"), ttext = fakeEl("text");
  renderPointText.call(board(over), shape, el, shape.geometry, trect, ttext);
  return { trect, ttext };
}

// ── what counts as point text ─────────────────────────────────────────────

assert.strictEqual(isPointText.call(board(), { kind: "text", style: { point: true } }), true);
assert.strictEqual(isPointText.call(board(), { kind: "text", style: {} }), false, "text from before");
assert.strictEqual(isPointText.call(board(), { kind: "text", style: { point: true, box: "fixed" } }), false,
  "a text BOX is its own thing");
assert.strictEqual(isPointText.call(board(), { kind: "callout", style: { point: true } }), false);

// ── the box is exactly the text: no wrap, spaces kept ─────────────────────

{
  // font 10 image = 20 container px; pad 4; "Hello  there" is 12 chars = 120.
  const shape = { kind: "text", style: { point: true, font_size: 10 },
    metadata: { title: "Hello  there\nsecond line that is much longer than the box" },
    geometry: { x: 5, y: 7, w: 3, h: 3 } };
  const { ttext, trect } = render(shape);
  const lines = ttext.children.map((t) => t.textContent);
  assert.deepStrictEqual(lines, ["Hello  there", "second line that is much longer than the box"],
    "the author's two lines, never folded, the double space kept");
  assert.strictEqual(ttext.getAttribute("xml:space"), "preserve");
  const widest = "second line that is much longer than the box".length * 10;
  assert.strictEqual(Number(trect.getAttribute("width")), widest + 8, "box = widest line + padding");
  assert.strictEqual(Number(trect.getAttribute("height")), 20 + 22 + 8, "box = 1em + 1.1em + padding");
  assert.deepStrictEqual([shape.geometry.w, shape.geometry.h], [(widest + 8) / 2, 50 / 2],
    "and the geometry IS that box, in image units");
  assert.deepStrictEqual(shape._renderedBox, { x: 5, y: 7, w: shape.geometry.w, h: shape.geometry.h });
  assert.strictEqual(Number(ttext.getAttribute("y")), 14 + 4 + 15,
    "first baseline at the letters' top (pad + ascent) — the descenders end a pad above the bottom");
  assert.deepStrictEqual(ttext.children.map((t) => t.getAttribute("dy")), ["0", "1.1em"]);
}

{
  // The box is the letters' reach, whatever it is: 0.9em up, 0.3em down.
  const shape = { kind: "text", style: { point: true, font_size: 10 }, metadata: { title: "gyp" },
    geometry: { x: 0, y: 0 } };
  const r = { trect: fakeEl("rect"), ttext: fakeEl("text") };
  renderPointText.call(board({ _pointTextMetrics: () => ({ asc: 0.9, desc: 0.3, fontAsc: 1, fontDesc: 0.3 }) }),
    shape, fakeEl("g"), shape.geometry, r.trect, r.ttext);
  const top = 0, base = Number(r.ttext.getAttribute("y")), bottom = Number(r.trect.getAttribute("height"));
  assert.strictEqual(base - 18 - top, 4, "pad above the tallest letters");
  assert.strictEqual(Math.round((bottom - (base + 6)) * 1000) / 1000, 4, "the same pad below the descenders");
  // Measured per family; canvas-less, typical values stand in.
  const metrics = make("_pointTextMetrics");
  const ctxM = {};
  const m = metrics.call(ctxM, "x-family");
  assert.ok(m.asc > 0.5 && m.desc > 0.1, "a sensible fallback");
  assert.strictEqual(metrics.call(ctxM, "x-family"), m, "cached");
}

// ── while typing, the draft is what shows ─────────────────────────────────

{
  const shape = { kind: "text", style: { point: true, font_size: 10 },
    metadata: { title: "old" }, _draftTitle: "new text", geometry: { x: 0, y: 0 } };
  const { ttext } = render(shape);
  assert.deepStrictEqual(ttext.children.map((t) => t.textContent), ["new text"]);
}

// ── an open editor rides the render ───────────────────────────────────────

{
  let fits = 0;
  const shape = { kind: "text", style: { point: true, font_size: 10 }, metadata: { title: "x" }, geometry: { x: 0, y: 0 } };
  render(shape, { _textEditor: { shape, point: true, fit: () => fits++ } });
  assert.strictEqual(fits, 1, "every render re-fits the editor over the text");
  assert.ok(shape._pointLayout && shape._pointLayout.fontPx === 20, "with the layout it lies over");
}

// ── stretch is drawn about the top-left ───────────────────────────────────

{
  const shape = { kind: "text", style: { point: true, font_size: 10, scale_x: 2, scale_y: 0.5 },
    metadata: { title: "ab" }, geometry: { x: 10, y: 10 } };
  const { ttext, trect } = render(shape);
  // tx = 20, ty = 20 in container px.
  assert.strictEqual(ttext.getAttribute("transform"), "matrix(2 0 0 0.5 -20 10)");
  assert.strictEqual(trect.getAttribute("transform"), ttext.getAttribute("transform"));
  assert.strictEqual(shape.geometry.w, (20 + 8) * 2 / 2, "the box is stretched too");
  assert.strictEqual(shape.geometry.h, 28 * 0.5 / 2);
}

// ── resizing ──────────────────────────────────────────────────────────────

function start() {
  return { box: { x: 100, y: 100, w: 200, h: 50 }, font: 20, sx: 1, sy: 1 };
}
function pull(handle, pt, freeform) {
  const shape = { kind: "text", style: { point: true, font_size: 20 } };
  resizePointText.call(board(), shape, start(), handle, pt, freeform);
  return shape;
}

{
  // Bottom-right pulled out to twice the size: the top-left holds.
  const s = pull(2, { x: 500, y: 200 });
  assert.strictEqual(s.style.font_size, 40, "a corner scales the size");
  assert.deepStrictEqual([s.style.scale_x, s.style.scale_y], [1, 1], "evenly");
  assert.deepStrictEqual(s.geometry, { x: 100, y: 100, w: 400, h: 100 });

  // Top-left pulled in to half: the bottom-right holds.
  const t = pull(0, { x: 200, y: 125 });
  assert.strictEqual(t.style.font_size, 10);
  assert.deepStrictEqual(t.geometry, { x: 200, y: 125, w: 100, h: 25 });

  // A pull that leans one way still scales evenly (projected on the diagonal).
  const lean = pull(2, { x: 500, y: 150 });
  assert.ok(lean.style.font_size > 20 && lean.style.font_size < 40);
  assert.strictEqual(lean.geometry.w / lean.geometry.h, 4, "proportions kept");
}

{
  // Shift: each way on its own — height through the size, width as stretch.
  const s = pull(2, { x: 700, y: 200 }, true);
  assert.strictEqual(s.style.font_size, 40, "twice as tall");
  assert.strictEqual(s.style.scale_x, 1.5, "three times as wide = 2× size × 1.5 stretch");
  assert.deepStrictEqual(s.geometry, { x: 100, y: 100, w: 600, h: 100 });
}

{
  // An edge scales evenly too, about the middle of the opposite edge.
  const r = pull("right", { x: 500, y: 0 });
  assert.deepStrictEqual([r.style.font_size, r.style.scale_x, r.style.scale_y], [40, 1, 1],
    "the right edge pulled out to twice the width: twice the size, no stretch");
  assert.deepStrictEqual(r.geometry, { x: 100, y: 75, w: 400, h: 100 },
    "the left edge holds, and the text grows evenly up and down about its middle");

  const t = pull("top", { x: 0, y: 50 });
  assert.strictEqual(t.style.font_size, 40, "the top edge pulled up: scaled, not stretched");
  assert.deepStrictEqual(t.geometry, { x: 0, y: 50, w: 400, h: 100 },
    "the bottom holds, centred left to right");

  const l = pull("left", { x: 200, y: 0 });
  assert.strictEqual(l.style.font_size, 10);
  assert.deepStrictEqual(l.geometry, { x: 200, y: 112.5, w: 100, h: 25 }, "the right edge holds");

  const b = pull("bottom", { x: 0, y: 125 });
  assert.strictEqual(b.style.font_size, 10);
  assert.deepStrictEqual(b.geometry, { x: 150, y: 100, w: 100, h: 25 }, "the top holds");
}

{
  // Shift on an edge: a stretch along that one axis.
  const r = pull("right", { x: 500, y: 0 }, true);
  assert.deepStrictEqual([r.style.font_size, r.style.scale_x, r.style.scale_y], [20, 2, 1],
    "Shift+right edge stretches it wider, nothing else");
  assert.deepStrictEqual(r.geometry, { x: 100, y: 100, w: 400, h: 50 }, "the left edge holds");

  const l = pull("left", { x: 200, y: 0 }, true);
  assert.strictEqual(l.style.scale_x, 0.5);
  assert.deepStrictEqual(l.geometry, { x: 200, y: 100, w: 100, h: 50 }, "the right edge holds");

  const t = pull("top", { x: 0, y: 50 }, true);
  assert.deepStrictEqual([t.style.scale_x, t.style.scale_y], [1, 2]);
  assert.deepStrictEqual(t.geometry, { x: 100, y: 50, w: 200, h: 100 }, "the bottom holds");

  const b = pull("bottom", { x: 0, y: 125 }, true);
  assert.strictEqual(b.style.scale_y, 0.5);
  assert.deepStrictEqual(b.geometry, { x: 100, y: 100, w: 200, h: 25 }, "the top holds");
}

{
  const flat = pull("right", { x: 0, y: 0 }, true);
  assert.ok(flat.style.scale_x > 0, "pulled past its other edge it stays a sliver, never inside out");
  const gone = pull("top", { x: 0, y: 900 });
  assert.ok(gone.style.font_size > 0, "nor does an even scale go below nothing");
  const tiny = pull(2, { x: 100, y: 100 });
  assert.ok(tiny.style.font_size * 2 >= 2, "never so small it cannot be found again");
}

// ── older text becomes point text, looking the same ───────────────────────

{
  const textEl = fakeEl("text");
  textEl.setAttribute("font-size", "26");
  ["Wrapped at", "its old box", "\u00A0"].forEach((t) => { const sp = fakeEl("tspan"); sp.textContent = t; textEl.children.push(sp); });
  const shape = { kind: "text", style: {}, metadata: { title: "Wrapped at its old box" },
    el: { querySelector: () => textEl } };
  let rendered = 0;
  const converted = ensurePointText.call(board({
    _hasPinnedFontSize: () => false, _renderShape: () => rendered++
  }), shape);
  assert.strictEqual(converted, true);
  assert.strictEqual(shape.style.point, true);
  assert.strictEqual(shape.style.font_size, 13, "the size it was showing (26 px at 2×)");
  assert.strictEqual(shape.metadata.title, "Wrapped at\nits old box\n", "the lines it was showing");
  assert.strictEqual(rendered, 1);
  assert.strictEqual(ensurePointText.call(board(), shape), false, "only once");
  assert.strictEqual(ensurePointText.call(board(), { kind: "text", style: { box: "fixed" } }), false,
    "a text box stays a text box");
}

// ── handles: all eight, always ────────────────────────────────────────────

{
  const handlePositions = make("_handlePositions");
  const ctx = board({ _titleHandlesOn: () => false });
  const shape = { kind: "text", style: { point: true }, geometry: { x: 0, y: 0, w: 1, h: 1 },
    _renderedBox: { x: 10, y: 20, w: 100, h: 30 } };
  assert.deepStrictEqual(handlePositions.call(ctx, shape),
    [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 50 }, { x: 10, y: 50 }],
    "four corners on the text's own box, no opt-in needed");
  assert.ok(/\} else if \(shape\.kind === "rectangle" \|\| self\._isPointText\(shape\)\) \{\s*self\._renderRectEdgeHandles\(shape\);/.test(src),
    "and the four edge grabbers rectangles have");
  assert.ok(src.includes('if (point) rect.classList.add("is-point");'), "dressed black and white");
  assert.ok(!/\.etcher-handle-edge\.is-point \{[^}]*opacity: 1/.test(src) &&
    src.includes('".etcher-handle.etcher-handle-edge.is-point.is-active,",'), "hidden until the cursor nears their side");
  assert.ok(src.includes('kind === "arrow" || kind === "text"'), "the hover tracker runs for text");
  const segs = make("_midpointSegmentsForShape");
  const sctx = board({ _pointHandleBox: () => ({ x: 10, y: 20, w: 100, h: 30 }) });
  assert.deepStrictEqual(segs.call(sctx, shape).map(s => [s.p.x, s.p.y, s.q.x, s.q.y]),
    [[10, 20, 110, 20], [110, 20, 110, 50], [110, 50, 10, 50], [10, 50, 10, 20]],
    "measured to each side, in handle order");
}

// ── its handles are black, and typing dashes its box ─────────────────────

{
  const handleColor = make("_handleColor");
  const ctx = board({ activeColor: "#f00" });
  assert.strictEqual(handleColor.call(ctx, { kind: "text", style: { point: true, color: "#ef4444" } }),
    src.match(/var POINT_HANDLE_COLOR = "([^"]+)"/)[1], "black, whatever colour the text is");
  assert.strictEqual(handleColor.call(ctx, { kind: "rectangle", style: { color: "#ef4444" } }), "#ef4444",
    "other shapes keep their own colour");
  assert.ok(/"\.etcher-text\.is-point\.is-selected \.etcher-text-rect,",\s*"\.etcher-text\.is-point\.is-editing \.etcher-text-rect,",\s*"\.etcher-text\.is-typing \.etcher-text-rect \{",\s*"  stroke: #111111; stroke-width: 1\.25px; stroke-dasharray: 4 3;/.test(src),
    "a black dashed box when selected and while it is being typed into");
  assert.ok(body("_renderPointText").includes('el.classList.add("is-point")'));
  assert.ok(body("_startTextEdit").includes('shape.el.classList.add("is-typing")'));
  assert.ok(/if \(point\) input\.setSelectionRange\(0, 0\);\s*else input\.select\(\);/.test(body("_startTextEdit")),
    "opened with a caret at the start, not the text selected");
  assert.ok(body("_endTextEdit").includes('ed.shape.el.classList.remove("is-typing")'));
}

// ── a just-started text's handles never pile up ──────────────────────────

{
  // At 2 px per image px the frame is at least 24 screen px = 12 image px
  // each way, growing right and down from the text's corner.
  const fresh = { kind: "text", style: { point: true }, _renderedBox: { x: 10, y: 20, w: 3, h: 8 } };
  assert.deepStrictEqual(pointHandleBox.call(board(), fresh), { x: 10, y: 20, w: 12, h: 12 });
  const grown = { kind: "text", style: { point: true }, _renderedBox: { x: 10, y: 20, w: 80, h: 30 } };
  assert.deepStrictEqual(pointHandleBox.call(board(), grown), grown._renderedBox,
    "and is just the text's box once that is bigger");

  // Edge grabbers step aside on a side too short to sit between corners.
  const edges = [0, 1, 2, 3].map(() => {
    const cls = new Set();
    return { cls, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } };
  });
  const ctx = board({ midpointHandles: edges });
  // 30 x 12 image px = 60 x 24 screen px: wide enough along the top and
  // bottom (44), too short up the sides.
  syncPointEdgeRoom.call(ctx, { kind: "text", style: { point: true }, _renderedBox: { x: 0, y: 0, w: 30, h: 12 } });
  assert.deepStrictEqual(edges.map((e) => e.cls.has("is-cramped")), [false, true, false, true]);
  syncPointEdgeRoom.call(ctx, { kind: "text", style: { point: true }, _renderedBox: { x: 0, y: 0, w: 30, h: 40 } });
  assert.deepStrictEqual(edges.map((e) => e.cls.has("is-cramped")), [false, false, false, false],
    "and come back as the text grows");
  assert.ok(src.includes('".etcher-handle-edge.is-cramped { display: none; }"'));
  assert.ok(/this\._syncPointEdgeRoom\(shape\);\s*this\._syncGrabRadii/.test(src),
    "checked again every time the handles move — as the text is typed, say");
}

// ── the editor: the text itself, with a caret ─────────────────────────────

{
  const ed = body("_startTextEdit");
  assert.ok(ed.includes('input.style.color = point ? "transparent" : edColor;'),
    "the textarea's own glyphs are invisible — the live render is what shows");
  assert.ok(ed.includes("var existing = !point &&"), "so the text is not hidden while typing");
  assert.ok(/shape\._draftTitle = input\.value;\s*\/\/ Renders the text and re-fits this editor over it\.\s*selfEd\._renderShape\(shape\);/.test(ed),
    "every keystroke renders the real text");
  assert.ok(/if \(e\.shiftKey\) \{\s*if \(!point\) return;\s*e\.preventDefault\(\);[\s\S]*?input\.setRangeText\("\\n"/.test(ed),
    "Shift+Enter puts the line break in");
  assert.ok(/if \(point && self\.editingShape === shape && e\.target\.closest &&\s*e\.target\.closest\("\.etcher-handle, \.etcher-grab"\)\) \{/.test(ed),
    "pressing one of its handles does not end the edit");
  assert.ok(ed.includes("if (self._textEditor.resizing) return;"), "nor does the blur that press may cause");
  assert.ok(ed.includes("this.svg.insertBefore(fo, firstHandle)"), "the editor lies under the handles");
  const commit = body("_commitTextEdit");
  assert.ok(commit.includes('? ed.input.value.replace(/\\s+$/, "")'),
    "commit keeps the author's spaces and lines; only trailing blank goes");
  assert.ok(body("_endTextEdit").includes("delete ed.shape._draftTitle"), "and the draft is gone after");
}

console.log("text tool (point text): all checks passed");

// ── the dashed outline is a grip while typing ─────────────────────────────

{
  const onFrame = make("_onPointTextFrame");
  const rect = { getBoundingClientRect: () => ({ left: 100, top: 100, right: 200, bottom: 150 }) };
  const shape = { el: { querySelector: () => rect } };
  const at = (x, y) => onFrame.call({}, shape, { clientX: x, clientY: y });
  assert.strictEqual(at(100, 125), true, "on the left edge");
  assert.strictEqual(at(100 - POINT_FRAME_OUT_PX, 125), true, "just outside it");
  assert.strictEqual(at(100 + POINT_FRAME_IN_PX - 1, 125), true, "just inside it");
  assert.strictEqual(at(150, 125), false, "the middle is the words (caret), not the grip");
  assert.strictEqual(at(100 - POINT_FRAME_OUT_PX - 2, 125), false, "away from it is the board");
  assert.strictEqual(at(150, 152), true, "the bottom edge too");
  const press = body("_startTextEdit");
  assert.ok(/self\._onPointTextFrame\(shape, e\)[\s\S]{0,120}\.etcher-handle, \.etcher-grab[\s\S]{0,80}e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*self\._movePointTextWhileTyping\(shape, e\);/.test(press),
    "a press there moves the text instead of placing the caret (handles keep theirs)");
  const mover = body("_movePointTextWhileTyping");
  assert.ok(mover.includes("ed.resizing = true") && mover.includes("input.setSelectionRange(caret[0], caret[1])"),
    "the edit stays open and the caret comes back where it was");
}

{
  // The grip is a real element over the outline, wearing the move cursor —
  // a browser repaints the cursor on crossing into an element, not on a
  // style swapped under a still pointer.
  const press = body("_startTextEdit");
  assert.ok(/grip = svgEl\("path", \{\}\);\s*grip\.classList\.add\("etcher-text-grip"\);\s*this\.svg\.insertBefore\(grip, fo\.nextSibling\);/.test(press),
    "laid over the editor, under the handles");
  assert.ok(src.includes('".etcher-overlay svg .etcher-text-grip { fill: transparent; fill-rule: evenodd; stroke: none; pointer-events: all; cursor: grab; }",'),
    "the open hand a selected shape shows (Linux themes often have no `move` cursor)");
  assert.ok(src.includes('".etcher-overlay svg.is-over-text-frame, .etcher-overlay svg.is-over-text-frame * { cursor: grabbing !important; }",'),
    "closed while dragging");
  assert.ok(body("_endTextEdit").includes("ed.grip.parentNode.removeChild(ed.grip)"), "and gone with the editor");
  const fitGrip = make("_fitPointGrip");
  const grip = fakeEl("path");
  const rect = { getBoundingClientRect: () => ({ left: 110, top: 120, width: 100, height: 50 }) };
  const shape = { el: { querySelector: () => rect } };
  fitGrip.call({ _textEditor: { shape, grip }, svg: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } }, shape);
  const O = POINT_FRAME_OUT_PX, I = POINT_FRAME_IN_PX;
  assert.strictEqual(grip.getAttribute("d"),
    `M${100 - O} ${100 - O}h${100 + 2 * O}v${50 + 2 * O}h${-(100 + 2 * O)}Z` +
    `M${100 + I} ${100 + I}v${50 - 2 * I}h${100 - 2 * I}v${-(50 - 2 * I)}Z`,
    "a ring: the box grown by the outside reach, less the box shrunk by the inside one");
}
