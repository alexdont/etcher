// Pins the dot a click leaves with a pen in hand.
//
// A stroke tool needs one mark a drag cannot make: the dot under a
// question mark, the dot on an i, a decimal point. The press was being
// thrown away — too small to be a stroke, so nothing was drawn at all —
// and the only way to get a dot was to scribble a tiny circle.
//
// A click now finalises a two-point stroke of no length, which paints as a
// disc under the round cap these kinds already wear. Everything that is
// not a stroke tool still treats a click as a cancelled drag.
//
//   node test/js/stroke_dot_test.js

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
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

const commit = extract("_commitFreehand");

// Why it is not zero: a path of no length paints as a disc but has no hit
// region, so the dot could be drawn and then never selected again.
const LEN = Number((src.match(/var DOT_LENGTH = ([\d.]+);/) || [])[1]);
assert.ok(LEN > 0 && LEN < 0.1, "a dot's length must be positive and invisible");
global.DOT_LENGTH = LEN;

function board(kind, pts, raw) {
  return {
    finalized: [],
    cancelled: 0,
    draftState: {
      kind: kind,
      geometry: { points: pts },
      el: { classList: { remove() {} } },
      _rawLast: raw || null
    },
    _strokeIsClick: () => true,
    _isClickGesture: () => true,
    _cancelDraft() { this.cancelled++; },
    _finalizeShape(k, geom) { this.finalized.push({ kind: k, geom: geom }); },
    _smoothStroke: (p) => p,
    _freehandFitTolerance: () => 1,
    _rdpSimplify: (p) => p,
    _fitCurve: () => []
  };
}

// ── a click leaves a dot ──────────────────────────────────────────────────

for (const kind of ["marker", "freehand"]) {
  const b = board(kind, [[10, 20]], [10.4, 20.6]);
  commit.call(b);

  assert.strictEqual(b.cancelled, 0, `${kind}: a click must not be thrown away`);
  assert.strictEqual(b.finalized.length, 1, `${kind}: it draws something`);
  assert.strictEqual(b.finalized[0].kind, kind);
  assert.deepStrictEqual(b.finalized[0].geom.points, [[10.4, 20.6], [10.4 + LEN, 20.6]],
    `${kind}: a stroke a hundredth of a px long — the round cap paints it ` +
    "as a disc, and it lands where the pointer really was rather than " +
    "where the filtered sample lagged to");
}

{
  // No raw position recorded (a press with no move at all): the sample is
  // the press, and it still draws.
  const b = board("marker", [[5, 6]], null);
  commit.call(b);
  assert.deepStrictEqual(b.finalized[0].geom.points, [[5, 6], [5 + LEN, 6]]);
}

// ── and every other kind still treats a click as a change of mind ─────────

{
  const b = board("polygon", [[1, 2]], null);
  commit.call(b);
  assert.strictEqual(b.cancelled, 1, "a click is not a polygon");
  assert.strictEqual(b.finalized.length, 0);
}

// ── the dot is a real stroke, not a special case downstream ───────────────

{
  // It goes through `_finalizeShape` like any other stroke, so selection,
  // styling, undo, deletion and the server-side render all see an ordinary
  // shape of that kind. The two points are the whole of it.
  const b = board("marker", [[3, 4]], null);
  commit.call(b);
  const geom = b.finalized[0].geom;
  assert.strictEqual(geom.points.length, 2, "two points, and only two");
  assert.deepStrictEqual(Object.keys(geom), ["points"],
    "no marker of its own: a dot is a stroke whose points coincide");
}

// ── the round cap that paints it is not incidental ────────────────────────

{
  // Without `stroke-linecap: round` on the marker class, a zero-length
  // stroke paints nothing at all — the same reason the dotted dash pattern
  // sets it explicitly.
  assert.match(src, /\.etcher-marker \{[\s\S]*?stroke-linecap: round/,
    "marker strokes must round their caps, or a dot is invisible");
}

console.log("stroke dot: all checks passed");
