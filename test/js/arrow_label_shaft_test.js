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

const board = { _labelRidesShaft: ridesShaft, _textDefaultBoxImagePx: () => 10 };

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

console.log("arrow label shaft: all checks passed");
