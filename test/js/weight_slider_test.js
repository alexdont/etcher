// Pins the weight sliders' scale.
//
// Weights are relative to the canvas now, and the ones people actually
// draw with land around 8 — which on the old linear 1..40 track sat in
// the first fifth, with four fifths of the travel spent on weights
// nobody picks. The sliders run 0-100 and curve onto the weight range,
// so the useful values spread across the middle: fine steps at the thin
// end where a hair matters, coarse ones at the heavy end where it does
// not, and the same ceiling still reachable.
//
//   node test/js/weight_slider_test.js

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

for (const name of ["WEIGHT_MIN", "WEIGHT_MAX", "WEIGHT_CURVE"]) {
  const m = src.match(new RegExp(`var ${name} = ([\\d.]+);`));
  assert.ok(m, `could not find ${name}`);
  global[name] = Number(m[1]);
}

const weightAt = extract("_weightFromSlider");
const posOf = extract("_sliderFromWeight");

// ── the ends are the ends ─────────────────────────────────────────────────

{
  assert.strictEqual(weightAt(0), WEIGHT_MIN, "the left end is the thinnest line");
  assert.strictEqual(weightAt(100), WEIGHT_MAX, "the right end is the heaviest");
  assert.strictEqual(posOf(WEIGHT_MIN), 0);
  assert.strictEqual(posOf(WEIGHT_MAX), 100);
}

// ── the weights people draw with sit in the middle of the track ───────────

{
  // The complaint: a normal-looking arrow is about 8, and that was a
  // fifth of the way along. It belongs near the middle.
  const at8 = posOf(8);
  assert.ok(at8 > 40 && at8 < 60,
    `a weight of 8 should sit mid-track, got ${at8}%`);
  assert.ok(posOf(4) > 25, "…and the thin working weights are not bunched at the start");

  // Half the travel is spent below ~10, which is where the work happens.
  assert.ok(weightAt(50) <= 10 && weightAt(50) >= 6,
    `the midpoint should be a working weight, got ${weightAt(50)}`);
}

// ── monotonic, and a round trip that holds ────────────────────────────────

{
  let prev = -1;
  for (let p = 0; p <= 100; p++) {
    const w = weightAt(p);
    assert.ok(w >= prev, "the track never goes backwards");
    assert.ok(w >= WEIGHT_MIN && w <= WEIGHT_MAX, "and never leaves the range");
    prev = w;
  }
  // Every weight the slider can produce maps back to a position that
  // produces it again — the handle never lands somewhere that renames
  // the value under it.
  const produced = new Set();
  for (let p = 0; p <= 100; p++) produced.add(weightAt(p));
  for (const w of produced) {
    assert.strictEqual(weightAt(posOf(w)), w,
      `weight ${w} did not survive the round trip`);
  }
}

// ── nonsense in, something sane out ───────────────────────────────────────

{
  assert.strictEqual(weightAt(-50), WEIGHT_MIN, "off the left end is the minimum");
  assert.strictEqual(weightAt(999), WEIGHT_MAX, "off the right end is the maximum");
  assert.strictEqual(weightAt("nope"), WEIGHT_MIN);
  assert.strictEqual(weightAt(undefined), WEIGHT_MIN);
  // A stored weight past the ceiling pins the handle rather than losing it.
  assert.strictEqual(posOf(500), 100);
  assert.strictEqual(posOf(-3), 0);
  assert.strictEqual(posOf("nope"), 0);
}

// ── both sliders are wired to it ──────────────────────────────────────────

{
  for (const [row, setter] of [
    ["Weight", "_setMarkerStyleProp"],
    ["Thickness", "_setLineParam"],
  ]) {
    const at = src.indexOf(`var w = sliderRow("${row}");`);
    assert.notStrictEqual(at, -1, `could not find the ${row} row`);
    const body = src.slice(at, at + 700);
    assert.ok(body.includes('w.input.min = "0"; w.input.max = "100";'),
      `${row} must travel the curve's own 0-100, not the weight range`);
    assert.ok(body.includes("self._weightFromSlider(w.input.value)"),
      `${row} must convert its position into a weight`);
    assert.ok(body.includes(`self.${setter}(`), `${row} still writes through ${setter}`);
  }
  // …and both readbacks put the handle where the stored weight belongs.
  assert.ok(src.includes("this._markerWeightInput.value = this._sliderFromWeight(width);"));
  assert.ok(src.includes("this._paramsWeightInput.value = this._sliderFromWeight(width);"));
}

console.log("weight slider: all checks passed");
