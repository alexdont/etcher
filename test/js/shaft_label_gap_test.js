// Pins the shaft-label gap: a dimension's or arrow's riding label breaks
// the line around itself — the drafting convention: the value sits IN
// the line, in a break of its own, not printed across it.
//
// The cut is a per-shape mask on the shaft group (so it honours curves,
// dash patterns and arrowheads, and the geometry never learns about it),
// sized to the label's rendered rect plus a proportional margin, turned
// with the board, and removed when the label goes away.
//
//   node test/js/shaft_label_gap_test.js

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

// A miniature SVG DOM — attributes, classes, children, and the two
// selector shapes the helpers use ('[id="…"]' and '.class').
function fakeEl(tag, attrs) {
  const el = {
    tag,
    attrs: {},
    children: [],
    parentNode: null,
    classList: {
      list: [],
      add(...c) { this.list.push(...c); },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; },
    appendChild(c) { el.children.push(c); c.parentNode = el; },
    insertBefore(c) { el.children.unshift(c); c.parentNode = el; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); },
    querySelector(sel) {
      const all = [];
      (function walk(n) { n.children.forEach((c) => { all.push(c); walk(c); }); })(el);
      if (sel.startsWith('[id="')) {
        const id = sel.slice(5, -2);
        return all.find((n) => n.attrs.id === id) || null;
      }
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return all.find((n) => n.classList.list.includes(cls)) || null;
      }
      return null;
    },
  };
  for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
  return el;
}
global.svgEl = (tag, attrs) => fakeEl(tag, attrs);
global.SHAFT_GAP_SEQ = 0;

const syncGap = extract("_syncShaftLabelGap");
const clearGap = extract("_clearShaftLabelGap");

function board() {
  return {
    svg: fakeEl("svg"),
    _defs: null,
    firstChild: null,
    // The margin's floor is measured from the EDGE of the line, so the
    // renderer asks how thick this shape's line actually is.
    _renderedStrokePx: (s) => ((s && s.style && s.style.width) || 2),
  };
}

// ── the cut tracks the label's rect, margin included ──────────────────────

{
  const self = board();
  const shape = { uuid: "abc-123", el: fakeEl("g"), kind: "dimension" };
  const rect = fakeEl("rect", { x: 100, y: 50, width: 80, height: 20 });

  syncGap.call(self, shape, rect);

  const maskUrl = shape.el.getAttribute("mask");
  assert.ok(/^url\(#etcher-shaft-gap-\d+-abc-123\)$/.test(maskUrl),
    `the shaft group must paint through the label mask (got ${maskUrl})`);

  const mask = self._defs.children[0];
  assert.strictEqual(mask.tag, "mask");
  assert.strictEqual(mask.attrs.maskUnits, "userSpaceOnUse",
    "container-px cut coordinates need userSpaceOnUse, and the mask must " +
    "cover wherever pan/zoom puts the shaft");
  const [keep, cut] = mask.children;
  assert.strictEqual(keep.attrs.fill, "#fff", "everything paints by default");
  assert.strictEqual(cut.attrs.fill, "#000", "…except the label's box");

  // gap = max(4 + 2/2, 20 * 0.14) = 5 — proportional, with a floor that
  // tracks the line's own weight. A step, not a stride: the plate already
  // pads the words, and a margin of its own on top of that pushed the
  // arrowheads so far out that the two halves of a dimension stopped
  // reading as one measurement.
  assert.deepStrictEqual(
    [cut.attrs.x, cut.attrs.y, cut.attrs.width, cut.attrs.height],
    ["95", "45", "90", "30"],
    "the cut is the label rect plus its margin");
  assert.ok(!("transform" in cut.attrs), "an unturned label cuts unturned");

  // A taller label earns a wider margin (60 * 0.14 = 8.4 > the floor).
  rect.setAttribute("height", 60);
  syncGap.call(self, shape, rect);
  assert.strictEqual(cut.attrs.y, String(50 - 60 * 0.14),
    "the margin scales with the label");
  assert.strictEqual(self._defs.children.length, 1,
    "re-syncing updates the one mask in place, never stacks another");

  // A heavy line keeps its daylight: half of it is already on the line
  // before the margin is counted, so the floor grows with the weight.
  // Without this a 14px shaft ate most of a small label's clearance —
  // and it is zoomed out, where labels shrink and the stroke does not,
  // that the difference shows.
  {
    const heavy = board();
    const fat = { uuid: "fat-1", el: fakeEl("g"), kind: "dimension",
                  style: { width: 14 } };
    syncGap.call(heavy, fat, fakeEl("rect", { x: 100, y: 50, width: 80, height: 20 }));
    const fatCut = heavy._defs.children[0].children[1];
    assert.strictEqual(fatCut.attrs.x, String(100 - (4 + 7)),
      "the floor is the daylight plus half the line's own thickness");
  }

  // A turned board turns the cut with the label.
  rect.setAttribute("transform", "rotate(90 140 60)");
  syncGap.call(self, shape, rect);
  assert.strictEqual(cut.attrs.transform, "rotate(90 140 60)",
    "the gap must sit askew of nothing — it turns with the words");

  // Label gone: the line closes up and the defs entry goes with it.
  clearGap.call(self, shape);
  assert.strictEqual(shape.el.getAttribute("mask"), null);
  assert.strictEqual(self._defs.children.length, 0,
    "a board that sheds labels must not accrete masks");
}

// ── a plain box works as well as a live rect ──────────────────────────────

{
  // The editor hands a {x, y, w, h} (the committed label's future box);
  // the render hands the live <rect>. Both must cut the same way.
  const self = board();
  const shape = { uuid: "boxed", el: fakeEl("g"), kind: "dimension" };
  syncGap.call(self, shape, { x: 100, y: 50, w: 80, h: 20 });
  const cut = self._defs.children[0].children[1];
  assert.deepStrictEqual(
    [cut.attrs.x, cut.attrs.y, cut.attrs.width, cut.attrs.height],
    ["95", "45", "90", "30"],
    "a plain box cuts exactly as the equivalent rect element does");

  syncGap.call(self, shape, { x: 100, y: 50, w: 80, h: 20, transform: "rotate(90 140 60)" });
  assert.strictEqual(cut.attrs.transform, "rotate(90 140 60)",
    "…and carries a turn the same way");
}

// ── two shafts, two masks — and drafts without a uuid are left alone ──────

{
  const self = board();
  const s1 = { uuid: "aaa", el: fakeEl("g"), kind: "dimension" };
  const s2 = { uuid: "bbb", el: fakeEl("g"), kind: "arrow" };
  const r = () => fakeEl("rect", { x: 0, y: 0, width: 10, height: 10 });
  syncGap.call(self, s1, r());
  syncGap.call(self, s2, r());
  assert.strictEqual(self._defs.children.length, 2);
  assert.notStrictEqual(s1.el.getAttribute("mask"), s2.el.getAttribute("mask"),
    "each shaft cuts around its OWN label");

  const draft = { uuid: null, el: fakeEl("g"), kind: "dimension" };
  syncGap.call(self, draft, r());
  assert.strictEqual(draft.el.getAttribute("mask"), null,
    "no uuid, no mask — drafts have no labels to clear space for");
}

// ── _renderTitleSibling drives both ends ──────────────────────────────────

{
  const start = src.indexOf("    _renderTitleSibling: function");
  const end = src.indexOf("\n    },", src.indexOf("      if (this._labelRidesShaft(shape.kind)) {\n        this._syncShaftLabelGap(shape, rectEl);", start));
  const body = src.slice(start, end);
  assert.ok(body.includes("this._syncShaftLabelGap(shape, rectEl);"),
    "a rendered shaft label must break its line");
  assert.ok(/if \(this\._labelRidesShaft\(shape\.kind\) &&\s+!\(this\._textEditor && this\._textEditor\.shape === shape\)\) \{\s+this\._clearShaftLabelGap\(shape\);/.test(body),
    "…and a removed one must close it back up — but NOT while its label " +
    "is being typed, or every repaint erases the break the editor set");
  const cleared = body.indexOf("_clearShaftLabelGap");
  const returned = body.indexOf("return;", body.indexOf("if (!trimmed || !bboxTopImage) {"));
  assert.ok(cleared !== -1 && cleared < returned,
    "the clear must run on the no-title exit, before the early return");
}

// ── the break happens WHILE TYPING, not only on commit ───────────────────

{
  // The editor's fit function (runs on every keystroke) must sync the
  // gap to the editor's own box for shaft-riding shapes. The text is the
  // line's colour, so an unbroken shaft runs straight through the words
  // while typing — and the break popping in only on commit read as the
  // line being deleted out from under the text at placement.
  const start = src.indexOf("      var edFit = function() {");
  assert.notStrictEqual(start, -1, "could not find the editor fit engine");
  const end = src.indexOf('input.addEventListener("input", edFit);', start);
  const fitBody = src.slice(start, end);
  assert.ok(fitBody.includes("selfEd._labelRidesShaft(shape.kind)") &&
            fitBody.includes("selfEd._syncShaftLabelGap(shape, {"),
    "the fit engine must break the shaft under the editor, live");
  // …to the box the COMMITTED label will occupy, not the editor's own:
  // the editor's is taller by the headroom its textarea needs, and
  // cutting to that made the gap settle visibly at Enter — and moved
  // where a diagonal shaft stopped.
  assert.ok(fitBody.includes("x: edCx - gapW / 2, y: edCy - gapH / 2"),
    "the typing break must be centred like the committed label");
  assert.ok(/gapH = Math\.max\(\s*edFontSize \+ \(linesEd\.length - 1\) \* edFontSize \* 1\.1 \+ edPad \* 2,\s*edFontSize \* 1\.2\s*\)/.test(fitBody),
    "…and sized by the render's own shrink-wrap formula");
}

console.log("shaft label gap: all checks passed");
