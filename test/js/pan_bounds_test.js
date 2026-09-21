// Pins the pan bounds following the ink.
//
// Fresco clamps panning to the canvas, so a stroke drawn above a wide
// image was visible at fit zoom and unreachable zoomed in. Whenever
// annotations change, etcher hands Fresco pan bounds covering the union
// of the canvas and everything drawn, and hands the clamp back when the
// last outside shape goes.
//
// The reach is the same on both sides of each axis — the worst spill on
// that axis, mirrored — so the rect stays centred on the picture. Fresco
// clamps to these bounds while the content is pannable and centres the
// PICTURE below that, so bounds that leaned to one side put the two
// rules' answers in different places: zooming through the crossover, the
// board jumped ~200px sideways and back.
//
//   node test/js/pan_bounds_test.js

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

{ const m = src.match(/var PAN_BOUNDS_PAD = (\d+);/);
  assert.ok(m, "could not find PAN_BOUNDS_PAD");
  global.PAN_BOUNDS_PAD = Number(m[1]); }
const PAD = global.PAN_BOUNDS_PAD;

const syncPanBounds = extract("_syncPanBounds");

function board(shapes) {
  const calls = [];
  return {
    calls,
    handleKind: "canvas",
    shapes,
    _shapeBBoxImagePx: (s) => s.bbox || null,
    handle: {
      getCanvasSize: () => ({ width: 1000, height: 600 }),
      setPanBounds: (r) => calls.push(r),
      isInfiniteCanvas: () => false,
      container: { getBoundingClientRect: () => ({ width: 800, height: 500 }) },
      floors: [],
      hostFloor: null,
      getZoomFloor() { return this.hostFloor; },
      setZoomFloor(v) { this.floors.push(v); },
    },
  };
}

// ── ink above the picture opens the pan upward — and as far down ──────────

{
  const b = board([{ bbox: { x: 200, y: -150, w: 300, h: 100 } }]);
  syncPanBounds.call(b);
  assert.strictEqual(b.calls.length, 1);
  const r = b.calls[0];
  assert.strictEqual(r.y, -150 - PAD, "up: past the stroke plus breathing room");
  assert.strictEqual(r.y + r.height, 600 + 150 + PAD,
    "and the same reach below, which nothing needs — except that it " +
    "keeps the rect centred on the picture, and the pan smooth");
  assert.ok(r.x === 0, "the other axis is untouched — nothing spilled there");
  assert.strictEqual(r.x + r.width, 1000, "on either side of it");
}

// ── each AXIS opens to its worst spill ────────────────────────────────────

{
  const b = board([
    { bbox: { x: -80, y: 100, w: 60, h: 60 } },     // left
    { bbox: { x: 990, y: 100, w: 120, h: 60 } },    // right, further out
  ]);
  syncPanBounds.call(b);
  const r = b.calls[0];
  const reach = 110 + PAD;  // the right-hand ink, 110px past the edge
  assert.strictEqual(r.x, -reach, "left opens to the worse of the two");
  assert.strictEqual(r.x + r.width, 1000 + reach, "and the right to match");
  assert.ok(r.x + r.width / 2 === 500,
    "so the rect is still centred on the picture it surrounds");
  assert.ok(r.y === 0, "the untouched axis stays stock");
  assert.strictEqual(r.y + r.height, 600, "top and bottom both");
}

// ── labels parked outside count too ───────────────────────────────────────

{
  const b = board([{
    bbox: { x: 100, y: 100, w: 50, h: 50 },
    _renderedTitleImage: { x: 400, y: 650, w: 120, h: 40 },
  }]);
  syncPanBounds.call(b);
  const r = b.calls[0];
  assert.strictEqual(r.y + r.height, 650 + 40 + PAD,
    "a label dragged below the picture is reachable like any stroke");
  assert.strictEqual(r.y, -(650 + 40 - 600 + PAD), "mirrored, as ever");
}

// ── everything inside: the stock clamp comes back, once ───────────────────

{
  const b = board([{ bbox: { x: 10, y: 10, w: 100, h: 100 } }]);
  syncPanBounds.call(b);
  assert.strictEqual(b.calls.length, 0,
    "nothing spills, nothing is touched — a host's own setPanBounds is " +
    "never clobbered by a board that never loosened it");

  // Now spill, then delete: loosen, then hand back exactly once.
  b.shapes.push({ bbox: { x: -200, y: 0, w: 50, h: 50 } });
  syncPanBounds.call(b);
  assert.ok(b.calls.length === 1 && b.calls[0].x < 0, "loosened");
  b.shapes.pop();
  syncPanBounds.call(b);
  assert.strictEqual(b.calls[1], null, "…and handed back (null) on the way in");
  syncPanBounds.call(b);
  assert.strictEqual(b.calls.length, 2, "but only once — not on every sync");
}

// ── wired to every way shapes change ──────────────────────────────────────

{
  for (const [site, why] of [
    ["this._syncPanBounds();\n      if (!this.pushEventTo) return;",
     "every local edit (before the host guard — bounds matter without a host)"],
    ["self._syncPanBounds();\n\n      // If any pre-0.4.7 canvas shapes",
     "initial hydration — outside ink must be reachable from the first frame"],
  ]) {
    assert.ok(src.includes(site), `not wired: ${why}`);
  }
  const rehydrate = src.slice(src.indexOf("_rehydrateFromExtension: function"),
                              src.indexOf("_rehydrateFromExtension: function") + 4000);
  assert.ok(rehydrate.includes("this._syncPanBounds();"), "…and re-hydration");
  const undo = src.slice(src.indexOf("_applyHistorySnapshot: function"),
                         src.indexOf("_applyHistorySnapshot: function") + 3000);
  assert.ok(undo.includes("this._syncPanBounds();"), "…and undo/redo");
}

// ── the zoom floor drops to fit ALL the content ───────────────────────────

{
  // Panning could reach the ink; zooming out still stopped at the
  // picture. With spill, the floor drops to where the whole content rect
  // fits the viewport — all four ratios, so it holds under rotation.
  const b = board([{ bbox: { x: 200, y: -400, w: 300, h: 100 } }]);
  syncPanBounds.call(b);
  const r = b.calls[0];
  const expected = Math.min(800 / r.width, 500 / r.height,
                            800 / r.height, 500 / r.width);
  assert.strictEqual(b.handle.floors.length, 1, "the floor moved with the bounds");
  assert.ok(Math.abs(b.handle.floors[0] - expected) < 1e-9,
    "…to exactly where everything fits at once");

  // Un-spill: the HOST'S floor comes back, not a blind null.
  b.handle.hostFloor = 0.4; // pretend the host had one when we first lowered
  // (captured at first lowering — so re-run the cycle from scratch)
  const b2 = board([{ bbox: { x: 200, y: -400, w: 300, h: 100 } }]);
  b2.handle.hostFloor = 0.4;
  syncPanBounds.call(b2);
  b2.shapes.length = 0;
  syncPanBounds.call(b2);
  assert.deepStrictEqual(b2.handle.floors[b2.handle.floors.length - 1], 0.4,
    "the floor the host configured survives our borrowing of it");
}

// ── infinite canvases are left free ───────────────────────────────────────

{
  // No clamp exists there to loosen; setting bounds would ADD one,
  // fencing a free board the moment a shape strayed. An old handle that
  // cannot say which it is gets the same caution.
  const b = board([{ bbox: { x: -500, y: 0, w: 50, h: 50 } }]);
  b.handle.isInfiniteCanvas = () => true;
  syncPanBounds.call(b);
  assert.strictEqual(b.calls.length, 0, "an infinite canvas is never fenced");

  const old = board([{ bbox: { x: -500, y: 0, w: 50, h: 50 } }]);
  delete old.handle.isInfiniteCanvas;
  syncPanBounds.call(old);
  assert.strictEqual(old.calls.length, 0,
    "a handle that cannot answer is treated as unfenceable");
}

// ── the fresco handles etcher actually receives can all answer ────────────

{
  // The guard above treats a handle that cannot answer isInfiniteCanvas
  // as untouchable — correct caution, but it silently disabled the whole
  // feature on the canvas-board surface, whose OUTER handle forwarded
  // setPanBounds and getCanvasSize but not the probe (the same trap
  // zoomAt fell into once). Pin the forward in fresco itself, so a
  // handle-layer refactor there fails HERE, where the consequence lives.
  const frescoPath = path.join(__dirname, "..", "..", "..", "fresco",
    "priv", "static", "fresco.js");
  if (fs.existsSync(frescoPath)) {
    const fresco = fs.readFileSync(frescoPath, "utf8");
    const outer = fresco.slice(fresco.indexOf("setPanBounds:   function(b)"));
    assert.ok(outer.includes("isInfiniteCanvas: function() { return controller.isInfiniteCanvas(); }"),
      "fresco's outer handle must forward isInfiniteCanvas alongside " +
      "setPanBounds, or every surface it serves loses out-of-picture pan");
  }
}

console.log("pan bounds: all checks passed");
