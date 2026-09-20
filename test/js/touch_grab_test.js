// Pins the finger-sized half of an edit handle.
//
// A handle dot is 5px. That is a fine target for a mouse and an unfair one
// for a fingertip, which needs something closer to 44px — so each dot is
// paired with an invisible disc that takes the press for it. The dot does
// NOT grow: a row of 44px blobs over the drawing you are editing is worse
// than the problem it solves.
//
// The same pairing the connector anchors already use, and the discs are
// inert unless the pointer is coarse, so nothing about a mouse changes.
//
//   node test/js/touch_grab_test.js

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

function constant(name) {
  const m = src.match(new RegExp(`var ${name} =\\s*([^;]+);`));
  assert.ok(m, `could not read ${name}`);
  return eval("(" + m[1] + ")");
}

const GRAB_R = constant("HANDLE_GRAB_RADIUS");
const GRAB_R_MIN = constant("HANDLE_GRAB_RADIUS_MIN");
global.HANDLE_GRAB_RADIUS = GRAB_R;
global.HANDLE_GRAB_RADIUS_MIN = GRAB_R_MIN;

// Minimal SVG element stand-ins.
function el(tag, attrs) {
  const node = {
    tagName: tag, attrs: Object.assign({}, attrs), children: [], listeners: {},
    classList: { _s: new Set(), add(...c) { c.forEach((x) => node.classList._s.add(x)); },
                 contains: (c) => node.classList._s.has(c) },
    setAttribute(k, v) { node.attrs[k] = v; },
    getAttribute(k) { return node.attrs[k] == null ? null : String(node.attrs[k]); },
    addEventListener(name, fn) { node.listeners[name] = fn; },
    parentNode: null,
  };
  return node;
}
function parent() {
  const p = { children: [], tagName: "g" };
  p.appendChild = (c) => { c.parentNode = p; p.children.push(c); return c; };
  p.insertBefore = (c, before) => {
    c.parentNode = p;
    p.children.splice(p.children.indexOf(before), 0, c);
    return c;
  };
  p.removeChild = (c) => { c.parentNode = null; p.children.splice(p.children.indexOf(c), 1); };
  return p;
}
global.svgEl = el;

const addGrabHalo = extract("_addGrabHalo");
const dropHandleEl = extract("_dropHandleEl");
const syncGrabRadii = extract("_syncGrabRadii");
const positionHandle = extract("_positionHandle");

// ── the pairing ──────────────────────────────────────────────────────────

{
  const svg = parent();
  const dot = svg.appendChild(el("circle", { r: 5 }));
  let grabbed = 0;
  const onDown = () => { grabbed++; };

  addGrabHalo.call({ svg }, dot, GRAB_R, onDown);
  const halo = dot._grab;

  assert.ok(halo, "the dot is paired with a disc");
  assert.strictEqual(+halo.getAttribute("r"), GRAB_R);
  assert.ok(halo.classList.contains("etcher-grab"));
  assert.strictEqual(+dot.getAttribute("r"), 5,
    "the DOT must not grow — that is the whole point of pairing");

  assert.strictEqual(svg.children.indexOf(halo), svg.children.indexOf(dot) - 1,
    "the disc goes UNDER its dot, so a precise pointer still lands on the dot");

  halo.listeners.pointerdown({});
  assert.strictEqual(grabbed, 1,
    "a grab through the disc starts the same drag the dot would — same handler, " +
    "so the dot still gets `.is-dragging` and the drag still knows its index");

  // Idempotent: re-rendering a handle must not stack discs on it.
  addGrabHalo.call({ svg }, dot, GRAB_R, onDown);
  assert.strictEqual(svg.children.filter((c) => c.classList.contains("etcher-grab")).length, 1);
}

// ── it follows its dot, and leaves with it ───────────────────────────────

{
  const svg = parent();
  const dot = svg.appendChild(el("circle", { r: 5 }));
  addGrabHalo.call({ svg }, dot, GRAB_R, null);

  positionHandle.call({ _imageToContainer: (p) => ({ x: p.x * 2, y: p.y * 2 }) },
                      dot, { x: 50, y: 30 });
  assert.strictEqual(+dot.getAttribute("cx"), 100);
  assert.strictEqual(+dot._grab.getAttribute("cx"), 100,
    "a disc left behind at the old spot is a grab zone over empty canvas");
  assert.strictEqual(+dot._grab.getAttribute("cy"), 60);

  dropHandleEl.call({}, dot);
  assert.strictEqual(svg.children.length, 0,
    "the disc goes with the dot — an orphan is invisible AND still takes presses");
  assert.strictEqual(dot._grab, null);
}

// ── sized against the nearest neighbour, not the shape ───────────────────

{
  // Half the closest gap: neighbouring zones meet without overlapping, so
  // the handle you are nearer to is the one you get.
  function zones(points) {
    const svg = parent();
    const dots = points.map((p) => {
      const d = svg.appendChild(el("circle", { r: 5 }));
      addGrabHalo.call({ svg }, d, GRAB_R, null);
      d._grab.setAttribute("cx", p[0]);
      d._grab.setAttribute("cy", p[1]);
      return d;
    });
    syncGrabRadii.apply({}, [dots]);
    return dots.map((d) => +d._grab.getAttribute("r"));
  }

  assert.deepStrictEqual(zones([[0, 0], [500, 0]]), [GRAB_R, GRAB_R],
    "handles far apart each get the full fingertip zone");

  // 30px apart → 15 each, which is under the cap and over the floor.
  assert.deepStrictEqual(zones([[0, 0], [30, 0]]), [15, 15]);

  // Crowded: clamped up to the floor rather than down to nothing, because a
  // 2px target is no target at all.
  assert.deepStrictEqual(zones([[0, 0], [4, 0]]), [GRAB_R_MIN, GRAB_R_MIN]);

  // One handle has no neighbour to crowd it.
  assert.deepStrictEqual(zones([[0, 0]]), [GRAB_R]);

  // The tightest pair sets the size for the whole group — a zone that
  // overlaps its neighbour steals presses meant for it.
  const three = zones([[0, 0], [20, 0], [400, 0]]);
  assert.deepStrictEqual(three, [10, 10, 10]);
}

{
  // Groups that compete for the same finger are sized together: a midpoint
  // sits between two corners, so sizing the two lists apart would let a
  // corner's zone swallow the midpoint next to it.
  const svg = parent();
  const mk = (x) => {
    const d = svg.appendChild(el("circle", { r: 5 }));
    addGrabHalo.call({ svg }, d, GRAB_R, null);
    d._grab.setAttribute("cx", x);
    d._grab.setAttribute("cy", 0);
    return d;
  };
  const corners = [mk(0), mk(60)];
  const midpoints = [mk(30)];
  syncGrabRadii.apply({}, [corners, midpoints]);
  assert.deepStrictEqual(
    corners.concat(midpoints).map((d) => +d._grab.getAttribute("r")), [15, 15, 15],
    "the corner-to-midpoint gap is what sets the size, not corner-to-corner");
}

// ── inert for a mouse ────────────────────────────────────────────────────

{
  const css = src.slice(src.indexOf('".etcher-grab {"'), src.indexOf('".etcher-grab {"') + 400);
  assert.ok(/pointer-events: none/.test(css),
    "on a fine pointer the dot IS the target; a 44px disc around each one " +
    "would swallow the shape underneath and the handle next door");
  assert.ok(/fill: transparent/.test(css) && /stroke: none/.test(css),
    "the disc is never seen");
  assert.ok(/@media \(pointer: coarse\)[\s\S]{0,120}pointer-events: all/.test(
              src.slice(src.indexOf('".etcher-grab {"'), src.indexOf('".etcher-grab {"') + 600)),
    "…and only a coarse pointer switches it on");
  assert.ok(src.includes('".etcher-handle, .etcher-handle-midpoint, .etcher-grab,"'),
    "the disc needs `touch-action: none` like the dots, or iOS claims the " +
    "drag as a scroll before the handler ever runs");
}

console.log("touch grab: all checks passed");
