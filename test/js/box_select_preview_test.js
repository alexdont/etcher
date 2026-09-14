// Pins the live preview on a box-select.
//
// Dragging a marquee used to be a guess: nothing changed on screen until
// the release, and only then did you find out whether you had caught the
// shapes you meant. Now the shapes that a release WOULD take light up as
// the marquee sweeps over them, and one box is drawn around the whole
// prospective group — growing from one shape, to two, to however many —
// because a blue outline on a blue shape over a blue photo is exactly
// where a per-shape outline disappears.
//
// The load-bearing part is that `_shapesInBox` answers for both the
// preview and the commit, so what lit up is what gets selected.
//
//   node test/js/box_select_preview_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

const shapesInBox = extract("_shapesInBox");
const boxSelectRect = extract("_boxSelectRect");
const previewBoxSelect = extract("_previewBoxSelect");
const syncHull = extract("_syncBoxSelectHull");
const clearPreview = extract("_clearBoxSelectPreview");
const commitBoxSelect = extract("_commitBoxSelect");
const isInSelection = extract("_isInSelection");
const shapeBBox = extract("_shapeBBoxImagePx");

// The hull is a real DOM node in the browser; here it just has to be an
// object with a class and a style. Set up before the first call that
// creates one, and replaced per-block where a block counts creations.
global.document = {
  createElement: () => ({ className: "", style: {}, parentNode: null }),
};

function fakeEl() {
  const classes = new Set();
  return {
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

// Rectangles laid out left to right, 10 apart.
function shape(uuid, x, opts) {
  return Object.assign(
    { uuid, kind: "rectangle", geometry: { x, y: 0, w: 10, h: 10 }, el: fakeEl() },
    opts || {}
  );
}

function board(shapes) {
  return {
    shapes,
    selectedShapes: [],
    overlayWrapper: { appendChild: () => {} },
    handle: {
      container: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      // Identity projection, so container px == image px in these checks.
      imageToScreen: (p) => ({ x: p.x, y: p.y }),
      screenToImage: (p) => ({ x: p.x, y: p.y }),
    },
    _shapeBBoxImagePx: shapeBBox,
    _isInSelection: isInSelection,
    _shapesInBox: shapesInBox,
    _boxSelectRect: boxSelectRect,
    _syncBoxSelectHull: syncHull,
    _removeBoxSelectHull() { this._marqueeHull = null; },
    _refreshImageRing: () => {},
    _toImage(e) { return this.handle.screenToImage({ x: e.clientX, y: e.clientY }); },
  };
}

function selectedIds(shapes) {
  return shapes.filter((s) => s.el.classes.has("is-multi-selected")).map((s) => s.uuid);
}

// ── which shapes the box catches ───────────────────────────────────────────

{
  const shapes = [shape("a", 0), shape("b", 20), shape("c", 40)];
  const ctx = board(shapes);
  const hit = shapesInBox.call(ctx, { x1: 0, y1: 0, x2: 25, y2: 10 });
  assert.deepStrictEqual(hit.map((s) => s.uuid), ["a", "b"],
    "bbox intersection, not containment");

  // A locked shape can't be selected, so it must not be previewed either.
  const locked = board([shape("a", 0), shape("b", 20, { readonly: true })]);
  assert.deepStrictEqual(
    shapesInBox.call(locked, { x1: 0, y1: 0, x2: 100, y2: 10 }).map((s) => s.uuid),
    ["a"], "locked shapes stay out of the preview and the selection");

  // Not-yet-persisted drafts have no uuid.
  const draft = board([shape("a", 0), Object.assign(shape("x", 20), { uuid: null })]);
  assert.deepStrictEqual(
    shapesInBox.call(draft, { x1: 0, y1: 0, x2: 100, y2: 10 }).map((s) => s.uuid),
    ["a"]);
}

// ── the preview follows the marquee ────────────────────────────────────────

{
  const shapes = [shape("a", 0), shape("b", 20), shape("c", 40)];
  const ctx = board(shapes);
  const bs = { startImg: { x: 0, y: 0 } };

  // Sweep right: a, then a+b, then a+b+c.
  bs.previewAt = { clientX: 5, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a"], "one shape lights up first");

  bs.previewAt = { clientX: 25, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a", "b"], "then two");

  bs.previewAt = { clientX: 45, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a", "b", "c"], "then three");

  // Sweep back: shapes the marquee leaves go dark again.
  bs.previewAt = { clientX: 5, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a"],
    "shapes dropped by the marquee stop looking selected");
}

// Shift-extending: shapes already in the group keep their look no matter
// where the marquee goes — un-styling one would misreport what release does.
{
  const shapes = [shape("a", 0), shape("b", 20)];
  const ctx = board(shapes);
  ctx.selectedShapes = [shapes[0]];
  shapes[0].el.classList.add("is-multi-selected");

  const bs = { startImg: { x: 20, y: 0 } };
  bs.previewAt = { clientX: 25, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a", "b"]);
  assert.deepStrictEqual(bs.preview.map((s) => s.uuid), ["b"],
    "the already-selected shape is not the drag's to preview");

  // Marquee moves off b entirely: b goes dark, a — genuinely selected —
  // does not.
  bs.previewAt = { clientX: 21, clientY: 10 };
  bs.startImg = { x: 100, y: 0 };
  bs.previewAt = { clientX: 120, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a"],
    "an already-selected shape keeps its look when the marquee leaves it");
}

// ── the hull spans the whole prospective group ─────────────────────────────

{
  const shapes = [shape("a", 0), shape("b", 20), shape("c", 40)];
  const ctx = board(shapes);
  const created = [];
  global.document = {
    createElement: () => {
      const el = { className: "", style: {}, parentNode: null };
      created.push(el);
      return el;
    },
  };

  syncHull.call(ctx, [shapes[0]]);
  const hull = ctx._marqueeHull;
  assert.ok(hull, "a hull is drawn");
  assert.strictEqual(hull.className, "etcher-marquee-hull");
  const pad = 5;
  assert.strictEqual(hull.style.left, (0 - pad) + "px");
  assert.strictEqual(hull.style.width, (10 + pad * 2) + "px",
    "one shape → the hull hugs that shape");

  syncHull.call(ctx, [shapes[0], shapes[1]]);
  assert.strictEqual(ctx._marqueeHull.style.width, (30 + pad * 2) + "px",
    "two shapes → it grows to span both");
  syncHull.call(ctx, shapes);
  assert.strictEqual(ctx._marqueeHull.style.width, (50 + pad * 2) + "px",
    "three → it grows again");
  assert.strictEqual(created.length, 1, "the same element is reused, not re-created");

  // Shift-extend: the hull covers the existing group too, since that is
  // what ends up selected together.
  const ext = board(shapes);
  ext.selectedShapes = [shapes[2]];
  global.document = { createElement: () => ({ className: "", style: {}, parentNode: null }) };
  syncHull.call(ext, [shapes[0]]);
  assert.strictEqual(ext._marqueeHull.style.width, (50 + pad * 2) + "px",
    "the hull spans the already-selected shapes as well");

  // Nothing caught → no hull hanging around.
  const empty = board(shapes);
  syncHull.call(empty, [shapes[0]]);
  assert.ok(empty._marqueeHull, "drawn while something is caught");
  syncHull.call(empty, []);
  assert.strictEqual(empty._marqueeHull, null,
    "and taken down again the moment the marquee catches nothing");
}

// One layout read per pass, not one per corner: the hull walks four corners
// of every shape, and `_imageToContainer` takes its own rect every call.
{
  const body = src.slice(src.indexOf("    _syncBoxSelectHull: function"),
                         src.indexOf("\n    },", src.indexOf("    _syncBoxSelectHull: function")));
  assert.strictEqual((body.match(/getBoundingClientRect/g) || []).length, 1,
    "the container rect is read once for the whole pass");
  assert.ok(!body.includes("self._imageToContainer("),
    "…which is why it projects through imageToScreen directly");
  assert.ok(body.includes("self.handle.imageToScreen("),
    "the projection itself still goes through the viewer");
  assert.strictEqual((body.match(/bb\.x \+ bb\.w/g) || []).length, 2,
    "all four corners are projected — a rotated canvas maps a box to a quad");
}

// ── teardown leaves nothing wearing a selected look ────────────────────────

{
  const shapes = [shape("a", 0), shape("b", 20)];
  const ctx = board(shapes);
  const bs = { startImg: { x: 0, y: 0 }, previewAt: { clientX: 25, clientY: 10 } };
  global.document = { createElement: () => ({ className: "", style: {}, parentNode: null }) };
  previewBoxSelect.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), ["a", "b"]);

  clearPreview.call(ctx, bs);
  assert.deepStrictEqual(selectedIds(shapes), [],
    "an abandoned box-select leaves no shape looking selected");
  assert.strictEqual(ctx._marqueeHull, null);
  assert.strictEqual(bs.preview, null);
}

// ── preview and commit agree, by construction ──────────────────────────────

{
  const shapes = [shape("a", 0), shape("b", 20), shape("c", 40)];
  const ctx = board(shapes);
  const added = [];
  ctx._addToSelection = (s) => added.push(s.uuid);

  const bs = { startImg: { x: 0, y: 0 } };
  bs.previewAt = { clientX: 25, clientY: 10 };
  previewBoxSelect.call(ctx, bs);
  const lit = bs.preview.map((s) => s.uuid);

  commitBoxSelect.call(ctx, bs, { clientX: 25, clientY: 10 });
  assert.deepStrictEqual(added, lit,
    "release selects exactly what the preview lit up");
}

// Both really do go through the one helper — the property above holds by
// construction rather than by the two implementations happening to agree.
{
  for (const fn of ["_previewBoxSelect", "_commitBoxSelect"]) {
    const body = src.slice(src.indexOf(`    ${fn}: function`),
                           src.indexOf("\n    },", src.indexOf(`    ${fn}: function`)));
    assert.ok(body.includes("_shapesInBox("),
      `${fn} should ask _shapesInBox rather than re-deriving the hit set`);
  }
}

// The release drops the preview styling BEFORE committing, so shapes the
// marquee merely brushed don't keep a selected look.
{
  const up = src.slice(src.indexOf("self._docPointerUp = function(e) {"),
                       src.indexOf("var tap = self._pendingTap;"));
  assert.ok(up.indexOf("_clearBoxSelectPreview") !== -1 &&
              up.indexOf("_clearBoxSelectPreview") < up.indexOf("_commitBoxSelect"),
    "the preview is cleared before the commit re-adds the real selection");
}

// A drag killed by teardown (viewer remount, hook destroy) must not strand
// the preview either.
{
  const unwire = src.slice(src.indexOf("_unwireGlobalShapeListeners: function"),
                           src.indexOf("_setHoveredShape(null, false);",
                                       src.indexOf("_unwireGlobalShapeListeners: function")));
  assert.ok(unwire.includes("this._clearBoxSelectPreview();"),
    "teardown clears an in-flight box-select preview");
}

console.log("box select preview: all checks passed");
