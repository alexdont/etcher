// Pins how a HATCH-filled shape shows that it is selected.
//
// Selection is drawn by an SVG filter that rings every painted pixel of a
// shape. A hatch fill IS painted pixels — a tile of diagonal stripes — so
// selecting a hatched shape ringed each stripe individually: dozens of blue
// outlines through the middle of the shape where one around it was meant.
//
// Hatched shapes now opt out of that filter (`.etcher-hatched`) and get a
// traced perimeter instead: a copy of their own geometry, no fill, stroked
// blue, sat behind the shape so only the edges of the band show. Same read
// as the filter's ring, and the inside is left alone.
//
//   node test/js/hatch_outline_test.js

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

// The module-level constants the tracer reads.
{
  const blue = src.match(/var SELECTION_BLUE = "(#[0-9a-f]{6})";/);
  const band = src.match(/var OUTLINE_BAND_PX = ([\d.]+);/);
  const skip = src.match(/var SKIP_OUTLINE_ATTRS = \{[\s\S]*?\};/);
  assert.ok(blue && band && skip, "could not find the outline constants");
  global.SELECTION_BLUE = blue[1];
  global.OUTLINE_BAND_PX = Number(band[1]);
  eval("global." + skip[0].replace("var ", ""));
}

const applyFill = extract("_applyFill");
const isFillableEl = extract("_isFillableEl");
const looksSelected = extract("_looksSelected");
const isHatched = extract("_isHatched");
const syncHatchOutline = extract("_syncHatchOutline");

// ── a minimal SVG element ──────────────────────────────────────────────────

function el(tagName, attrs) {
  const classes = new Set();
  const node = {
    tagName,
    style: {},
    parentNode: null,
    nextSibling: null,
    attributes: [],
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute(name, value) {
      const found = node.attributes.find((a) => a.name === name);
      if (found) found.value = String(value);
      else node.attributes.push({ name, value: String(value) });
    },
    getAttribute(name) {
      const found = node.attributes.find((a) => a.name === name);
      return found ? found.value : null;
    },
    removeAttribute(name) {
      node.attributes = node.attributes.filter((a) => a.name !== name);
    },
    cloneNode() {
      const copy = el(tagName);
      node.attributes.forEach((a) => copy.setAttribute(a.name, a.value));
      return copy;
    },
  };
  Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
  return node;
}

function parent() {
  const kids = [];
  return {
    kids,
    insertBefore(node, ref) {
      const at = kids.indexOf(ref);
      kids.splice(at === -1 ? kids.length : at, 0, node);
      node.parentNode = this;
      node.nextSibling = ref || null;
    },
    removeChild(node) {
      const at = kids.indexOf(node);
      if (at !== -1) kids.splice(at, 1);
      node.parentNode = null;
    },
  };
}

// ── the marker class tracks the fill mode ──────────────────────────────────

{
  const ctx = {
    _isFillableEl: isFillableEl,
    _shapeColor: () => "#93c5fd",
    _hatchPattern: () => "hatch-1",
  };

  const rect = el("rect");
  applyFill.call(ctx, rect, { fill: "pattern", opacity: 1 });
  assert.ok(rect.classList.contains("etcher-hatched"),
    "a hatch fill marks the shape");
  assert.ok(rect.style.fill.indexOf("url(#hatch-1)") === 0);

  // Every other mode must CLEAR it, or a shape switched off the hatch keeps
  // opting out of the selection filter and never looks selected again.
  for (const fill of ["semi", "solid", "none"]) {
    const s = el("rect");
    applyFill.call(ctx, s, { fill: "pattern", opacity: 1 });
    assert.ok(s.classList.contains("etcher-hatched"));
    applyFill.call(ctx, s, { fill, opacity: 1 });
    assert.ok(!s.classList.contains("etcher-hatched"),
      `switching from hatch to "${fill}" must clear the marker`);
  }

  // An element that can't hold a fill at all.
  const line = el("line");
  line.classList.add("etcher-hatched");
  applyFill.call(ctx, line, { fill: "pattern", opacity: 1 });
  assert.ok(!line.classList.contains("etcher-hatched"));
}

// ── which states get an outline ────────────────────────────────────────────

for (const state of ["is-selected", "is-editing", "is-multi-selected", "is-hovered"]) {
  const node = el("rect");
  node.classList.add(state);
  assert.ok(looksSelected(node), `${state} should be outlined`);
}
assert.ok(!looksSelected(el("rect")), "an idle shape is not outlined");
assert.ok(!looksSelected(null), "and a missing element is not an error");

// ── the traced perimeter ───────────────────────────────────────────────────

function hatchedShape(attrs) {
  const node = el("rect", Object.assign(
    { x: "10", y: "20", width: "30", height: "40",
      "stroke-dasharray": "6 4", "stroke-width": "2", "data-uuid": "u1" },
    attrs || {}
  ));
  node.classList.add("etcher-hatched");
  node.style.strokeWidth = "4px";
  const p = parent();
  p.insertBefore(node, null);
  return {
    // Whether a shape is hatched is read off its STYLE, not off the class:
    // `_applyFill` is reached through several paths, a couple of which pass
    // no style and strip the class on the way past, so the DOM reports what
    // the last painter did while the style says what the shape is.
    shape: { kind: "rectangle", el: node, style: { fill: "pattern" } },
    el: node,
    parent: p,
  };
}

const ctx = { _looksSelected: looksSelected, _isHatched: isHatched };

// ── the hatched test is on the data, not on the DOM ────────────────────────

assert.strictEqual(isHatched({ style: { fill: "pattern" } }), true);
for (const fill of ["semi", "solid", "none", undefined]) {
  assert.strictEqual(isHatched({ style: { fill } }), false, `"${fill}" is not hatched`);
}
assert.strictEqual(isHatched(null), false);
assert.strictEqual(isHatched({}), false, "a shape with no style is not hatched");

{
  // The class going missing must not bring the ringing back.
  const h = hatchedShape();
  h.el.classList.remove("etcher-hatched");
  h.el.classList.add("is-selected");
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.el.style.filter, "none",
    "the filter is killed off the style, so a stripped class cannot undo it");
  assert.ok(h.shape._hatchOutline, "and the traced outline is still drawn");
}

{
  // Not selected → nothing drawn.
  const h = hatchedShape();
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.shape._hatchOutline, null);
  assert.strictEqual(h.parent.kids.length, 1);

  // The ringing filter is killed inline whether or not it is selected: an
  // inline style cannot be out-ranked by a stylesheet, which is the point.
  assert.strictEqual(h.el.style.filter, "none",
    "a hatched shape is never run through the pixel-ringing filter");

  // Selected → a traced copy appears BEHIND the shape.
  h.el.classList.add("is-multi-selected");
  syncHatchOutline.call(ctx, h.shape);
  const outline = h.shape._hatchOutline;
  assert.ok(outline, "a selected hatched shape gets an outline");
  assert.strictEqual(outline.tagName, "rect", "same element type as the shape");
  assert.deepStrictEqual(h.parent.kids, [outline, h.el],
    "it sits behind the shape, so the shape's own stroke covers the band");

  // It traces the same geometry…
  assert.strictEqual(outline.getAttribute("x"), "10");
  assert.strictEqual(outline.getAttribute("width"), "30");
  // …but none of the shape's own look, and not its identity.
  assert.strictEqual(outline.getAttribute("stroke-dasharray"), null,
    "a dashed outline would read as a property of the shape, not as selection");
  assert.strictEqual(outline.getAttribute("data-uuid"), null,
    "a second element answering to the same uuid would confuse uuid lookups");
  assert.strictEqual(outline.getAttribute("class"), "etcher-hatch-outline");
  assert.strictEqual(outline.style.fill, "none");
  assert.strictEqual(outline.style.stroke, SELECTION_BLUE);
  assert.strictEqual(outline.style.filter, "none",
    "the tracing must not be run through the ringing filter itself");
  // Own stroke 4px, standing proud by the dilate radius on each side.
  assert.strictEqual(outline.style.strokeWidth,
    (4 + OUTLINE_BAND_PX * 2) + "px");

  // Geometry moves (pan / zoom / drag): the SAME node is updated.
  h.el.setAttribute("x", "99");
  h.el.style.strokeWidth = "10px";
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.shape._hatchOutline, outline, "the node is reused");
  assert.strictEqual(outline.getAttribute("x"), "99", "and follows the shape");
  assert.strictEqual(outline.style.strokeWidth, (10 + OUTLINE_BAND_PX * 2) + "px");
  assert.strictEqual(h.parent.kids.length, 2, "without stacking up copies");

  // Deselected → taken back down.
  h.el.classList.remove("is-multi-selected");
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.shape._hatchOutline, null);
  assert.deepStrictEqual(h.parent.kids, [h.el], "no outline left behind");
}

{
  // A selected shape that is NOT hatched keeps the filter — no tracing.
  const h = hatchedShape();
  h.shape.style = { fill: "semi" };
  h.el.classList.add("is-selected");
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.shape._hatchOutline, null,
    "unhatched shapes are outlined by the filter, not by a traced copy");
  assert.strictEqual(h.el.style.filter, "",
    "…so their filter is left to the stylesheet");
}

{
  // Fill switched off the hatch while still selected: the tracing goes and
  // the filter takes over again.
  const h = hatchedShape();
  h.el.classList.add("is-selected");
  syncHatchOutline.call(ctx, h.shape);
  assert.ok(h.shape._hatchOutline);
  h.shape.style = { fill: "solid" };
  syncHatchOutline.call(ctx, h.shape);
  assert.strictEqual(h.shape._hatchOutline, null);
  assert.deepStrictEqual(h.parent.kids, [h.el]);
  assert.strictEqual(h.el.style.filter, "",
    "and the filter is handed back to the stylesheet");
}

// ── wiring ─────────────────────────────────────────────────────────────────

// Selection and hover are class toggles that re-render nothing, so the
// tracing has to be asked for at those sites — which is the job the image
// ring's refresh already does.
{
  const body = src.slice(src.indexOf("    _refreshImageRing: function"),
                         src.indexOf("\n    },", src.indexOf("    _refreshImageRing: function")));
  assert.ok(body.includes("this._syncHatchOutline(shape);"),
    "the selection/hover refresh must also sync the tracing");
}
// …and geometry changes come through the render.
{
  const render = src.slice(src.indexOf("    _renderShape: function"),
                           src.indexOf("    _renderBadge: function"));
  assert.ok(render.includes("self._syncHatchOutline(shape);"),
    "a render re-traces, so the outline follows pans, zooms and drags");
}
// An outline is a SIBLING of its shape, so deleting the shape orphans it —
// the same hazard the image ring has, swept the same way.
{
  const sweep = src.slice(src.indexOf("    _sweepImageRings: function"),
                          src.indexOf("\n    },", src.indexOf("    _sweepImageRings: function")));
  assert.ok(sweep.includes(".etcher-hatch-outline"),
    "orphaned outlines are swept with orphaned rings");
  assert.ok(sweep.includes("s._hatchOutline"),
    "…and a live shape's outline is not swept out from under it");
}

// The stylesheet half: hatched shapes opt out of the ringing filter.
{
  const start = src.indexOf('".etcher-shape.etcher-hatched.is-multi-selected,"');
  assert.notStrictEqual(start, -1, "no filter opt-out for hatched shapes");
  const rule = src.slice(start, src.indexOf('"}"', start));
  for (const state of ["is-multi-selected", "is-selected", "is-editing", "is-hovered"]) {
    assert.ok(rule.includes(`.etcher-shape.etcher-hatched.${state}`),
      `${state} still rings every hatch stripe`);
  }
  assert.ok(rule.includes("filter: none;"));
}

console.log("hatch outline: all checks passed");
