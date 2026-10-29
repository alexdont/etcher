// Pins how big a pasted / dropped / inserted image is drawn: a share of what
// the person can SEE, not a fixed number of canvas units.
//
// It was a fixed cap of 800 canvas units and never an enlargement, which on a
// 12000-wide board at its default zoom is about ninety screen pixels — so every
// paste had to be resized by hand before it could be used.
//
//   node test/js/inserted_image_size_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

function body(name) {
  const start = src.indexOf(`    ${name}: function(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n    },", start);
  return "(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")";
}
// The constants the extracted functions close over, read from the source itself.
const INSERT_VIEW_SHARE = +/var INSERT_VIEW_SHARE = ([\d.]+);/.exec(src)[1];
const INSERT_FALLBACK_MAX_SIDE = +/var INSERT_FALLBACK_MAX_SIDE = (\d+);/.exec(src)[1];
const share = INSERT_VIEW_SHARE;
const fallback = INSERT_FALLBACK_MAX_SIDE;
const visibleSpan = eval(body("_visibleSpan"));
const insertedSize = (ctx, w, h, max) => eval(body("_insertedImageSize")).call(ctx, w, h, max);

// A viewport `screenW` x `screenH` showing a canvas at `zoom` screen px per unit.
function layer({ screenW = 1400, screenH = 700, zoom = 1, canvas = { x: 12000, y: 8000 }, ox = 0, oy = 0 } = {}) {
  const ctx = {
    imageSize: canvas,
    handle: {
      container: { getBoundingClientRect: () => ({ left: 0, top: 0, right: screenW, bottom: screenH, width: screenW, height: screenH }) },
      screenToImage: (p) => ({ x: ox + p.x / zoom, y: oy + p.y / zoom }),
    },
  };
  ctx._visibleSpan = () => visibleSpan.call(ctx);
  return ctx;
}

// The complaint: the board at its default zoom (whole 12000 x 8000 fitted to the
// screen), a small screenshot. It must come out a decent share of the screen.
{
  const zoom = 1400 / 12000; // ~0.117 screen px per unit
  const ctx = layer({ screenW: 1400, screenH: 933, zoom });
  const { w, h } = insertedSize(ctx, 320, 200, null);
  const onScreen = { w: w * zoom, h: h * zoom };
  assert.ok(onScreen.w >= 600, `a small picture is ${Math.round(onScreen.w)}px wide on screen — still a speck`);
  assert.ok(onScreen.w <= 1400 * share + 2 && onScreen.h <= 933 * share + 2, "and not more than its share of the view");
  assert.strictEqual(Math.round((w / h) * 100), 160, "proportions are kept");
}

// A huge picture is brought down to the same share, not placed at its own size.
{
  const zoom = 1400 / 12000;
  const { w, h } = insertedSize(layer({ screenH: 933, zoom }), 6000, 4000, null);
  assert.ok(w * zoom <= 1400 * share + 2 && h * zoom <= 933 * share + 2, "a big picture fits too");
  assert.ok(w * zoom >= 1400 * share * 0.9 || h * zoom >= 933 * share * 0.9, "and fills the share");
}

// Zoomed in, the same picture is smaller in canvas units — what matters is the view.
{
  const wide = insertedSize(layer({ zoom: 0.117 }), 800, 600, null);
  const near = insertedSize(layer({ zoom: 1 }), 800, 600, null);
  assert.ok(near.w < wide.w, "zoomed in, the picture is smaller in canvas units");
  const onScreen = (s, z) => s.w * z;
  assert.ok(Math.abs(onScreen(near, 1) - onScreen(wide, 0.117)) < 40, "but about as big on screen");
}

// Zooming out past the edge of the board does not make the view (or the picture) bigger than the board.
{
  const ctx = layer({ screenW: 1400, screenH: 933, zoom: 0.02 }); // sees 70000 units; board is 12000
  assert.deepStrictEqual(visibleSpan.call(ctx), { w: 12000, h: 8000 });
  const { w, h } = insertedSize(ctx, 320, 200, null);
  assert.ok(w <= 12000 * share + 1 && h <= 8000 * share + 1, "capped by the board");
}

// An explicit maxSide keeps the old rule: shrink to fit, never enlarge.
{
  const ctx = layer();
  assert.deepStrictEqual(insertedSize(ctx, 3000, 1500, 1200), { w: 1200, h: 600 });
  assert.deepStrictEqual(insertedSize(ctx, 300, 200, 1200), { w: 300, h: 200 }, "never enlarged");
}

// Nothing to measure (no handle yet): the old fallback, and sizes it cannot know get a default.
{
  const bare = { _visibleSpan: () => null };
  assert.deepStrictEqual(insertedSize(bare, 1600, 800, null), { w: fallback, h: fallback / 2 });
  assert.deepStrictEqual(insertedSize(bare, 0, 0, null), { w: 400, h: 300 }, "an undecodable picture still gets a shape");
  assert.strictEqual(visibleSpan.call({ handle: null }), null);
  assert.strictEqual(visibleSpan.call({ handle: { container: { getBoundingClientRect: () => ({ width: 0, height: 0 }) }, screenToImage: () => ({ x: 0, y: 0 }) } }), null);
}

// Both ways in apply it: the one that measures for itself, and the file path that hands a size in.
assert.ok(src.includes("self._insertedImageSize(natW, natH, maxSide)"), "_insertImageHref sizes through the helper");
assert.ok(src.includes("var size = self._insertedImageSize(natW, natH, null);"), "_insertImageFile sizes through the helper");
assert.ok(src.includes("return place(opts.width, opts.height, true);"), "an explicit size is used as given, not fitted twice");
assert.ok(!/Math\.min\(1, 800 \/ Math\.max\(natW/.test(src), "the fixed 800 cap is gone from the file path");

console.log("inserted image size: ok");
