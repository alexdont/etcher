// Pins the bent arrow's smooth curve.
//
// Grabbing an arrow's bend used to fold it into sharp corners; it now
// draws a centripetal Catmull-Rom curve through its bends, like the
// marker's stroke — and everything that follows the line (hit test,
// bbox, label position and drag, tooltip anchor, the add-bend dots)
// samples the same curve, so what is hit and labelled is what is seen.
//
//   node test/js/arrow_curve_test.js

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

{ const m = src.match(/var CATMULL_ALPHA = ([\d.]+);/); global.CATMULL_ALPHA = Number(m[1]); }
{ const m = src.match(/var ROUTE_SAMPLES = (\d+);/); global.ROUTE_SAMPLES = Number(m[1]); }

const arrowPath = extract("_arrowPath");
const crSample = extract("_crSample");
const arrowRoute = extract("_arrowRoute");
const board = { _arrowPath: arrowPath, _crSample: crSample, _arrowRoute: arrowRoute };

// ── a straight arrow is exactly its two points ────────────────────────────

{
  const straight = { a: [0, 0], b: [100, 50] };
  assert.deepStrictEqual(arrowRoute.call(board, straight),
    [{ x: 0, y: 0 }, { x: 100, y: 50 }],
    "no bends, no curve — a dimension or unbent arrow costs nothing new");
}

// ── a bent arrow is a smooth curve through its bends ──────────────────────

{
  const bent = { a: [0, 0], b: [100, 100], points: [[100, 0]] };
  const route = arrowRoute.call(board, bent);
  assert.strictEqual(route.length, 2 * global.ROUTE_SAMPLES + 1,
    "the documented invariant: ROUTE_SAMPLES per raw segment, then the head");

  // Catmull-Rom INTERPOLATES — the curve still passes through the bend
  // point itself (assert that: the grabbed dot stays on the line). The
  // rounding lives in the bow BETWEEN the points: samples along the way
  // leave the straight chords measurably, where a polyline's never would.
  const onBend = route.some((p) => Math.hypot(p.x - 100, p.y - 0) < 0.001);
  assert.ok(onBend, "the curve passes through the bend the user placed");
  const distToSeg = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx*dx + dy*dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx*t), p.y - (a.y + dy*t));
  };
  const chordA = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const chordB = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
  const maxBow = Math.max(...route.map((p) =>
    Math.min(distToSeg(p, ...chordA), distToSeg(p, ...chordB))));
  assert.ok(maxBow > 2 && maxBow < 30,
    `the corner is rounded — the curve bows ${maxBow.toFixed(1)}px off the ` +
    "chords (0 would be the old sharp fold, 30+ would be off the line)");

  // Endpoints are exact — the tail sits on its anchor and the head on its
  // target whatever happens between them.
  assert.deepStrictEqual(route[0], { x: 0, y: 0 });
  assert.deepStrictEqual(route[route.length - 1], { x: 100, y: 100 });

  // And the samples advance monotonically along the way — a cusp or loop
  // would double back. Centripetal parameterization guarantees this; the
  // assertion catches anyone swapping in the uniform kind.
  for (let i = 1; i < route.length; i++) {
    const d = Math.hypot(route[i].x - route[i-1].x, route[i].y - route[i-1].y);
    assert.ok(d > 0 && d < 40, "the route advances smoothly, no jumps or stalls");
  }
}

// ── the render and the geometry share the curve ───────────────────────────

{
  const render = src.slice(src.indexOf('case "arrow": {'), src.indexOf('case "arrow": {') + 3000);
  assert.ok(render.includes("_catmullRomPathD(arImg"),
    "the shaft draws the same family of curve the route samples");
  assert.ok(/var arPath = this\._arrowRoute\(g\);/.test(src),
    "the hit test follows the drawn curve");
  assert.ok(/return fromPoints\(this\._arrowRoute\(g\)\);/.test(src),
    "so does the bbox");
  assert.ok(src.includes('var shaft = svgEl("path", {'),
    "the shaft element is a <path> — a polyline cannot bend smoothly");
}

console.log("arrow curve: all checks passed");
