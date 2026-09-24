// Measures how far a marker stroke lands from the line that was drawn.
//
// A marker's path is not the pointer's path. Input runs through an
// exponential filter, is sampled every so many px, is thinned by RDP on
// release, and is finally drawn as a spline through what survives. Each
// step trades fidelity for calm, and the complaint that brought this here
// was that the total read as the stroke "shifting" — a line drawn
// deliberately did not stay where it was put.
//
// So the pipeline is run end to end against paths with no tremor in them
// at all, where every deviation is the pipeline's own invention, and the
// distance from the drawn line is measured. Tremor is measured too, from
// the other side: enough smoothing to be worth having.
//
//   node test/js/marker_accuracy_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function constant(name) {
  const m = src.match(new RegExp("var " + name + " = ([\\d.]+);"));
  assert.ok(m, `could not read ${name} from etcher.js`);
  return Number(m[1]);
}

global.MARKER_STREAMLINE = constant("MARKER_STREAMLINE");
global.MARKER_SAMPLE_PX = constant("MARKER_SAMPLE_PX");
global.MARKER_TREMOR_PX = constant("MARKER_TREMOR_PX");
global.CATMULL_ALPHA = constant("CATMULL_ALPHA");
global.CORNER_COS = constant("CORNER_COS");

function lift(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

const appendFreehand = lift("_appendFreehand");
const rdpSimplify = lift("_rdpSimplify");
const smoothStroke = lift("_smoothStroke");
const catmullRomPathD = lift("_catmullRomPathD");

// A board at 1:1, so screen px and image px are the same and the numbers
// below read as pixels on the user's screen.
const board = {
  _rdpSimplify: rdpSimplify,
  _imageToContainer: (p) => ({ x: p.x, y: p.y }),
  _freehandFitTolerance: function(targetScreenPx) {
    return Math.max(0.5, targetScreenPx || 8);
  }
};

// ── the pipeline, as `_extendFreehand` + `_commitFreehand` run it ─────────

function drawMarker(input) {
  // The shipped sampler, driven point by point — the filter that decides
  // how faithful a stroke is lives inside it, and a copy of it here would
  // be a copy of the thing under test.
  const draft = { kind: "marker", geometry: { points: [[input[0][0], input[0][1]]] } };
  const pen = Object.assign({ draftState: draft, _renderShape() {} }, board);
  for (const raw of input.slice(1)) appendFreehand.call(pen, { x: raw[0], y: raw[1] });

  // Release pins the stroke to where the pointer really was (`_commitFreehand`).
  const pts = draft.geometry.points;
  const end = draft._rawLast || input[input.length - 1];
  const tail = pts[pts.length - 1];
  if (Math.hypot(end[0] - tail[0], end[1] - tail[1]) > Math.max(0.5, global.MARKER_SAMPLE_PX)) {
    pts.push([end[0], end[1]]);
  }
  return flatten(catmullRomPathD.call(board, smoothStroke.call(board, pts),
                                      (p) => ({ x: p[0], y: p[1] }), { corners: true }));
}

// The drawn curve as a dense polyline: every cubic in the emitted path,
// sampled finely enough that measuring against it is measuring the ink.
function flatten(d) {
  const out = [];
  const nums = (s) => s.trim().split(/[\s,]+/).map(Number);
  let cur = null;
  for (const seg of d.match(/[MC][^MC]*/g) || []) {
    const v = nums(seg.slice(1));
    if (seg[0] === "M") { cur = [v[0], v[1]]; out.push(cur); continue; }
    for (let i = 0; i + 5 < v.length; i += 6) {
      const p0 = cur, c1 = [v[i], v[i + 1]], c2 = [v[i + 2], v[i + 3]], p3 = [v[i + 4], v[i + 5]];
      for (let t = 1; t <= 24; t++) {
        const u = t / 24, m = 1 - u;
        out.push([
          m * m * m * p0[0] + 3 * m * m * u * c1[0] + 3 * m * u * u * c2[0] + u * u * u * p3[0],
          m * m * m * p0[1] + 3 * m * m * u * c1[1] + 3 * m * u * u * c2[1] + u * u * u * p3[1]
        ]);
      }
      cur = p3;
    }
  }
  return out;
}

// Distance from a point to a polyline — how far the ink sits from the line
// that was drawn.
function distToPath(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy;
    let t = len2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
    if (d < best) best = d;
  }
  return best;
}

const drift = (input) => {
  const ink = drawMarker(input);
  let worst = 0;
  for (const p of ink) worst = Math.max(worst, distToPath(p, input));
  return worst;
};

// ── paths a hand draws, sampled the way a pointer reports them ────────────

// ~1px apart, which is what a steady hand at a normal speed produces.
function sampleAlong(fn, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(fn(i / n));
  return out;
}

const straight = sampleAlong((t) => [40 + t * 300, 120], 300);
const corner = [
  ...sampleAlong((t) => [40 + t * 150, 60], 150),
  ...sampleAlong((t) => [190, 60 + t * 150], 150)
];
// The hook of a question mark: a half-circle that turns down into a tail.
const hook = [
  ...sampleAlong((t) => {
    const a = Math.PI * (1 + t);
    return [200 + 60 * Math.cos(a), 140 + 60 * Math.sin(a)];
  }, 220),
  ...sampleAlong((t) => [260 - t * 20, 140 + t * 70], 90)
];

// ── what the pipeline invents on a line with nothing to smooth ────────────

{
  // Every px of this is the pipeline's, not the hand's: these inputs have
  // no tremor. A straight line is the strictest case — a filter that lags
  // and a spline that rounds have nothing to hide behind.
  const d = drift(straight);
  assert.ok(d <= 0.5,
    `a deliberate straight line must land where it was drawn (drifted ${d.toFixed(2)}px)`);
}

{
  // A corner is the case this was reported for: the spline drew a smooth
  // arc through the two long chords meeting there and bowed 11px off the
  // line that was drawn. It is treated as an end now, not a curve.
  const d = drift(corner);
  assert.ok(d <= 1.0,
    `a right-angle corner must keep its point (drifted ${d.toFixed(2)}px)`);
}

{
  const d = drift(hook);
  assert.ok(d <= 1.0,
    `a question mark's hook must follow the hand (drifted ${d.toFixed(2)}px)`);
}

{
  // The same corner drawn on a device that reports sparsely — a slow hand,
  // a low-rate pointer, a coarse tablet. A filter that smooths by a fixed
  // fraction lags a long stride as hard as a wobble, and the lag rounds
  // the corner off in the SAMPLES, where nothing downstream can find it
  // again: 3.2px at this rate before the filter learned to stand aside.
  for (const step of [2, 4, 8]) {
    const coarse = [
      ...sampleAlong((t) => [40 + t * 150, 60], 150 / step),
      ...sampleAlong((t) => [190, 60 + t * 150], 150 / step)
    ];
    const d = drift(coarse);
    assert.ok(d <= 1.0,
      `a corner drawn in ${step}px strides must stay a corner (drifted ${d.toFixed(2)}px)`);
  }
}

// ── and what it still smooths away ────────────────────────────────────────

{
  // The other side of the trade. Tremor is what the filter is for: a
  // deliberate line drawn by a shaky hand should come out calmer than it
  // went in, or the smoothing is not earning its lag.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  const shaky = straight.map((p) => [p[0], p[1] + rand() * 3]);

  const inkWobble = (() => {
    const ink = drawMarker(shaky);
    let worst = 0;
    for (const p of ink) worst = Math.max(worst, Math.abs(p[1] - 120));
    return worst;
  })();
  const handWobble = shaky.reduce((m, p) => Math.max(m, Math.abs(p[1] - 120)), 0);

  assert.ok(inkWobble < handWobble,
    `the stroke must read calmer than the hand (hand ${handWobble.toFixed(2)}px, ` +
      `ink ${inkWobble.toFixed(2)}px)`);
}

console.log("marker accuracy:",
  "straight", drift(straight).toFixed(2) + "px,",
  "corner", drift(corner).toFixed(2) + "px,",
  "hook", drift(hook).toFixed(2) + "px");
