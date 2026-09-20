// Pins the tooltip's manners.
//
// It used to appear the instant the cursor touched a shape and sit for
// five seconds — so crossing a drawing flashed a tooltip per shape on
// the way, and the one you did want covered the picture long after you
// had read it. Now: the cursor has to settle before anything appears,
// the box fades rather than pops, and the dwell is short.
//
// The delay is for tooltips that arrive UNINVITED. A tooltip already
// open switches shape at once, and every deliberate path — pinning, the
// re-show after a handle drag or a bend edit — still shows immediately,
// because the user just acted on that shape and is waiting for it.
//
//   node test/js/tooltip_hover_intent_test.js

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

for (const name of ["TOOLTIP_OPEN_DELAY_MS", "TOOLTIP_DWELL_MS", "TOOLTIP_FADE_MS",
                    "TOOLTIP_PEEK_PX"]) {
  const m = src.match(new RegExp(`var ${name} = (\\d+);`));
  assert.ok(m, `could not find ${name}`);
  global[name] = Number(m[1]);
}

// ── the timings are the point ─────────────────────────────────────────────

{
  assert.ok(TOOLTIP_OPEN_DELAY_MS >= 200 && TOOLTIP_OPEN_DELAY_MS <= 600,
    "long enough that crossing a shape is silent, short enough to feel instant when meant");
  assert.ok(TOOLTIP_DWELL_MS <= 2500,
    "the complaint was that it took way too long to go away");
  assert.ok(TOOLTIP_DWELL_MS > TOOLTIP_OPEN_DELAY_MS,
    "…but it must outlast its own opening");
  assert.ok(TOOLTIP_FADE_MS > 0 && TOOLTIP_FADE_MS < 200,
    "a fade you notice as a fade, not as a wait");
}

// ── hover waits; an open tooltip switches at once ─────────────────────────

const hover = extract("_hoverTooltip");
const cancelOpen = extract("_cancelTooltipOpen");

function board(visible) {
  const timers = [];
  return {
    shown: [],
    tooltipEl: { style: { display: visible ? "" : "none" } },
    tooltipPinned: false,
    _hoveredShape: null,
    _showTooltipFor(s) { this.shown.push(s && s.uuid); },
    _cancelTooltipOpen: cancelOpen,
    _timers: timers,
    // A stand-in scheduler, so the test can fire the pending open by hand.
    _fire() { const t = timers.shift(); if (t) t(); },
  };
}

{
  const self = board(false);
  const shape = { uuid: "a" };
  global.setTimeout = (fn) => { self._timers.push(fn); return self._timers.length; };
  global.clearTimeout = () => {};

  self._hoveredShape = shape;
  hover.call(self, shape);
  assert.deepStrictEqual(self.shown, [],
    "nothing appears on contact — the cursor has to settle");
  self._fire();
  assert.deepStrictEqual(self.shown, ["a"], "…and then it does");
}

{
  // Crossing a drawing: hover lands on a shape, moves on before the
  // window closes. Nothing should ever have appeared.
  const self = board(false);
  const passed = { uuid: "passed" };
  const wanted = { uuid: "wanted" };
  global.setTimeout = (fn) => { self._timers.push(fn); return self._timers.length; };

  self._hoveredShape = passed;
  hover.call(self, passed);
  self._hoveredShape = wanted;           // the cursor moved on
  self._fire();                           // the stale timer fires
  assert.deepStrictEqual(self.shown, [],
    "a tooltip must not open for a shape the cursor has already left");
}

{
  // Already open: switching shapes is immediate. Charging the delay twice
  // would just feel slow.
  const self = board(true);
  self._hoveredShape = { uuid: "b" };
  hover.call(self, self._hoveredShape);
  assert.deepStrictEqual(self.shown, ["b"], "an open tooltip follows the cursor at once");
}

{
  // A pin landing inside the window wins — hover must not yank it away.
  const self = board(false);
  const shape = { uuid: "c" };
  global.setTimeout = (fn) => { self._timers.push(fn); return self._timers.length; };
  self._hoveredShape = shape;
  hover.call(self, shape);
  self.tooltipPinned = true;
  self._fire();
  assert.deepStrictEqual(self.shown, [], "a pinned tooltip is not replaced by a pending hover");
}

// ── the deliberate paths stay instant ─────────────────────────────────────

{
  // Hover is the ONLY caller that waits. Pinning and the re-shows after a
  // handle drag / bend edit go straight to _showTooltipFor.
  // Exactly two callers: the element's own mouseenter and the shared
  // _setHoveredShape. (The definition reads `_hoverTooltip: function`, so
  // it is not counted here.)
  const hoverSites = (src.match(/_hoverTooltip\(/g) || []).length;
  assert.strictEqual(hoverSites, 2,
    "hover should route through _hoverTooltip in exactly its two places");
  assert.ok(src.includes("_hoverTooltip: function(shape)"), "…and it must exist");

  const pin = src.slice(src.indexOf("_pinTooltipFor: function"),
                        src.indexOf("_pinTooltipFor: function") + 900);
  assert.ok(pin.includes("this._showTooltipFor(shape);"),
    "a click-to-pin shows at once — the user asked for it");
}

// ── a pending open never outlives its reason ──────────────────────────────

{
  const hide = src.slice(src.indexOf("    _hideTooltip: function"),
                         src.indexOf("    _hideTooltip: function") + 1400);
  assert.ok(hide.includes("this._cancelTooltipOpen();"),
    "hiding must drop a pending open, or it reappears after being dismissed");

  const setHovered = src.slice(src.indexOf("      this._hoveredShape = next;"),
                               src.indexOf("      this._hoveredOnTitle = onTitle;"));
  assert.ok(setHovered.includes("this._cancelTooltipOpen();"),
    "leaving a shape drops the open it was about to make");
}

// ── leaving closes it; reaching for it does not ───────────────────────────

{
  // The heart of the complaint: leaving a shape used to leave the dwell
  // timer in charge, so the tooltip rode out its whole window wherever
  // the cursor went. It closes on leave now, over a short bridge so the
  // trip to its own delete button does not snap it shut.
  const leaveAt = src.indexOf('el.addEventListener("mouseleave"');
  assert.notStrictEqual(leaveAt, -1, "the shape's mouseleave must exist");
  const leave = src.slice(leaveAt, leaveAt + 900);
  assert.ok(leave.includes("self._scheduleHideTooltip();"),
    "leaving a shape must start closing its tooltip");
  assert.ok(leave.includes("self._cancelTooltipOpen();"),
    "…and drop a pending open, so one cannot arrive after the cursor left");
  assert.ok(!/the dwell\s+\/\/ timer \(armed on show\) owns closing/.test(leave),
    "the old 'dwell owns closing' rule is what made it overstay");

  // Both renderers (canvas and strip) build a tooltip; both must behave.
  const enters = src.match(/tip\.addEventListener\("mouseenter", function\(\) \{\s*\n\s*self\._cancelHideTooltip\(\);\s*\n\s*self\._cancelTooltipAutoClose\(\);/g) || [];
  assert.strictEqual(enters.length, 2,
    "arriving on the tooltip must stop BOTH clocks, in both renderers — " +
    "cancelling only the dwell left it vanishing mid-reach");
  const tipLeaves = src.match(/tip\.addEventListener\("mouseleave"[\s\S]{0,420}?_scheduleHideTooltip\(\);/g) || [];
  assert.strictEqual(tipLeaves.length, 2,
    "leaving the tooltip closes it on the same bridge, in both renderers");
}

// ── a peek, not a stay: moving on closes it ───────────────────────────────

{
  // The last of the complaint: it appeared and then "just chilled there
  // waiting for something". It earned its place by the cursor being
  // still, so it gives it up the same way — even over the same shape.
  // The close runs through the usual bridge and the usual fade, so a
  // reach toward the tooltip still lands.
  assert.ok(TOOLTIP_PEEK_PX >= 8 && TOOLTIP_PEEK_PX <= 30,
    "past hand jitter, short of a deliberate reach");

  const peek = extract("_tooltipPeekMove");
  function board(extra) {
    return Object.assign({
      tooltipPinned: false,
      tooltipEl: { style: { display: "" } },
      _tooltipTimer: null,
      _tooltipCursorOrigin: { x: 100, y: 100 },
      hides: 0,
      _scheduleHideTooltip() { this.hides++; },
      _tooltipDocked: () => false,
    }, extra || {});
  }

  const still = board();
  peek.call(still, { clientX: 104, clientY: 103 });
  assert.strictEqual(still.hides, 0, "a hand that wobbles is still a hand holding still");

  const moved = board();
  peek.call(moved, { clientX: 100 + TOOLTIP_PEEK_PX + 2, clientY: 100 });
  assert.strictEqual(moved.hides, 1, "moving on starts the close");

  const pinned = board({ tooltipPinned: true });
  peek.call(pinned, { clientX: 400, clientY: 400 });
  assert.strictEqual(pinned.hides, 0, "a pinned tooltip was asked for and stays");

  const closed = board({ tooltipEl: { style: { display: "none" } } });
  peek.call(closed, { clientX: 400, clientY: 400 });
  assert.strictEqual(closed.hides, 0, "nothing up, nothing to close");

  const closing = board({ _tooltipTimer: 7 });
  peek.call(closing, { clientX: 400, clientY: 400 });
  assert.strictEqual(closing.hides, 0,
    "already closing — re-arming on every move would push the close further " +
    "out the more the user moved, which is backwards");

  const noOrigin = board({ _tooltipCursorOrigin: null });
  peek.call(noOrigin, { clientX: 400, clientY: 400 });
  assert.strictEqual(noOrigin.hides, 0, "no origin, no judgement");
}

// ── and the hover move path is what drives it ─────────────────────────────

{
  const moveAt = src.indexOf("self._lastPointerClient = { x: e.clientX, y: e.clientY };");
  assert.notStrictEqual(moveAt, -1, "the hover move must track the cursor for the peek");
  assert.ok(src.slice(moveAt, moveAt + 300).includes("self._tooltipPeekMove(e);"),
    "…and run the peek on every hover move");

  // AFTER the chrome guard: a move onto the tooltip is a reach for it, not
  // a move away from the shape.
  const chromeAt = src.indexOf("// Over Etcher's own chrome (toolbar / popup / tooltip): no shape hover.");
  assert.ok(chromeAt !== -1 && chromeAt < moveAt,
    "the peek must sit after the chrome check, or reaching the tooltip would close it");

  // The origin is stamped when it opens, from the tracked position.
  const show = src.slice(src.indexOf("    _showTooltipFor: function"),
                         src.indexOf("    _hoverTooltip: function"));
  assert.ok(show.includes("this._tooltipCursorOrigin = this._lastPointerClient"),
    "the peek measures from where the cursor was when the tooltip opened");
}

console.log("tooltip hover intent: all checks passed");

// ── docked: parked in the corner, and quiet in a different way ────────────

{
  // A host whose users annotate photographs does not want a box over the
  // picture at all. Docking is that host's call, opt-in, so every other
  // consumer keeps the anchored behaviour above untouched.
  const docked = extract("_tooltipDocked");
  assert.strictEqual(docked.call({ el: { dataset: { tooltipDock: "corner" } } }), true);
  assert.strictEqual(docked.call({ el: { dataset: {} } }), false,
    "anchored is the default — a consumer that says nothing keeps what it had");
  assert.strictEqual(docked.call({}), false, "and a layer with no element is not docked");

  // The corner never moves, so there is nothing to anchor per frame.
  const position = extract("_positionTooltip");
  const classes = new Set();
  const tip = {
    style: { left: "40px", top: "90px" },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
  tip.getBoundingClientRect = () => ({ width: 200, height: 60 });
  position.call({
    tooltipEl: tip,
    _tooltipDocked: () => true,
    // The viewer's own box — 800x600 with nothing scrolled.
    handle: {
      container: {
        scrollLeft: 0,
        scrollTop: 0,
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
    },
    // Reaching this would mean the anchor math ran: a docked tooltip
    // does not consult the shape at all.
    _isMediaKind: () => { throw new Error("docked must not measure the shape"); },
  }, { el: {} });
  assert.ok(classes.has("is-docked"), "the class carries the look");
  // Bottom-left of the VIEWER, in the same container-content coordinates
  // the anchored path writes — the offset parent is the stage that pans
  // and zooms, so a CSS corner would be the bottom of the drawing.
  assert.strictEqual(tip.style.left, "12px");
  assert.strictEqual(tip.style.top, (600 - 60 - 12) + "px");

  // A viewer shorter than the tooltip pins it to the top pad rather than
  // pushing it off the top edge.
  position.call({
    tooltipEl: tip,
    _tooltipDocked: () => true,
    handle: {
      container: {
        scrollLeft: 0, scrollTop: 0,
        getBoundingClientRect: () => ({ width: 800, height: 40 }),
      },
    },
    _isMediaKind: () => { throw new Error("docked must not measure the shape"); },
  }, { el: {} });
  assert.strictEqual(tip.style.top, "12px");

  // Strip mode scrolls its container, so the corner rides the scroll.
  position.call({
    tooltipEl: tip,
    _tooltipDocked: () => true,
    handle: {
      container: {
        scrollLeft: 30, scrollTop: 500,
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
    },
    _isMediaKind: () => { throw new Error("docked must not measure the shape"); },
  }, { el: {} });
  assert.strictEqual(tip.style.left, (30 + 12) + "px");
  assert.strictEqual(tip.style.top, (500 + 600 - 60 - 12) + "px");

  // Docked changes WHEN it leaves, too: the peek and the dwell both exist
  // because an anchored tooltip covers the drawing.
  const peek = extract("_tooltipPeekMove");
  const peeked = {
    tooltipPinned: false,
    _tooltipDocked: () => true,
    tooltipEl: { style: { display: "" } },
    _tooltipTimer: null,
    _tooltipCursorOrigin: { x: 0, y: 0 },
    hides: 0,
    _scheduleHideTooltip() { this.hides++; },
  };
  peek.call(peeked, { clientX: 400, clientY: 400 });
  assert.strictEqual(peeked.hides, 0,
    "a docked tooltip covers nothing, so moving on is not a reason to close it");

  const auto = extract("_startTooltipAutoClose");
  let armed = false;
  auto.call({
    _tooltipDocked: () => true,
    _cancelTooltipAutoClose() {},
  });
  assert.strictEqual(armed, false,
    "…nor does a dwell: a readout that vanishes mid-sentence is worse than one that waits");
}

// ── the placement is a host's choice, not a default change ────────────────

{
  const layer = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "etcher", "layer.ex"), "utf8");
  assert.ok(/attr\(:tooltip_dock, :atom,\s*\n\s*default: :anchor/.test(layer),
    "anchored stays the default — other consumers must not be moved by this");
  assert.ok(layer.includes('values: [:anchor, :corner]'),
    "…and the only alternative is the corner");
  assert.ok(layer.includes('data-tooltip-dock={@tooltip_dock == :corner && "corner"}'),
    "the attr has to actually reach the layer element");
}
