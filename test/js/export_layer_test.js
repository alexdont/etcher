// The board's shapes in Fresco's "Export as PDF" (`_exportLayer`).
//
// The two methods are lifted out of the bundle and run against fakes: what
// matters is that every shape is drawn in image px for the copy (not just
// what is on screen), that the screen drawing comes back exactly as it was
// — the overrides gone, the selection back, everything redrawn — even when
// drawing fails, and that a hidden layer adds nothing.
//
// Run: node test/js/export_layer_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "../../priv/static/etcher.js"), "utf8");

function lift(name) {
  const head = "    " + name + ": function(";
  const start = src.indexOf(head);
  assert.ok(start !== -1, name + " present");
  const end = src.indexOf("\n    },\n", start);
  return "(function(" + src.slice(start + head.length, end + 6) + ")";
}

// ── wiring ────────────────────────────────────────────────────────────────
assert.ok(src.includes("self._removeExportLayer = self.handle.addExportLayer(function(o) { return self._exportLayer(o); });"),
  "the layer registers its shapes with Fresco's export");
assert.ok(src.includes("if (this._removeExportLayer) { try { this._removeExportLayer(); } catch (_) {} this._removeExportLayer = null; }"),
  "and takes them back out when it is destroyed");
assert.ok(src.includes('isReady: function() { return self._ready === true; },'), "layerFor() says when the board is drawn");

// ── a fake world ──────────────────────────────────────────────────────────
global.SVG_NS = "http://www.w3.org/2000/svg";
global.EXPORT_MAX_SIDE = 4000;
function fakeEl(tag) {
  const el = {
    tag, attrs: {}, children: [], classes: new Set(),
    classList: {
      contains: (c) => el.classes.has(c), add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c)
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.unshift(c); return c; },
    get firstChild() { return el.children[0]; },
    get childNodes() { return el.children; }
  };
  return el;
}
global.document = { createElementNS: (_ns, tag) => fakeEl(tag) };

const exportShapesSvg = eval(lift("_exportShapesSvg"));
const exportLayer = eval(lift("_exportLayer"));

function layer(opts) {
  opts = opts || {};
  const proto = {
    _imageToContainer(pt) { return { x: pt.x * 3 + 100, y: pt.y * 3 + 50 }; }, // zoomed and panned
    _containerToImage(pt) { return pt; },
    _canvasRotation() { return 90; }
  };
  const self = Object.create(proto);
  const svg = fakeEl("svg");
  self.svg = svg;
  self.drawn = [];
  self.renderedAll = 0;
  self.shapes = (opts.shapes || [[10, 20, 30, 40], [200, 300, 50, 50]]).map(function(g, i) {
    const el = fakeEl("rect");
    el.getBBox = function() { return el.bbox; };
    el.transform = null;
    svg.appendChild(el);
    return { uuid: "s" + i, el: el, g: g };
  });
  // A piece of chrome in the same svg: never copied.
  const handle = fakeEl("circle"); handle.getBBox = () => ({ x: -9999, y: -9999, width: 5, height: 5 });
  svg.appendChild(handle);
  if (self.shapes[0]) self.shapes[0].el.classes.add("is-selected");
  self._renderShape = function(s) {
    if (opts.failOn === s.uuid) throw new Error("draw failed");
    const tl = self._imageToContainer({ x: s.g[0], y: s.g[1] });
    s.el.bbox = { x: tl.x, y: tl.y, width: s.g[2] * (tl.x === s.g[0] ? 1 : 3), height: s.g[3] * (tl.x === s.g[0] ? 1 : 3) };
    self.drawn.push([s.uuid, tl.x, tl.y, self._canvasRotation(), s.el.classes.has("is-selected")]);
  };
  self._renderAll = function() { self.renderedAll++; self.shapes.forEach((s) => self._renderShape(s)); };
  self._exportClone = function(node) { return { cloneOf: node }; };
  self._exportDefs = function() {};
  self._exportShapesSvg = exportShapesSvg;
  self._inlineExportImages = function() { return Promise.resolve(); };
  self.annotationsVisible = opts.hidden ? false : true;
  return self;
}

(async function() {
  // ── drawn whole, in image px, unrotated, without selection ──────────────
  {
    const l = layer();
    const out = exportShapesSvg.call(l);
    const forCopy = l.drawn.slice(0, 2);
    assert.deepStrictEqual(forCopy, [["s0", 10, 20, 0, false], ["s1", 200, 300, 0, false]],
      "each shape drawn at its own image px, no turn, no selection look");
    // The box spans both shapes plus a margin, in image px.
    assert.ok(out.box.x < 10 && out.box.y < 20, "box starts before the first shape");
    assert.ok(out.box.x + out.box.w > 250 && out.box.y + out.box.h > 350, "and ends after the last");
    assert.strictEqual(out.svg.attrs.viewBox, [out.box.x, out.box.y, out.box.w, out.box.h].join(" "));
    assert.strictEqual(out.svg.children.length, 2, "only the shapes are copied, not the chrome");
    assert.ok(out.svg.children.every((c) => l.shapes.some((s) => s.el === c.cloneOf)));

    // ── and the screen comes back ─────────────────────────────────────────
    assert.ok(!Object.prototype.hasOwnProperty.call(l, "_imageToContainer"), "the mapping override is gone");
    assert.ok(!Object.prototype.hasOwnProperty.call(l, "_canvasRotation"), "the rotation override is gone");
    assert.ok(!Object.prototype.hasOwnProperty.call(l, "_containerToImage"));
    assert.strictEqual(l.renderedAll, 1, "everything redrawn for the screen");
    assert.deepStrictEqual(l.drawn.slice(2), [["s0", 130, 110, 90, true], ["s1", 700, 950, 90, false]],
      "redrawn zoomed, turned and selected, as before");
  }

  // ── a failed draw still puts the screen back ────────────────────────────
  {
    const l = layer({ failOn: "s1" });
    assert.throws(() => exportShapesSvg.call(l), /draw failed/);
    assert.ok(!Object.prototype.hasOwnProperty.call(l, "_imageToContainer"), "override gone after a failure");
    assert.ok(l.shapes[0].el.classes.has("is-selected"), "selection restored after a failure");
  }

  // ── nothing to add ──────────────────────────────────────────────────────
  {
    assert.deepStrictEqual(await exportLayer.call(layer({ hidden: true })), [], "hidden annotations add nothing");
    assert.deepStrictEqual(await exportLayer.call(layer({ shapes: [] })), [], "no shapes add nothing");
    const strip = layer(); strip.handleKind = "strip";
    assert.deepStrictEqual(await exportLayer.call(strip), [], "a strip adds nothing");
  }

  // ── what Fresco gets ────────────────────────────────────────────────────
  {
    global.XMLSerializer = function() { this.serializeToString = () => "<svg/>"; };
    const got = await exportLayer.call(layer());
    assert.strictEqual(got.length, 1);
    assert.ok(got[0].src.startsWith("data:image/svg+xml;charset=utf-8,"), "an SVG data: URL");
    assert.ok(got[0].width > 240 && got[0].height > 330, "placed over the whole drawing, in image px");
  }

  console.log("Export layer: all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
