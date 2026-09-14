// Pins that the scroll wheel still zooms while a drawing tool is held.
//
// Fresco bails out of its own wheel handler when the event comes from an
// element carrying `data-fresco-no-capture`. The drawing overlay carries
// it — that is how a press that draws doesn't also pan the canvas — but
// the attribute is read by the WHEEL handler too, and the wheel was never
// ours to claim. Arming a tool switches the overlay to `pointer-events:
// auto`, which makes it the target of scrolls as well as presses, so
// Fresco saw every scroll as coming from a no-capture overlay and zoom
// silently stopped working for as long as a tool was held.
//
// Panning kept working throughout (it is a drag, which the overlay does
// genuinely claim), which is what made this look like a quirk of drawing
// rather than a dead scroll wheel.
//
//   node test/js/wheel_zoom_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

// The overlay's wheel listener is built inline, so lift the handler out of
// the builder by running the registration against a stand-in element.
function wheelHandler(self) {
  const start = src.indexOf('      wrapper.addEventListener("wheel", function(e) {');
  assert.notStrictEqual(start, -1, "could not find the overlay's wheel listener");
  const end = src.indexOf("}, { passive: false });", start);
  assert.notStrictEqual(end, -1, "could not find the end of it");
  const body = src.slice(start, end + "}, { passive: false });".length);

  let captured = null;
  const wrapper = {
    addEventListener(name, fn, opts) {
      assert.strictEqual(name, "wheel");
      assert.deepStrictEqual(opts, { passive: false },
        "the listener must be non-passive, or preventDefault is ignored and " +
        "the page scrolls behind the zoom");
      captured = fn;
    },
  };
  eval("(function(wrapper, self){" + body + "})")(wrapper, self);
  return captured;
}

function board(over) {
  const dispatched = [];
  const zooms = [];
  const self = Object.assign({
    dispatched, zooms,
    handle: {
      container: { dispatchEvent: (ev) => dispatched.push(ev) },
      zoomIn: () => zooms.push("in"),
      zoomOut: () => zooms.push("out"),
    },
  }, over || {});
  return self;
}

// A stand-in for the browser's constructable WheelEvent.
class FakeWheelEvent {
  constructor(type, init) { Object.assign(this, { type }, init); }
}

function wheel(over) {
  let prevented = 0;
  return Object.assign({
    clientX: 140, clientY: 110, deltaY: -100,
    preventDefault() { prevented++; },
    get prevented() { return prevented; },
  }, over || {});
}

// ── a scroll over the drawing overlay reaches Fresco ──────────────────────

{
  global.WheelEvent = FakeWheelEvent;
  const self = board();
  const e = wheel();
  wheelHandler(self)(e);

  assert.strictEqual(self.dispatched.length, 1,
    "the scroll is handed back to Fresco's host");
  const ev = self.dispatched[0];
  assert.strictEqual(ev.type, "wheel");
  assert.strictEqual(ev.deltaY, e.deltaY, "carrying the scroll amount");
  assert.strictEqual(ev.clientX, e.clientX, "…and where it happened, so the");
  assert.strictEqual(ev.clientY, e.clientY, "   zoom anchors on the cursor");
  assert.strictEqual(ev.deltaMode, e.deltaMode,
    "…and its unit — a line-mode scroll means something different to a pixel one");
  assert.ok(e.prevented > 0,
    "the real event's default is prevented, or the page scrolls behind the zoom");

  // Not reimplemented. Fresco's handler anchors on the cursor, honours its
  // own gesture allowlist and cancels animations in flight; copying that
  // here would mean copying its rate too, and a zoom that drifts out of
  // step with the untooled one is worse than no zoom.
  assert.deepStrictEqual(self.zooms, [],
    "the handle's own zoom is not used when the event can be handed back");
}

{
  // No loop: the synthetic event must not bubble. This listener sits on a
  // DESCENDANT of the host, so a bubbling re-dispatch would be caught by
  // Fresco AND leave the door open to anything else listening up the tree.
  global.WheelEvent = FakeWheelEvent;
  const self = board();
  wheelHandler(self)(wheel());
  assert.strictEqual(self.dispatched[0].bubbles, false, "dispatched without bubbling");
  assert.strictEqual(self.dispatched[0].cancelable, true,
    "…but cancelable, since Fresco calls preventDefault on it");
}

// ── fallback when there is no constructable WheelEvent ────────────────────

{
  delete global.WheelEvent;
  const self = board();
  const e = wheel({ deltaY: -100 });
  wheelHandler(self)(e);
  assert.deepStrictEqual(self.dispatched, [], "nothing to dispatch with");
  assert.deepStrictEqual(self.zooms, ["in"], "so the handle's own zoom is used");
  assert.ok(e.prevented > 0);

  const out = board();
  wheelHandler(out)(wheel({ deltaY: 100 }));
  assert.deepStrictEqual(out.zooms, ["out"], "and the other direction");
}

// ── it stays out of the way when there is nothing to zoom ─────────────────

{
  // No handle, no container, no zoom API. None may throw, and none may
  // swallow the event — a host that scrolls its own container still needs
  // the scroll. (Strip mode has no overlay wrapper at all, so it never
  // reaches this, but a handle can arrive half-built.)
  delete global.WheelEvent;
  for (const broken of [
    { handle: null },
    { handle: {} },
    { handle: { container: { dispatchEvent: () => {} } } },
  ]) {
    const e = wheel();
    const self = board(broken);
    wheelHandler(self)(e);
    assert.strictEqual(e.prevented, 0,
      `an unzoomable host must let the scroll through untouched: ${JSON.stringify(Object.keys(broken.handle || {}))}`);
  }

  // A host object that cannot receive events — the case the dispatchEvent
  // guard exists for. Without it this throws on the way past, taking the
  // scroll with it.
  global.WheelEvent = FakeWheelEvent;
  const noDispatch = board({
    handle: { container: {}, zoomIn: () => {}, zoomOut: () => {} },
  });
  const e = wheel();
  assert.doesNotThrow(() => wheelHandler(noDispatch)(e),
    "a container that cannot receive events must not throw");
  assert.strictEqual(e.prevented, 0, "…and must not swallow the scroll either");
  delete global.WheelEvent;
}

// ── the attribute that caused it is still there ───────────────────────────
//
// Dropping `data-fresco-no-capture` would also "fix" the wheel — and break
// what it is actually for, which is stopping a press that draws from also
// panning the canvas underneath.
{
  const build = src.slice(src.indexOf('wrapper.setAttribute("data-fresco-no-capture", "");'),
                          src.indexOf('wrapper.addEventListener("pointerdown"'));
  assert.ok(build.includes('wrapper.setAttribute("data-fresco-no-capture", "");'),
    "the overlay still claims pointer input");
  assert.ok(build.includes('wrapper.addEventListener("wheel"'),
    "…and hands back the wheel it never meant to claim");
}

// The public handle really does not have `zoomAt` — the first attempt at
// this called it and silently did nothing, because the guard in front of it
// was never satisfied. Pinned so nobody reaches for it again.
{
  const frescoSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "fresco", "priv", "static", "fresco.js"),
    "utf8"
  );
  const handles = frescoSrc.split("container: el,").slice(1);
  assert.ok(handles.length >= 1, "could not find Fresco's public handles");
  for (const h of handles) {
    const surface = h.slice(0, h.indexOf("\n    };"));
    assert.ok(!/^\s*zoomAt:/m.test(surface),
      "Fresco now exposes zoomAt on its handle — this could call it directly " +
      "and anchor the zoom without a synthetic event");
  }
}

console.log("wheel zoom: all checks passed");
