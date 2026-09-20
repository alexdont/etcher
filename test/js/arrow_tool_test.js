// Pins the single-arrow tool.
//
// A dimension is a MEASUREMENT: two heads, and a label it drops you into
// writing because it is unfinished without one. This is the other thing
// people reach for a line-with-an-end for — pointing — so it has one head
// and no label unless you ask for one, the way every other shape does.
//
// It reuses the `arrow` KIND that connectors are made of rather than
// inventing a second one: same render, same handles, same bend-dropping,
// same stroke params, with no bindings — which is all a connector's
// `from` / `to` ever were.
//
//   node test/js/arrow_tool_test.js

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

// Constants the lifted functions close over.
for (const name of ["CLICK_PLACE_THRESHOLD_PX", "MIN_SPAN_PX"]) {
  const m = src.match(new RegExp(`var ${name} = ([\\d.]+);`));
  assert.ok(m, `could not find ${name}`);
  global[name] = Number(m[1]);
}

const startArrow = extract("_startArrow");
const updateDimension = extract("_updateDimension");
const commitDimension = extract("_commitDimension");
const shaftGeometry = extract("_shaftGeometry");
const isShaftKind = extract("_isShaftKind");
const styleForNewShape = extract("_styleForNewShape");
const isClickGesture = extract("_isClickGesture");

// ── it is in the toolbar, with a key and a glyph ──────────────────────────

{
  const defs = src.slice(src.indexOf("var TOOL_DEFS = {"),
                         src.indexOf("var TOOL_SHORTCUTS"));
  assert.ok(/arrow:\s+\{ icon: ICONS\.arrow,/.test(defs), "the tool is registered");
  assert.ok(!/arrow:[^}]*styleless/.test(defs),
    "it takes stroke params — it must not be marked styleless");
  assert.ok(!/arrow:[^}]*momentary/.test(defs),
    "…and it is a drawing mode, not a one-shot action");

  const shortcuts = src.slice(src.indexOf("var TOOL_SHORTCUTS = {"),
                              src.indexOf("};", src.indexOf("var TOOL_SHORTCUTS = {")));
  assert.ok(/\ba: "arrow"/.test(shortcuts), "A arms it");
  // One key, one tool: a shortcut that arms two things arms neither
  // predictably.
  const keys = shortcuts.match(/^\s*(\w+):/gm).map((s) => s.trim().replace(":", ""));
  assert.strictEqual(new Set(keys).size, keys.length, "no duplicate shortcut keys");

  assert.ok(src.includes("arrow:    '<svg"), "it has a toolbar icon");
  // And a glyph, which is both the gate for the drawing cursor and what a
  // collaborative host draws beside a peer holding this tool.
  assert.ok(/arrow:\s+'<path/.test(src.slice(src.indexOf("var CURSOR_BADGES"))),
    "it has a tool glyph");
}

// ── drawing one ───────────────────────────────────────────────────────────

function board() {
  const svg = { children: [], appendChild(c) { svg.children.push(c); } };
  return {
    svg,
    rendered: [],
    activeColor: "#93c5fd",
    lineParams: { width: 8, opacity: 0.5, dash: "dotted", fill: "solid" },
    _isStrokeShape: () => false,
    _isShaftKind: isShaftKind,
    _styleForNewShape: styleForNewShape,
    _markerScale: () => 2,
    _getPref: () => null,
    _currentMarkerStyle: () => ({}),
    _currentLineParams() {
      const lp = this.lineParams;
      return { color: this.activeColor, width: lp.width, opacity: lp.opacity,
               dash: lp.dash, fill: lp.fill };
    },
    _lineParamsForNewShape() {
      const lp = this._currentLineParams();
      return Object.assign({}, lp, { width: lp.width / this._markerScale(),
                                     width_units: "canvas" });
    },
    _makeArrowEl: () => ({ classList: { add() {} } }),
    _applyShapeColor() {},
    _renderShape(s) { this.rendered.push(s); },
    _positionAllHandles() {},
    _syncDraftHandles() {},
    _constrainShaftPoint: (a, pt) => pt,
    _isClickGesture: isClickGesture,
    _shaftGeometry: shaftGeometry,
    _commitShaftDraft(geom) { this.committed = geom; },
  };
}

{
  const self = board();
  startArrow.call(self, { x: 100, y: 100 }, { target: {} });

  const d = self.draftState;
  assert.strictEqual(d.kind, "arrow", "it draws the arrow KIND, not a new one");
  assert.deepStrictEqual(d.geometry.a, [100, 100]);
  assert.deepStrictEqual(d.geometry.b, [100, 100], "zero length until dragged");
  // Empty rather than absent: the render, the bbox and the hit test all read
  // the routed path, and a free arrow is the no-bends case of one.
  assert.deepStrictEqual(d.geometry.points, [], "an empty route, not a missing one");
  assert.strictEqual(d.geometry.from, null, "no bindings — that is what makes it free");
  assert.strictEqual(d.geometry.to, null);

  // It takes the panel's stroke params like every other line.
  assert.strictEqual(d.style.dash, "dotted");
  assert.strictEqual(d.style.width, 4, "in canvas units");
  assert.strictEqual(d.style.opacity, 0.5);
  assert.ok(!("fill" in d.style), "an open shaft carries no fill key");

  assert.deepStrictEqual(self.rendered, [d], "and previews immediately");
}

// ── a drag moves the head, keeping the route ──────────────────────────────

{
  const self = board();
  startArrow.call(self, { x: 100, y: 100 }, { target: {} });
  // A bend dropped mid-route — what the connector machinery this shares
  // would put there.
  self.draftState.geometry.points = [[150, 90]];

  updateDimension.call(self, { x: 400, y: 300 });
  assert.deepStrictEqual(self.draftState.geometry.b, [400, 300], "the head follows");
  assert.deepStrictEqual(self.draftState.geometry.points, [[150, 90]],
    "and the route survives — rebuilding geometry from a and b alone drops it");
  assert.strictEqual(self.draftState.geometry.from, null, "as do the bindings");
}

// ── release commits it, with no label editor ──────────────────────────────

{
  const self = board();
  startArrow.call(self, { x: 100, y: 100 }, { target: {} });
  commitDimension.call(self, { x: 400, y: 300 });

  assert.deepStrictEqual(self.committed.a, [100, 100]);
  assert.deepStrictEqual(self.committed.b, [400, 300]);
  assert.deepStrictEqual(self.committed.points, [],
    "the committed geometry is the draft's, not a fresh pair");

  // The label question: a DIMENSION drops into its (skippable) label
  // editor on release — a measurement usually wants its value written on
  // it — while lines and this arrow finalize plainly and take a label by
  // double-click. The callout keeps its prompt too: a callout with no
  // text is nothing.
  const commitShaft = src.slice(src.indexOf("    _commitShaftDraft: function"),
                                src.indexOf("\n    },", src.indexOf("    _commitShaftDraft: function")));
  assert.ok(/if \(kind === "dimension"\) \{\s+this\._finalizeLabeled\(kind, geom, el\);/.test(commitShaft),
    "the dimension prompts for its label on creation");
  assert.ok(commitShaft.includes("this._finalizeShape(kind, geom, el);"),
    "…while the other shafts — this arrow included — finalize without one");
  assert.ok(src.includes('this._finalizeLabeled("callout", geom, el);'),
    "…and the callout still opens its editor — it IS its text");
}

// ── and it draws either way, like the other two-ended tools ───────────────

{
  // A click arms rather than committing; the shared `_commitDimension` is
  // what gives it that, so wiring it to the same handler is the whole
  // feature.
  const self = board();
  startArrow.call(self, { x: 100, y: 100 }, { target: {} });
  commitDimension.call(self, { x: 101, y: 100 });
  assert.strictEqual(self.committed, undefined, "a click places nothing");
  assert.strictEqual(self.draftState.armed, true, "it waits for the second click");
}

{
  // The press half lives in `_dispatchToolDown`, which `_onPointerDown`
  // calls — split out so a press that closes a label editor can be held
  // back and released into the same dispatch only if it becomes a drag
  // (label_commit_click_test).
  for (const [handler, sig, fn] of [
    ["_dispatchToolDown", "function(pt, e) {", "this._startArrow(pt, e)"],
    ["_onPointerMove", "function(e) {", "this._updateDimension(pt)"],
    ["_onPointerUp", "function(e) {", "this._commitDimension(pt)"],
  ]) {
    const at = src.indexOf(`    ${handler}: ${sig}`);
    assert.notStrictEqual(at, -1, `could not find ${handler}`);
    const body = src.slice(at, src.indexOf("\n    },", at));
    assert.ok(new RegExp(`case "arrow":\\s+${fn.replace(/[.()]/g, "\\$&")};`).test(body),
      `${handler} must route the arrow tool to ${fn}`);
  }

  // And the press handler still reaches it.
  const down = src.slice(src.indexOf("    _onPointerDown: function(e) {"),
                         src.indexOf("\n    },", src.indexOf("    _onPointerDown: function(e) {")));
  assert.ok(down.includes("this._dispatchToolDown(pt, e);"),
    "an ordinary press goes straight to the tool");
}

// ── it is offered by default ──────────────────────────────────────────────

{
  const layer = fs.readFileSync(
    path.join(__dirname, "..", "..", "lib", "etcher", "layer.ex"), "utf8"
  );
  const attr = layer.slice(layer.indexOf("attr(:tools, :list,"),
                           layer.indexOf("attr(:image_source"));
  assert.ok(attr.includes(":arrow,"),
    "a host that does not name its tools should get the arrow too");
  assert.ok(attr.includes("`:arrow`"), "and the attr's docs should list it");
}

console.log("arrow tool: all checks passed");
