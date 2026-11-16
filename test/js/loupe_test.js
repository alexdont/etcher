// The placing loupe: hold a dragged point still and a magnified view of
// what is under it comes up above the pointer, with a crosshair on the spot
// the point will land. Pins the dwell (still for long enough, measured in
// screen px with more slack for a finger), that it follows once up, that any
// release takes it down, and where it is drawn.
//
//   node test/js/loupe_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  return eval("(" + src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") + ")");
}
function constant(name) {
  const m = src.match(new RegExp("var " + name + " = (\\d+);"));
  assert.ok(m, "could not find " + name);
  return Number(m[1]);
}
const C = {};
["LOUPE_DWELL_MS", "LOUPE_STILL", "LOUPE_STILL_TOUCH", "LOUPE_SIZE", "LOUPE_ZOOM"].forEach((n) => { C[n] = global[n] = constant(n); });
assert.ok(C.LOUPE_STILL_TOUCH > C.LOUPE_STILL, "a finger gets more slack than a mouse");

// ---- a fake clock and a fake DOM, just enough for the loupe ------------------
let now = 0, timers = [], frames = [];
global.setTimeout = (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; };
global.clearTimeout = (t) => { timers = timers.filter((x) => x !== t); };
global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
global.cancelAnimationFrame = () => {};
function tick(ms) {
  now += ms;
  timers.filter((t) => t.at <= now).forEach((t) => { timers = timers.filter((x) => x !== t); t.fn(); });
}
function flushFrames() { const f = frames; frames = []; f.forEach((fn) => fn()); }

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.style = {}; this.attrs = {};
    const set = new Set();
    this.classList = { add: (...c) => c.forEach((x) => set.add(x)), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
    Object.defineProperty(this, "className", { get: () => [...set].join(" "), set: (v) => { set.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => set.add(x)); } });
  }
  setAttribute(k, v) { this.attrs[k] = v; if (k === "class") this.className = v; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); n.parentNode = this; this.children[i] = n; o.parentNode = null; return o; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  querySelectorAll() { return []; }
  cloneNode() { const c = new El(this.tagName); c.className = this.className; c.cloned = true; return c; }
}
const docListeners = {};
global.document = {
  createElement: (t) => new El(t),
  createElementNS: (_, t) => new El(t),
  addEventListener: (n, fn) => { (docListeners[n] = docListeners[n] || []).push(fn); },
  removeEventListener: (n, fn) => { docListeners[n] = (docListeners[n] || []).filter((f) => f !== fn); }
};
function fire(name) { (docListeners[name] || []).slice().forEach((fn) => fn({})); }

function layer(opts) {
  const root = new El("div");
  root.className = "fresco-viewer fresco--ready";
  root.clientWidth = 1000; root.clientHeight = 700;
  root.getBoundingClientRect = () => ({ left: 100, top: 50 });
  const stage = new El("div"); stage.className = "fresco-stage";
  const overlay = new El("div"); overlay.className = "etcher-overlay";
  const nav = new El("div"); nav.className = "fresco-nav";
  [stage, overlay, nav].forEach((c) => root.appendChild(c));
  const L = {
    _loupeOn: !(opts && opts.off), handle: { container: root },
    _loupeTrack: extract("_loupeTrack"), _loupeEnd: extract("_loupeEnd"),
    _loupeSchedule: extract("_loupeSchedule"), _loupeRender: extract("_loupeRender")
  };
  return { L, root };
}
const move = (x, y, type) => ({ clientX: x, clientY: y, pointerType: type || "mouse" });
const lens = (root) => root.children.find((c) => c.classList.contains("etcher-loupe"));

// ---- off ---------------------------------------------------------------------
{
  const { L, root } = layer({ off: true });
  L._loupeTrack(move(400, 300));
  tick(C.LOUPE_DWELL_MS * 2);
  assert.strictEqual(L._loupe, undefined, "loupe={false}: nothing tracked");
  assert.strictEqual(lens(root), undefined);
}

// ---- dwell: still for long enough brings it up --------------------------------
{
  const { L, root } = layer();
  L._loupeTrack(move(400, 300));
  tick(C.LOUPE_DWELL_MS - 1);
  assert.strictEqual(lens(root), undefined, "not before the dwell");
  L._loupeTrack(move(400 + C.LOUPE_STILL - 1, 300)); // jitter inside the slack
  tick(1);
  const el = lens(root);
  assert.ok(el, "up after the dwell, jitter and all");
  assert.strictEqual(el.attrs["aria-hidden"], "true");
  assert.ok(el.children.some((c) => c.classList.contains("etcher-loupe-cross")), "crosshair drawn");

  // The copy: stage and overlay, not the nav; the pointer in the centre.
  const view = el.children.find((c) => c.classList.contains("etcher-loupe-view"));
  assert.deepStrictEqual(view.children.map((c) => c.className), ["fresco-stage", "etcher-overlay"]);
  assert.ok(view.classList.contains("fresco-viewer"), "carries the root's classes for scoped CSS");
  const px = 400 + C.LOUPE_STILL - 1 - 100, py = 300 - 50, D = C.LOUPE_SIZE, Z = C.LOUPE_ZOOM;
  assert.strictEqual(view.style.transform, `translate(${D / 2 - px * Z}px,${D / 2 - py * Z}px) scale(${Z})`);
  assert.strictEqual(view.style.width, "1000px");

  // Above the pointer, centred on it.
  assert.strictEqual(el.style.left, (px - D / 2) + "px");
  assert.strictEqual(el.style.top, (py - 24 - D) + "px", "mouse: just above the cursor");

  flushFrames();
  assert.ok(el.classList.contains("is-open"), "opens on the next frame (so it animates in)");

  // Follows once up, one render per frame.
  L._loupeTrack(move(700, 400));
  L._loupeTrack(move(710, 410));
  assert.strictEqual(frames.length, 1, "moves coalesce into one frame");
  flushFrames();
  assert.strictEqual(lens(root).style.left, (710 - 100 - D / 2) + "px", "follows the drag");

  // Any release takes it down, and the backstop listeners go with it.
  fire("pointerup");
  assert.strictEqual(lens(root), undefined, "gone on release");
  assert.strictEqual(L._loupe, null);
  assert.strictEqual((docListeners.pointerup || []).length, 0, "listeners removed");
}

// ---- moving restarts the wait ---------------------------------------------------
{
  const { L, root } = layer();
  L._loupeTrack(move(400, 300));
  tick(C.LOUPE_DWELL_MS - 100);
  L._loupeTrack(move(400 + C.LOUPE_STILL + 2, 300)); // a real move
  tick(150);
  assert.strictEqual(lens(root), undefined, "a move restarts the dwell");
  tick(C.LOUPE_DWELL_MS);
  assert.ok(lens(root), "then still again → up");
  L._loupeEnd();
}

// ---- a finger: more slack, and the lens clears the fingertip --------------------
{
  const { L, root } = layer();
  L._loupeTrack(move(400, 300, "touch"));
  tick(300);
  L._loupeTrack(move(400 + C.LOUPE_STILL_TOUCH - 1, 300, "touch"));
  tick(C.LOUPE_DWELL_MS - 300);
  const el = lens(root);
  assert.ok(el, "finger jitter within the touch slack still counts as holding");
  const py = 300 - 50;
  assert.ok(py - (parseFloat(el.style.top) + C.LOUPE_SIZE) >= 60, "lens sits well above the fingertip");
  fire("pointercancel");
  assert.strictEqual(lens(root), undefined, "pointercancel ends it too");
}

// ---- edges: flips below near the top, kept inside sideways -----------------------
{
  const { L, root } = layer();
  L._loupeTrack(move(105, 80)); // container (5, 30): no room above, at the left edge
  tick(C.LOUPE_DWELL_MS);
  const el = lens(root);
  assert.strictEqual(el.style.top, (30 + 24) + "px", "below the pointer when there is no room above");
  assert.strictEqual(el.style.left, "4px", "clamped inside on the left");
  L._loupeEnd();
  L._loupeTrack(move(100 + 998, 400));
  tick(C.LOUPE_DWELL_MS);
  assert.strictEqual(lens(root).style.left, (1000 - C.LOUPE_SIZE - 4) + "px", "clamped inside on the right");
  L._loupeEnd();
}

// ---- a timer that fires after the release does nothing --------------------------
{
  const { L, root } = layer();
  L._loupeTrack(move(400, 300));
  L._loupeEnd();
  tick(C.LOUPE_DWELL_MS * 2);
  assert.strictEqual(lens(root), undefined, "no loupe after an early release");
}

// ---- wiring: which drags feed it ------------------------------------------------
assert.ok(/self\._loupeTrack\(ev\);\n      \}\n      function onUp\(ev\) \{\n        handleEl\.classList\.remove\("is-dragging"\);[\s\S]{0,400}self\._loupeEnd\(\);/.test(src),
  "a handle drag feeds the loupe and its release ends it");
assert.ok(/LOUPE_KINDS = \{ dimension: true, line: true, arrow: true, rectangle: true, circle: true \}/.test(src), "draft kinds");
assert.ok(/\(e\.buttons & 1\) && LOUPE_KINDS\[this\.draftState\.kind\]\) this\._loupeTrack\(e\)/.test(src), "only a pressed draft");
assert.ok(/_onPointerUp: function\(e\) \{\n      if \(this\._loupe\) this\._loupeEnd\(\);/.test(src), "a draft's release ends it");
assert.ok(/destroyed: function\(\) \{\n      this\._loupeEnd\(\);/.test(src), "unmount ends it");
assert.ok(/self\._loupeOn = self\.el\.dataset\.loupe !== "false";/.test(src), "data-loupe=false turns it off");

console.log("loupe_test: ok");
