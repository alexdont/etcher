// Pins the arrow's label to its shaft.
//
// A dimension's label has always ridden its line: centred at
// `metadata.title_offset` (0-1 along a->b), dragged ALONG the shaft, no
// leader. The arrow's label used to be an ordinary float-anywhere title —
// but an arrow's label names the pointing, and a name that can wander off
// the line reads as a separate note (head dev's call). So the arrow now
// rides too, while the plain line keeps its free label.
//
//   node test/js/arrow_label_shaft_test.js

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

const ridesShaft = extract("_labelRidesShaft");
const titleBox = extract("_shapeTitleBoxImage");
const arrowPath = extract("_arrowPath");
const shaftPointAt = extract("_shaftPointAt");
const shaftOffsetFor = extract("_shaftOffsetFor");

// Free helpers the non-riding path reaches.
global.normalizeTitleAlign = () => null;
global.alignedBox = () => null;

// ── who rides ─────────────────────────────────────────────────────────────

assert.strictEqual(ridesShaft("dimension"), true, "the dimension always has");
assert.strictEqual(ridesShaft("arrow"), true, "the arrow joins it");
assert.strictEqual(ridesShaft("line"), false,
  "the plain line keeps its ordinary float-above label");
for (const k of ["rectangle", "circle", "text", "callout", "marker"]) {
  assert.strictEqual(ridesShaft(k), false, `${k} does not ride`);
}

// ── the arrow's label is centred on the shaft, wherever its box says ──────

const board = {
  _labelRidesShaft: ridesShaft,
  _textDefaultBoxImagePx: () => 10,
  _arrowPath: arrowPath,
  _shaftPointAt: shaftPointAt,
  _shaftOffsetFor: shaftOffsetFor,
};

{
  const arrow = {
    kind: "arrow",
    geometry: { a: [0, 0], b: [100, 200] },
    // A stored box far from the line: its SIZE must be honoured (that is
    // what makes the label resizable) and its POSITION ignored.
    metadata: { title: "here", title_box: { x: 900, y: 900, w: 40, h: 20 } },
  };
  const box = titleBox.call(board, arrow, null);
  assert.deepStrictEqual(box, { x: 50 - 20, y: 100 - 10, w: 40, h: 20 },
    "no offset stored -> centred on the midpoint, sized by the stored box");

  arrow.metadata.title_offset = 0.25;
  const quarter = titleBox.call(board, arrow, null);
  assert.deepStrictEqual(quarter, { x: 25 - 20, y: 50 - 10, w: 40, h: 20 },
    "the offset slides the centre along a->b");
}

{
  // The contrast: a plain line with the same stored box keeps the box —
  // position and all. That is what free labels do.
  const line = {
    kind: "line",
    geometry: { a: [0, 0], b: [100, 200] },
    metadata: { title: "note", title_box: { x: 900, y: 900, w: 40, h: 20 } },
  };
  const box = titleBox.call(board, line, null);
  assert.deepStrictEqual(box, { x: 900, y: 900, w: 40, h: 20 },
    "a line's label stays exactly where it was put");
}

// ── a BENT arrow carries its label along the bend ─────────────────────────

{
  // Right angle: a=(0,0) -> bend (100,0) -> b=(100,100). Arc length 200.
  // The a->b chord's midpoint is (50,50) — a point the drawn line never
  // touches. The label must sit on the LINE: t=0.5 is the bend itself.
  const bent = { a: [0, 0], b: [100, 100], points: [[100, 0]] };

  assert.deepStrictEqual(shaftPointAt.call(board, bent, 0.5), { x: 100, y: 0 },
    "half way by arc length is the bend, not the chord's midpoint");
  assert.deepStrictEqual(shaftPointAt.call(board, bent, 0.25), { x: 50, y: 0 },
    "a quarter of the way is half along the first leg");
  assert.deepStrictEqual(shaftPointAt.call(board, bent, 0.75), { x: 100, y: 50 },
    "three quarters is half down the second leg");

  const arrow = {
    kind: "arrow",
    geometry: bent,
    metadata: { title: "x", title_offset: 0.5, title_box: { x: 0, y: 0, w: 40, h: 20 } },
  };
  const box = titleBox.call(board, arrow, null);
  assert.deepStrictEqual(box, { x: 100 - 20, y: 0 - 10, w: 40, h: 20 },
    "the label box is centred on the routed line — the bug was it hovering " +
    "over the phantom straight chord after the arrow was bent");

  // Dragging projects onto the nearest SEGMENT, so the offset lands where
  // the pointer is, not where the chord thinks it is.
  assert.strictEqual(shaftOffsetFor.call(board, bent, { x: 50, y: -30 }), 0.25,
    "a point above the first leg projects onto it");
  assert.strictEqual(shaftOffsetFor.call(board, bent, { x: 140, y: 50 }), 0.75,
    "a point beside the second leg projects onto it");

  // And the two-point case — every dimension, an unbent arrow — reduces to
  // the plain lerp it always was.
  const straight = { a: [0, 0], b: [100, 200] };
  assert.deepStrictEqual(shaftPointAt.call(board, straight, 0.25), { x: 25, y: 50 });
  assert.strictEqual(shaftOffsetFor.call(board, { a: [0, 0], b: [100, 0] }, { x: 25, y: 10 }), 0.25);
}

// ── the rest of the riding behaviour routes through the same helper ───────

{
  // Dragging slides the offset, the leader hides, and the editor opens on
  // the shaft — each site used to test `kind === "dimension"` directly;
  // pinning that they all go through _labelRidesShaft keeps the arrow (and
  // any future rider) from getting the position without the behaviour.
  const uses = (src.match(/_labelRidesShaft\(/g) || []).length;
  assert.ok(uses >= 5,
    `expected five call sites (shrink re-anchor, leader, position, drag, ` +
    `editor), found ${uses}`);
  assert.ok(!/A dimension's label slides ALONG/.test(src),
    "the drag site speaks of shaft-riders now, not the dimension alone");
}

// ── alignment never fights the shaft ──────────────────────────────────────

{
  // _commitTextEdit stamps center/middle on fresh non-text labels so a
  // rectangle's name lands inside it. Stamped on an arrow, the render's
  // aligned re-anchor snapped the label back to the shape's bbox centre
  // on every render — the drag stored a new offset, the render threw it
  // away, and the label read as ungrabbable (the failure was masked on
  // straight arrows, whose bbox centre IS the chord midpoint; a pinned
  // label size forced the re-anchoring path and surfaced it).
  assert.ok(/!this\._labelRidesShaft\(shape\.kind\) &&\n\s*!normalizeTitleAlign/.test(src),
    "a fresh shaft-riding label is never stamped with an alignment");
  assert.ok(/var titleAlign = this\._labelRidesShaft\(shape\.kind\)\n\s*\? null/.test(src),
    "and the render ignores an alignment already stamped on one, so " +
    "existing labels heal instead of staying stuck at the bbox centre");
}

console.log("arrow label shaft: all checks passed");
