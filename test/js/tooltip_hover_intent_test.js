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
    // Anchored: the docked branch has its own checks further down.
    _tooltipDocked: () => false,
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
  assert.strictEqual(docked.call({ el: { dataset: { tooltipDock: "panel" } } }), true);
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
  const panel = { children: [], appendChild(el) { this.children.push(el); tip.parent = this; } };
  position.call({
    tooltipEl: tip,
    stylePanel: panel,
    _tooltipDocked: () => true,
    // Reaching this would mean the anchor math ran: a docked tooltip has
    // no coordinates of its own — it is a row in the panel's flow.
    handle: null,
    _isMediaKind: () => { throw new Error("docked must not measure the shape"); },
  }, { el: {} });
  assert.ok(classes.has("is-docked"), "the class carries the look");
  assert.strictEqual(tip.style.left, "", "no coordinates: the panel lays it out");
  assert.strictEqual(tip.style.top, "");
  assert.strictEqual(tip.parent, panel,
    "the element MOVES into the panel, so its delete button, the host's " +
    "actions and the label editor keep working exactly as they do anchored");

  // Already in the panel: not re-appended on every show.
  panel.children.length = 0;
  tip.parentNode = panel;
  position.call({
    tooltipEl: tip, stylePanel: panel, _tooltipDocked: () => true, handle: null,
    _isMediaKind: () => { throw new Error("no"); },
  }, { el: {} });
  assert.deepStrictEqual(panel.children, []);

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

// ── docked: every close goes through the one decision ────────────────────

{
  // Hover previews it; clicking keeps it, because its buttons live over in
  // the panel and a selection outlives the cursor. Nothing here "hides" on
  // its own: a close asks what the panel should show now, so a preview
  // ending hands the section back to the selection instead of emptying the
  // panel — which is what a bare hide would do.
  const schedule = extract("_scheduleHideTooltip");
  const shape = { uuid: "s1" };

  let synced = 0, scheduled = 0;
  global.setTimeout = () => { scheduled++; return 1; };
  const docked = {
    tooltipPinned: false,
    _tooltipDocked: () => true,
    editingShape: shape,
    _tooltipShape: shape,
    _cancelHideTooltip() {},
    _syncDockedTooltip() { synced++; },
  };
  schedule.call(docked);
  assert.strictEqual(synced, 1, "a docked close asks what should be showing now");
  assert.strictEqual(scheduled, 0,
    "…and answers immediately: no timer, so nothing can fire against a " +
    "selection that is still there");

  // Pinned still wins outright, docked or not.
  synced = 0;
  schedule.call(Object.assign({}, docked, { tooltipPinned: true }));
  assert.strictEqual(synced, 0);

  // Anchored hosts keep the bridge timer they have always had.
  scheduled = 0;
  schedule.call({
    tooltipPinned: false,
    _tooltipDocked: () => false,
    _cancelHideTooltip() {},
  });
  assert.strictEqual(scheduled, 1);
}

// ── docked: with Etcher off, the shapes are part of the picture ──────────

{
  // The panel only exists in annotation mode, so outside it a hover has
  // nothing to show — and an outline on a shape nobody can act on reads as
  // the image lighting up for no reason. Anchored hosts are untouched:
  // their tooltip is a viewer feature.
  const allowed = extract("_hoverAllowed");

  assert.strictEqual(
    allowed.call({ annotationMode: false, activeTool: null, _tooltipDocked: () => true }),
    false, "docked + Etcher off: no hover, no outline, no tooltip");
  assert.strictEqual(
    allowed.call({ annotationMode: true, activeTool: null, _tooltipDocked: () => true }),
    true, "docked + Etcher on + cursor tool: hover works");
  assert.strictEqual(
    allowed.call({ annotationMode: true, activeTool: "rectangle", _tooltipDocked: () => true }),
    false, "…but not with a tool armed, as ever");
  assert.strictEqual(
    allowed.call({ annotationMode: false, activeTool: null, _tooltipDocked: () => false }),
    true, "anchored hosts still hover in view mode — that is their whole tooltip");

  // Clicking is the other half. Without this a tap still pinned the
  // tooltip and marked the shape selected — the blue outline on something
  // that is supposed to be part of the picture.
  const tap = extract("_onShapeTap");
  const shape = { uuid: "s", readonly: false };

  let acted = 0;
  tap.call({
    _tooltipDocked: () => true,
    annotationMode: false,
    _enterEditMode() { acted++; },
    _pinTooltipFor() { acted++; },
    _unpinTooltip() { acted++; },
  }, shape);
  assert.strictEqual(acted, 0,
    "docked + Etcher off: a click on a shape does nothing at all");

  // With Etcher on it selects, as ever.
  let entered = 0;
  tap.call({
    _tooltipDocked: () => true,
    annotationMode: true,
    _enterEditMode() { entered++; },
  }, shape);
  assert.strictEqual(entered, 1);

  // And an anchored host still pins in browse mode — that is its tooltip.
  let pinned = 0;
  tap.call({
    _tooltipDocked: () => false,
    annotationMode: false,
    tooltipPinned: false,
    _pinTooltipFor() { pinned++; },
  }, shape);
  assert.strictEqual(pinned, 1);
}

// ── docked: the section is state, not a sequence of timers ───────────────

{
  // The bug this answers: a hover REPLACED the selected shape's section
  // and left an empty panel when the cursor moved on, so the promise of
  // the mode — click a shape and its actions are there while it is
  // selected — held only until the cursor wandered over something else.
  const sync = extract("_syncDockedTooltip");
  const selected = { uuid: "sel" };
  const other = { uuid: "other" };

  function board(hovered, editing, showing) {
    return {
      shown: [], hidden: 0,
      _tooltipDocked: () => true,
      _hoverAllowed: () => true,
      _hoveredShape: hovered,
      editingShape: editing,
      _tooltipShape: showing || null,
      tooltipEl: { style: { display: showing ? "block" : "none" } },
      _showTooltipFor(s) { this.shown.push(s.uuid); },
      _hideTooltip() { this.hidden++; },
    };
  }

  var b = board(null, selected, null);
  sync.call(b);
  assert.deepStrictEqual(b.shown, ["sel"], "a selection with no hover shows the selection");

  b = board(other, selected, selected);
  sync.call(b);
  assert.deepStrictEqual(b.shown, ["other"], "a hover borrows the section to preview");

  b = board(null, selected, other);
  sync.call(b);
  assert.deepStrictEqual(b.shown, ["sel"],
    "…and leaving hands it BACK to the selection — the empty panel was the bug");

  b = board(null, null, other);
  sync.call(b);
  assert.strictEqual(b.hidden, 1, "nothing hovered, nothing selected: nothing shown");

  b = board(selected, selected, selected);
  sync.call(b);
  assert.deepStrictEqual(b.shown, [], "already showing the right shape: left alone");

  // Anchored hosts never reach any of this.
  b = board(other, selected, selected);
  b._tooltipDocked = () => false;
  sync.call(b);
  assert.deepStrictEqual(b.shown, []);
  assert.strictEqual(b.hidden, 0);
}

// ── docked: a selection is not on a clock; a preview is ──────────────────

{
  const auto = extract("_startTooltipAutoClose");
  const shape = { uuid: "s" };
  let armed = 0;
  global.setTimeout = () => { armed++; return 1; };

  auto.call({
    _tooltipDocked: () => true,
    editingShape: shape, _tooltipShape: shape,
    _cancelTooltipAutoClose() {},
  });
  assert.strictEqual(armed, 0,
    "a selected shape's section never times out — that is the promise of the mode");

  let fired = null;
  global.setTimeout = (fn) => { armed++; fired = fn; return 1; };
  const previewing = {
    _tooltipDocked: () => true,
    editingShape: shape, _tooltipShape: { uuid: "preview" },
    _cancelTooltipAutoClose() {},
    synced: 0, hidden: 0,
    _syncDockedTooltip() { this.synced++; },
    _hideTooltip() { this.hidden++; },
  };
  auto.call(previewing);
  assert.strictEqual(armed, 1, "a hover preview of something else times out, like any glance");
  fired();
  assert.strictEqual(previewing.synced, 1,
    "…and hands the section back to the selection rather than emptying the panel");
  assert.strictEqual(previewing.hidden, 0);
}

// ── docked: entering a shape already shown must not rebuild it ───────────

{
  // The flash. `_showTooltipFor` rewrites the section's markup and re-runs
  // its fade, and the element's own mouseenter used to call it directly —
  // so moving the cursor over a shape whose section was ALREADY up
  // (typically the selected one) rebuilt it, and the panel blinked. The
  // enter goes through the state function now, which no-ops when nothing
  // has changed.
  const hover = extract("_hoverTooltip");
  const shape = { uuid: "sel" };

  const board = {
    _tooltipDocked: () => true,
    shows: 0, syncs: [],
    _showTooltipFor() { this.shows++; },
    _syncDockedTooltip(s) { this.syncs.push(s && s.uuid); },
    _cancelTooltipOpen() {},
    tooltipEl: { style: { display: "block" } },
    tooltipPinned: false,
  };
  hover.call(board, shape);
  assert.strictEqual(board.shows, 0,
    "a docked hover must not re-show — that rebuild IS the flash");
  assert.deepStrictEqual(board.syncs, ["sel"],
    "it asks the state function instead, passing the shape the cursor entered");

  // The state function's own no-op guard is the other half: same shape,
  // already showing, nothing to do.
  const sync = extract("_syncDockedTooltip");
  const quiet = {
    _tooltipDocked: () => true,
    _hoverAllowed: () => true,
    _hoveredShape: shape,
    editingShape: shape,
    _tooltipShape: shape,
    tooltipEl: { style: { display: "block" } },
    shows: 0,
    _showTooltipFor() { this.shows++; },
    _hideTooltip() { assert.fail("nothing to hide"); },
  };
  sync.call(quiet);
  assert.strictEqual(quiet.shows, 0,
    "already showing the right shape: left alone, markup and fade untouched");

  // …but a section that is down IS shown, even for the same shape.
  quiet.tooltipEl.style.display = "none";
  sync.call(quiet);
  assert.strictEqual(quiet.shows, 1);
}

// ── docked: the section leaves in the frame the panel re-lays-out in ──────

{
  // The last flash. Docked, the tooltip is a section of the style panel, so
  // it holds panel height until `display` flips — and the rows around it are
  // rebuilt by `_scheduleStyleInspectorSync`, which coalesces into the next
  // frame. A 110ms fade-out put those in different paints: the panel grew by
  // a row with the section still in place, then collapsed a tenth of a
  // second later. Both now land in the same frame, so the panel changes
  // shape once. Anchored floats over the drawing and disturbs no rows, so it
  // keeps its fade.
  const hideTooltip = extract("_hideTooltip");

  function hide(opts) {
    const classes = new Set(opts.visible === false ? [] : ["is-visible"]);
    const tip = {
      style: { display: opts.visible === false ? "none" : "block" },
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
    };
    const timers = [], frames = [];
    const realTimeout = global.setTimeout, realRaf = global.requestAnimationFrame;
    global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
    try {
      hideTooltip.call({
        tooltipEl: tip,
        _tooltipShape: { uuid: "u1" },
        _tooltipDocked: () => opts.docked,
        _cancelHideTooltip() {},
        _cancelTooltipAutoClose() {},
        _cancelTooltipOpen() {},
        _removeTooltipOutsideClickHandler() {},
        _dispatch() {},
      });
    } finally {
      global.setTimeout = realTimeout;
      global.requestAnimationFrame = realRaf;
    }
    return {
      display: () => tip.style.display,
      timers, frames, tip,
      runFrame: () => frames.forEach((f) => f()),
      reshow: () => { classes.add("is-visible"); tip.style.display = "block"; },
    };
  }

  const docked = hide({ docked: true });
  assert.strictEqual(docked.timers.length, 0,
    "no fade timer: a tenth of a second is long enough to read as a second change");
  assert.strictEqual(docked.frames.length, 1,
    "the docked section leaves on the next frame — the one the coalesced " +
    "inspector sync already owns, so the panel changes shape once");
  assert.strictEqual(docked.display(), "block",
    "…and not before: flipping it now would paint ahead of those rows");
  docked.runFrame();
  assert.strictEqual(docked.display(), "none", "the frame takes it out of the panel");

  // A show inside that one-frame window owns the element; the hide stands down.
  const raced = hide({ docked: true });
  raced.reshow();
  raced.runFrame();
  assert.strictEqual(raced.display(), "block",
    "hovering another shape in the same frame must not be undone by the hide it raced");

  const anchored = hide({ docked: false });
  assert.strictEqual(anchored.frames.length, 0);
  assert.strictEqual(anchored.timers.length, 1,
    "anchored floats over the drawing: nothing reflows behind it, so it still fades");
  assert.ok(anchored.timers[0].ms > 0 && anchored.timers[0].ms <= 300,
    "a fade you notice as a fade, not as a wait");
  assert.strictEqual(anchored.display(), "block", "…and stays up for it");

  // Not showing in the first place: down at once, no frame, no timer.
  const already = hide({ docked: true, visible: false });
  assert.strictEqual(already.display(), "none");
  assert.strictEqual(already.frames.length, 0);
  assert.strictEqual(already.timers.length, 0);
}

// ── a show and a hide in one task must not both survive the frame ────────

{
  // Both halves wait a frame: the show paints its class in on the next one
  // (so the element is laid out at opacity 0 first, or there is nothing to
  // transition from), and the docked hide flips `display` on the next one
  // (so the panel changes shape once). Neither could cancel the other, and
  // each stands down when it sees the other's mark — so issuing both in
  // one task left whichever ran second doing nothing, and the element on
  // screen with `_tooltipShape` already null. Every later sync then saw
  // nothing to hide, and the section outlived what it described.
  //
  // `_enterEditMode` issues exactly that pair, which is why the docked
  // section appeared at all: by accident, the show's paint winning.
  const hideTooltip = extract("_hideTooltip");

  const frames = [];
  const realRaf = global.requestAnimationFrame, realCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  global.cancelAnimationFrame = (id) => { frames[id - 1] = null; };
  try {
    const classes = new Set(["is-visible"]);
    const tip = {
      style: { display: "block" },
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
                   contains: (c) => classes.has(c) },
    };
    const board = {
      tooltipEl: tip,
      _tooltipShape: { uuid: "u1" },
      _tooltipDocked: () => true,
      _tooltipFadeInFrame: 1,          // a show is waiting to paint
      _cancelHideTooltip() {}, _cancelTooltipAutoClose() {}, _cancelTooltipOpen() {},
      _removeTooltipOutsideClickHandler() {}, _dispatch() {},
    };
    frames.push(() => { throw new Error("the cancelled show must not run"); });

    hideTooltip.call(board);
    assert.strictEqual(board._tooltipFadeInFrame, null,
      "hiding has to cancel the paint a show left waiting, or it re-opens " +
      "what was just closed");
    assert.strictEqual(frames[0], null, "…actually cancelled, not merely forgotten");

    // Run the frame: with the show gone, the hide lands.
    frames.filter(Boolean).forEach((fn) => fn());
    assert.strictEqual(tip.style.display, "none");
  } finally {
    global.requestAnimationFrame = realRaf;
    global.cancelAnimationFrame = realCancel;
  }

  // The other direction, at its source: a show cancels the hide's frame.
  const show = src.slice(src.indexOf("    _showTooltipFor: function(shape) {"),
                         src.indexOf("    _showTooltipFor: function(shape) {") + 1200);
  assert.ok(show.includes("cancelAnimationFrame(this._tooltipHideFrame)"),
    "a show must cancel a pending hide, or the hide puts it away unpainted");
  assert.ok(show.includes("clearTimeout(this._tooltipFadeTimer)"),
    "…and the anchored fade-out timer, which ends the same way");
}

// ── selecting a shape keeps its section; only the bubble is dismissed ────

{
  // `_enterEditMode` asks for the docked section and then hides the
  // anchored bubble. Unguarded, that second call took the section with it
  // — invisible only because the race above happened to go the other way.
  const enter = src.slice(src.indexOf("    _enterEditMode: function(shape) {"),
                          src.indexOf("\n    },", src.indexOf("    _enterEditMode: function(shape) {")));
  assert.ok(enter.includes("this._syncDockedTooltip();"),
    "selecting a shape is what puts its actions in the panel");
  assert.ok(enter.includes("if (!this._tooltipDocked()) this._hideTooltip();"),
    "the bubble-dismissing hide must not run for a docked host — the section " +
    "IS the selection's UI there");
}

console.log("tooltip docked hide: all checks passed");
