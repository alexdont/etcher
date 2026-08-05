// Pins the curve a marker stroke is drawn as.
//
// The samples a marker stores are sparse — the spline is what turns them
// back into a stroke — so how it interpolates *is* the drawing quality. The
// property that matters is that it doesn't invent motion the hand didn't
// make: a Catmull-Rom spline with uniform knot spacing overshoots whenever
// consecutive samples are unevenly spaced, and bunched samples are exactly
// what a hand decelerating into a corner produces. The result is a little
// loop at every sharp turn.
//
// Centripetal spacing (alpha 0.5) is the standard fix and is provably free
// of cusps and self-intersections. These checks measure that directly by
// sampling the emitted cubics, rather than trusting the formula by eye.
//
//   node test/js/marker_spline_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

const ALPHA = Number((src.match(/var CATMULL_ALPHA = ([\d.]+);/) || [])[1]);
assert.ok(ALPHA > 0, "could not read CATMULL_ALPHA from etcher.js");
assert.strictEqual(ALPHA, 0.5, "centripetal is the cusp-free parameterization");
global.CATMULL_ALPHA = ALPHA;

const NEEDLE = "    _catmullRomPathD: function(points, mapPt) {";
const start = src.indexOf(NEEDLE);
assert.notStrictEqual(start, -1, "could not find _catmullRomPathD in etcher.js");
const end = src.indexOf("\n    },", start);
assert.notStrictEqual(end, -1, "could not find the end of _catmullRomPathD");
const pathD = eval(
  "(" +
    src.slice(start, end + "\n    }".length).replace("_catmullRomPathD: function", "function") +
    ")"
);

// Identity projection: the function maps every point through `mapPt`, and
// these checks work in the same space the points are given in.
const id = (p) => ({ x: p[0], y: p[1] });

// ── parsing + sampling, so the curve can be measured rather than eyeballed ──

function parse(d) {
  const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
  const segs = [];
  let cur = [nums[0], nums[1]];
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    segs.push({
      p0: cur,
      c1: [nums[i], nums[i + 1]],
      c2: [nums[i + 2], nums[i + 3]],
      p1: [nums[i + 4], nums[i + 5]]
    });
    cur = [nums[i + 4], nums[i + 5]];
  }
  return { start: [nums[0], nums[1]], segs };
}

function at(seg, t) {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return [
    b0 * seg.p0[0] + b1 * seg.c1[0] + b2 * seg.c2[0] + b3 * seg.p1[0],
    b0 * seg.p0[1] + b1 * seg.c1[1] + b2 * seg.c2[1] + b3 * seg.p1[1]
  ];
}

// Furthest the curve strays outside the axis-aligned box its own control
// points span — the measurable form of "the stroke bulges past where the
// hand went".
function excursion(points, d) {
  const { segs } = parse(d);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  let worst = 0;
  for (const seg of segs) {
    for (let t = 0; t <= 1; t += 1 / 64) {
      const [x, y] = at(seg, t);
      worst = Math.max(
        worst, minX - x, x - maxX, minY - y, y - maxY
      );
    }
  }
  return worst;
}

// The old uniform formula, kept here as the baseline the fix is measured
// against. If the source ever drifts back to this shape, the comparison
// below stops separating them and the assertions fail.
function uniformD(points) {
  const p = points;
  let d = "M " + p[0][0] + " " + p[0][1];
  for (let j = 0; j < p.length - 1; j++) {
    const p0 = p[j - 1] || p[j], p1 = p[j], p2 = p[j + 1], p3 = p[j + 2] || p2;
    d += " C " + (p1[0] + (p2[0] - p0[0]) / 6) + " " + (p1[1] + (p2[1] - p0[1]) / 6) +
         " " + (p2[0] - (p3[0] - p1[0]) / 6) + " " + (p2[1] - (p3[1] - p1[1]) / 6) +
         " " + p2[0] + " " + p2[1];
  }
  return d;
}

// ── it still passes through every sample ────────────────────────────────────

// The whole reason for a spline here rather than a fit: the stroke must go
// where the hand went. Interpolation, not approximation.
const wiggle = [[0, 0], [20, 30], [55, 10], [90, 60], [130, 20]];
const parsed = parse(pathD(wiggle, id));
assert.deepStrictEqual(parsed.start, wiggle[0], "starts on the first sample");
assert.strictEqual(parsed.segs.length, wiggle.length - 1, "one cubic per gap");
parsed.segs.forEach((seg, i) => {
  assert.deepStrictEqual(seg.p1, wiggle[i + 1], `passes through sample ${i + 1}`);
});

// ── the bug: overshoot at a sharp corner ────────────────────────────────────

// A hairpin whose tip is sampled tightly, the way a hand slows into a turn.
const hairpin = [[0, 0], [80, 0], [82, 1], [80, 3], [0, 3]];
const hairpinExcursion = excursion(hairpin, pathD(hairpin, id));
const hairpinUniform = excursion(hairpin, uniformD(hairpin));

assert.ok(hairpinUniform > 3,
  "sanity: uniform spacing really does bulge past the turn " +
  `(measured ${hairpinUniform.toFixed(2)}px) — if this stops being true the ` +
  "comparison below proves nothing");

// Not zero, and shouldn't be: a marker is expected to round a corner rather
// than come to a point, and on a hairpin whose tip is only 3px across that
// rounding is most of what's left. What matters is that it's a rounding and
// not a loop — small in absolute terms, and a fraction of what the uniform
// formula did.
assert.ok(hairpinExcursion < 1.5,
  `the curve must round the turn, not bulge past it (got ${hairpinExcursion.toFixed(2)}px)`);
assert.ok(hairpinExcursion < hairpinUniform / 2,
  "and stay well inside what the uniform formula it replaced produced " +
  `(${hairpinExcursion.toFixed(2)}px vs ${hairpinUniform.toFixed(2)}px)`);

// Same story where a tight cluster is followed by a long run.
const cluster = [[0, 0], [60, 0], [62, 0], [63, 0], [63, 60], [63, 140]];
assert.ok(excursion(cluster, pathD(cluster, id)) <
          excursion(cluster, uniformD(cluster)),
  "uneven sample spacing must not throw the curve outward");

// Evenly spaced samples are the case uniform spacing already handled; the
// centripetal version must not be *worse* there.
const even = [[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]];
assert.ok(excursion(even, pathD(even, id)) < 0.01,
  "a straight, evenly sampled run stays straight");

// ── degenerate input ────────────────────────────────────────────────────────

assert.strictEqual(pathD([], id), "", "no points, no path");
assert.strictEqual(pathD([[5, 7]], id), "M 5 7", "a single sample is a move-to");

// Two samples: one cubic, landing exactly on the second.
const pair = parse(pathD([[0, 0], [10, 10]], id));
assert.strictEqual(pair.segs.length, 1);
assert.deepStrictEqual(pair.segs[0].p1, [10, 10]);

// Coincident samples — a pointer that reported the same position twice —
// divide by the gap between them. Guarded, or the whole path becomes NaN and
// the stroke vanishes.
const dupes = pathD([[0, 0], [0, 0], [30, 0], [30, 0], [60, 20]], id);
assert.ok(!/NaN/.test(dupes), "coincident samples must not produce NaN: " + dupes);
assert.ok(!/Infinity/.test(dupes), "…nor Infinity");

// `mapPt` is applied to every point, not just the first — the caller uses it
// to project image px into container px, and a missed point would land the
// curve in the wrong space entirely.
const scaled = parse(pathD([[0, 0], [10, 0], [20, 0]], (p) => ({ x: p[0] * 3, y: p[1] * 3 + 5 })));
assert.deepStrictEqual(scaled.start, [0, 5]);
assert.deepStrictEqual(scaled.segs[scaled.segs.length - 1].p1, [60, 5]);

console.log("marker spline: all checks passed");
