// Same-tool editing: the shapes a tool draws stay grabbable while it is
// armed. Press a rectangle's edge with the rectangle tool and you are
// moving that rectangle; a stationary press selects it (corner dots and
// all); a double-click opens its label — no trip to the cursor first.
// Everything else on the canvas still belongs to the tool: pressing it
// draws.
//
// The load-bearing rules pinned here:
//
//   1. WHICH kinds a tool edits — its own, and never the ink tools' or
//      the image tool's (strokes and pictures land on top of each other
//      on purpose).
//   2. WHERE the grab zone is — the OUTLINE for the filled kinds, so a
//      rectangle can still be drawn inside a rectangle; the footprint
//      for the stroke-built and text-ish kinds; the title always.
//   3. That the grab routes into the same move/select machinery the
//      cursor uses, that the doc-level tap tracker is told to stand
//      down for the gesture (touch reaches both handlers), and that a
//      committed shape's handles stay live under `.is-drawing` while
//      draft dots stay inert.
//
//   node test/js/same_tool_edit_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function lift(name, signature) {
  const needle = `    ${name}: function(${signature}) {`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name} in etcher.js`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

// ── 1. which kinds a tool edits ───────────────────────────────────────────

const armedToolEdits = lift("_armedToolEdits", "shape");

function ctx(tool) {
  return { activeTool: tool, _armedToolEdits: armedToolEdits };
}

{
  const rect = { kind: "rectangle", uuid: "u1" };
  assert.ok(ctx("rectangle")._armedToolEdits(rect), "a tool edits its own kind");
  assert.ok(!ctx("circle")._armedToolEdits(rect), "and nobody else's");
  assert.ok(!ctx(null)._armedToolEdits(rect), "cursor mode has its own (richer) path");

  assert.ok(ctx("dimension")._armedToolEdits({ kind: "dimension", uuid: "u2" }),
    "dimensions edit under the dimension tool — the label double-click case");
  assert.ok(ctx("line")._armedToolEdits({ kind: "line", uuid: "u3" }));

  assert.ok(!ctx("rectangle")._armedToolEdits({ kind: "rectangle", uuid: "u4", readonly: true }),
    "locked shapes stay locked");
  assert.ok(!ctx("rectangle")._armedToolEdits({ kind: "rectangle" }),
    "a shape with no uuid is a draft — not editable yet");

  for (const inky of ["freehand", "marker", "highlighter"]) {
    assert.ok(!ctx(inky)._armedToolEdits({ kind: inky, uuid: "u5" }),
      `${inky} strokes land on top of one another on purpose — never grabbed`);
  }
  assert.ok(!ctx("image")._armedToolEdits({ kind: "image", uuid: "u6" }),
    "pictures get stacked on purpose — a placement press keeps opening the picker");
}

// ── 2. where the grab zone is ─────────────────────────────────────────────

const grabTarget = lift("_sameToolGrabTarget", "pt");

// A harness with just enough of the layer: a flat 1:1 zoom, one shape,
// and the two helpers the function reaches for.
function layerWith(tool, shape) {
  return {
    activeTool: tool,
    _armedToolEdits: armedToolEdits,
    _shapeAt: function() { return shape; },
    _screenPerImagePx: function() { return 1; }, // tol = 8 image px
    _sameToolGrabTarget: grabTarget
  };
}

{
  const rect = { kind: "rectangle", uuid: "r1", geometry: { x: 100, y: 100, w: 200, h: 150 } };
  const layer = layerWith("rectangle", rect);

  assert.strictEqual(layer._sameToolGrabTarget({ x: 102, y: 180 }), rect,
    "a press on a rectangle's edge grabs it");
  assert.strictEqual(layer._sameToolGrabTarget({ x: 104, y: 104 }), rect,
    "corners are edges twice over");
  assert.strictEqual(layer._sameToolGrabTarget({ x: 200, y: 175 }), null,
    "the interior stays canvas — a rectangle can still be drawn inside a rectangle");

  const circle = { kind: "circle", uuid: "c1", geometry: { cx: 300, cy: 300, r: 100 } };
  const clayer = layerWith("circle", circle);
  assert.strictEqual(clayer._sameToolGrabTarget({ x: 395, y: 300 }), circle,
    "a circle grabs by its ring");
  assert.strictEqual(clayer._sameToolGrabTarget({ x: 320, y: 300 }), null,
    "…and its middle stays canvas");

  const poly = {
    kind: "polygon", uuid: "p1",
    geometry: { points: [[0, 0], [100, 0], [100, 100], [0, 100]] }
  };
  const player = layerWith("polygon", poly);
  assert.strictEqual(player._sameToolGrabTarget({ x: 50, y: 4 }), poly,
    "a polygon grabs by its segments");
  assert.strictEqual(player._sameToolGrabTarget({ x: 50, y: 50 }), null,
    "…interior stays canvas");

  const dim = { kind: "dimension", uuid: "d1", geometry: { x1: 0, y1: 0, x2: 100, y2: 0 } };
  const dlayer = layerWith("dimension", dim);
  assert.strictEqual(dlayer._sameToolGrabTarget({ x: 50, y: 0 }), dim,
    "a stroke-built kind grabs anywhere its hit-test lands — its footprint IS its outline");

  // The title satellite is a grab zone whatever the kind — it is how a
  // label is reached, and nothing is drawn inside a label on purpose.
  const titled = {
    kind: "rectangle", uuid: "r2",
    geometry: { x: 100, y: 100, w: 200, h: 150 },
    titleGroup: {},
    _renderedTitleImage: { x: 150, y: 170, w: 80, h: 20 }
  };
  assert.strictEqual(
    layerWith("rectangle", titled)._sameToolGrabTarget({ x: 180, y: 180 }), titled,
    "a press on the label grabs the shape even though it sits in the interior");

  assert.strictEqual(layerWith("rectangle", null)._sameToolGrabTarget({ x: 0, y: 0 }), null,
    "empty canvas draws");
}

// ── 3. the wiring ─────────────────────────────────────────────────────────

{
  // The press routes into the same move/select machinery the cursor
  // uses, and leaves the doc-level tap tracker a note (touch presses
  // reach both handlers; two trackers would tap twice).
  assert.ok(
    /var grab = this\._sameToolGrabTarget\(pt\);\s*if \(grab\) \{[\s\S]{0,400}?_startShapeMove\(grab, e\)/.test(src),
    "the tool-armed press routes a same-kind grab into _startShapeMove");
  assert.ok(src.includes("this._sameToolGrab = { pointerId: e.pointerId, at: Date.now() };"),
    "and notes the gesture for the doc-level tracker");
  assert.ok(
    /var grabbed = self\._sameToolGrab;\s*self\._sameToolGrab = null;/.test(src),
    "which reads the note once and stands down");

  // Mid-polygon / mid-callout presses are vertex placements for the
  // draft in flight — never grabs.
  assert.ok(
    /if \(!this\.draftPolygon && !this\.draftCallout\) \{\s*var grab = this\._sameToolGrabTarget/.test(src),
    "a draft in flight owns every press");

  // A committed shape's handles stay live while its tool is armed; only
  // the draft's inert dots let the tool drag over them.
  assert.ok(src.includes('".etcher-overlay.is-drawing .etcher-handle--inert {"'),
    "the is-drawing pointer-events kill is scoped to inert (draft) dots");
  assert.ok(!src.includes('".etcher-overlay.is-drawing .etcher-handle {"'),
    "…and no blanket rule deadens a committed shape's handles");
  assert.ok(src.includes('if (!opts.interactive) h.classList.add("etcher-handle--inert");'),
    "draft dots carry the inert class");

  // The label paths open under the shape's own tool: the doc-level
  // double-click gate asks _armedToolEdits instead of refusing every
  // armed tool outright.
  assert.ok(
    /if \(self\.activeTool != null && !self\._armedToolEdits\(hit\)\) return;/.test(src),
    "the doc-level double-click admits the shape's own tool");
}

console.log("same-tool editing: all checks passed");
