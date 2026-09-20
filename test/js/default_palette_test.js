// Pins the five colours a new user starts with.
//
// They were pastels — Tailwind's 300s, which look calm in a panel and
// washed out on a photograph. A thin outline in one of them against a
// light background is close to invisible, which is the same complaint the
// marker was given ink colours of its own to answer. The head dev's
// clients did not like them; strong hues now, from the family the marker
// already draws in.
//
// This does not pin the exact hexes — taste changes, and a consumer can
// replace the whole set anyway. It pins what the set has to BE: strong
// enough to see over a picture, and far enough apart to tell one slot from
// another at swatch size.
//
//   node test/js/default_palette_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

const swatches = (() => {
  const m = src.match(/var DEFAULT_COLOR_SWATCHES = \[([\s\S]*?)\];/);
  assert.ok(m, "could not read DEFAULT_COLOR_SWATCHES");
  return (m[1].match(/\{[^}]*\}/g) || []).map((row) => ({
    key: /key:\s*"([a-z]+)"/.exec(row)[1],
    color: /color:\s*"(#[0-9a-f]{6})"/i.exec(row)[1].toLowerCase(),
  }));
})();

const SLOTS = (() => {
  const m = src.match(/var COLOR_SLOTS = (\d+);/);
  assert.ok(m, "could not read COLOR_SLOTS");
  return +m[1];
})();

// sRGB → HSL, and the relative luminance the WCAG contrast ratio uses.
function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function hsl(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s, l };
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── the shape of the set ─────────────────────────────────────────────────

{
  assert.ok(swatches.length >= SLOTS,
    `the palette has to fill all ${SLOTS} slots on its own`);
  assert.deepStrictEqual(
    swatches.slice(-2).map((s) => s.key), ["white", "black"],
    "the monochrome bookends close the set, after the hues");
  assert.strictEqual(new Set(swatches.map((s) => s.color)).size, swatches.length,
    "two swatches the same colour are one swatch and a dead slot");
}

// The five that become the starting slots.
const starters = swatches.slice(0, SLOTS);

// ── each one carries over a photograph ───────────────────────────────────

{
  // The pastels sat around 80% lightness, which is what made a stroke in
  // one disappear against anything pale. Nothing here is that washed out,
  // and every hue is actually saturated rather than tinted grey.
  for (const { key, color } of starters) {
    const { s, l } = hsl(color);
    assert.ok(l <= 0.7,
      `"${key}" (${color}) is too light at ${(l * 100).toFixed(0)}% — this is the ` +
      "pastel problem: a thin outline in it vanishes on a light picture");
    assert.ok(s >= 0.6,
      `"${key}" (${color}) is only ${(s * 100).toFixed(0)}% saturated; a muted ` +
      "colour reads as a mistake rather than as a choice");
  }
}

// ── and can be told from its neighbours in the row ───────────────────────

{
  // Five swatches sitting side by side, each a ~30px tile. Two that are
  // close in hue AND lightness are one usable colour between them.
  //
  // 20° is the bar. A seven-hue rainbow crowds its warm end by
  // construction — red, orange and yellow live inside 50° of each other —
  // so a stricter rule would not be measuring "can you tell these apart",
  // it would be banning orange. What it does still catch is the real
  // mistake: two shades of the same hue in the starting five, which is a
  // slot the user cannot use for anything.
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) {
      const a = starters[i], b = starters[j];
      const da = hsl(a.color), db = hsl(b.color);
      const dh = Math.min(Math.abs(da.h - db.h), 360 - Math.abs(da.h - db.h));
      const dl = Math.abs(da.l - db.l);
      assert.ok(dh >= 20 || dl >= 0.2,
        `"${a.key}" (${a.color}) and "${b.key}" (${b.color}) are ${dh.toFixed(0)}° ` +
        `apart at ${(dl * 100).toFixed(0)}% lightness difference — too close to ` +
        "pick between at swatch size");
    }
  }
}

// ── the default draw colour comes out of the set ─────────────────────────

{
  // `resolveDefaultColor` prefers the blue; it must still be there, and it
  // must be the strong one now, not a pastel left behind by the change.
  const blue = swatches.find((s) => s.key === "blue");
  assert.ok(blue, "resolveDefaultColor looks for a blue swatch by key");
  assert.ok(hsl(blue.color).l <= 0.7,
    "the colour a first-time user draws in cannot be the washed-out one");
  assert.ok(contrast(blue.color, "#ffffff") >= 3,
    `the default (${blue.color}) has to stand off a white background`);
}

// ── it agrees with the pen ───────────────────────────────────────────────

{
  // The marker was given its own set because the shapes' pastels were the
  // wrong thing to write with. Now that the shapes are strong too, a
  // rectangle and a scribble around the same thing should not clash: the
  // shared reds, greens and blues are the same family.
  const marker = (() => {
    const m = src.match(/var MARKER_DEFAULT_SLOTS =\s*\[([^\]]*)\]/);
    assert.ok(m, "could not read MARKER_DEFAULT_SLOTS");
    return (m[1].match(/#[0-9a-f]{6}/gi) || []).map((c) => c.toLowerCase());
  })();

  for (const key of ["red", "green", "blue"]) {
    const mine = swatches.find((s) => s.key === key).color;
    const near = marker.some((c) => {
      const a = hsl(mine), b = hsl(c);
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
      return dh < 25 && Math.abs(a.l - b.l) < 0.2;
    });
    assert.ok(near,
      `the shapes' "${key}" (${mine}) has no counterpart in the pen's set — ` +
      "drawing a box and scribbling beside it should not clash");
  }
}

console.log("default palette: all checks passed");
