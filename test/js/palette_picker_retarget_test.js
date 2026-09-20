// Pins that an open colour picker follows the swatch you click.
//
// The five slots select a drawing colour on click and open the hue picker
// when you click the one already selected. What they did NOT do was let you
// move an OPEN picker to a different slot: the click landed outside the
// popup, the outside-click handler dismissed it on pointerdown, and the
// click then merely selected the slot. So editing a second colour meant
// clicking it, clicking it again, and — if you had already started dragging
// the wheel in between — watching the drag go nowhere, because there was no
// wheel any more. Reported as "I tried to change the first color and it
// didn't change until I click a different color and then it let me change
// it."
//
// The overflowed-slots row INSIDE the popup has always worked the right way
// ("select the slot but keep the picker open... re-aim the wheel"). This is
// the same rule on the panel's own swatches.
//
//   node test/js/palette_picker_retarget_test.js

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

const refreshSwatches = extract("_refreshToolbarSwatches");

// Enough DOM to build the real swatch row and click it.
function el() {
  const node = {
    style: {}, dataset: {}, children: [], _on: {},
    classList: {
      _set: new Set(),
      add(c) { node.classList._set.add(c); },
      remove(c) { node.classList._set.delete(c); },
      contains(c) { return node.classList._set.has(c); },
    },
    set className(v) { v.split(" ").filter(Boolean).forEach((c) => node.classList._set.add(c)); },
    get className() { return [...node.classList._set].join(" "); },
    setAttribute() {},
    addEventListener(name, fn) { node._on[name] = fn; },
    appendChild(k) { node.children.push(k); return k; },
    removeChild(k) { node.children.splice(node.children.indexOf(k), 1); },
    querySelector() { return el(); },
    get firstChild() { return node.children[0] || null; },
    click() { node._on.click({ preventDefault() {} }); },
  };
  return node;
}

const SLOTS = ["#111111", "#22aa22", "#3333ff", "#dddd00", "#ff00ff"];

// Build the row against a board in a given state, and hand back the
// swatches plus everything the handlers did.
function board(state) {
  global.document = { createElement: () => el() };
  const host = el();
  const log = { selected: [], reaimed: 0, opened: [], closed: 0, recolored: [] };
  const self = Object.assign({
    swatchHost: host,
    _colorSlots: SLOTS.slice(),
    _activeSlot: 0,
    _openPopupKind: null,
    _labelPickTarget: false,
    _labelBgPickTarget: false,
    _inspectedShape: () => null,
    _selectSlot(i) { this._activeSlot = i; log.selected.push(i); },
    _syncPickerToActiveColor() { log.reaimed++; },
    _openColorsForSwatch(i) { log.opened.push(i); },
    _closePopup() { log.closed++; this._openPopupKind = null; },
    _applyColorToTargets(c) { log.recolored.push(c); },
    _syncStyleInspector() {},
    _seedColorSlots() {},
    _refreshLabelSwatch() {},
    _currentLabelColor: () => "#ffffff",
    _currentLabelBg: () => null,
    _fontTargetShapes: () => [],
    _armedInkTool: () => false,
  }, state);

  refreshSwatches.call(self);
  delete global.document;
  return { self, log, swatches: self.swatchEls };
}

// ── the reported case: the picker moves to the slot you click ─────────────

{
  const { self, log, swatches } = board({ _activeSlot: 2, _openPopupKind: "colors" });
  swatches[4].click();

  assert.strictEqual(self._openPopupKind, "colors",
    "clicking another slot while the picker is up must not dismiss it — " +
    "that is the click that should have moved it");
  assert.strictEqual(log.closed, 0);
  assert.deepStrictEqual(log.selected, [4], "the clicked slot becomes the live one");
  assert.strictEqual(log.reaimed, 1, "…and the wheel is re-aimed at it, ready to drag");
  assert.deepStrictEqual(log.opened, [], "nothing is re-opened: it never closed");
}

// ── a picker aimed at the label colour is re-aimed, not closed ────────────

{
  // Same click, but the picker was opened from the label swatch. It is
  // pointed somewhere else entirely, so pointing it at the slot is exactly
  // what the click means — including when that slot is already the live
  // one, where the plain toggle below would otherwise close it.
  const { self, log, swatches } = board({
    _activeSlot: 1, _openPopupKind: "colors", _labelPickTarget: true,
  });
  swatches[1].click();

  assert.strictEqual(self._openPopupKind, "colors");
  assert.strictEqual(self._labelPickTarget, false,
    "the label target must be dropped, or the pick would still land on the label");
  assert.deepStrictEqual(log.selected, [1]);
  assert.strictEqual(log.reaimed, 1);
}

// ── clicking the slot the picker is already on still closes it ────────────

{
  const { log, swatches } = board({ _activeSlot: 3, _openPopupKind: "colors" });
  swatches[3].click();
  assert.deepStrictEqual(log.opened, [3],
    "the active swatch stays a toggle — _openColorsForSwatch closes an open picker");
  assert.deepStrictEqual(log.selected, [], "and it is already selected, so nothing moves");
}

// ── with the picker closed, a click still just selects ────────────────────

{
  const { log, swatches } = board({ _activeSlot: 0, _openPopupKind: null });
  swatches[2].click();
  assert.deepStrictEqual(log.selected, [2]);
  assert.deepStrictEqual(log.opened, [],
    "picking a colour to draw with must not pop a picker in the way");
}

// ── inspecting a shape: unchanged, the swatch recolours the selection ─────

{
  const shape = { style: { color: "#000000" } };
  const { log, swatches } = board({
    _activeSlot: 0, _openPopupKind: "colors", _inspectedShape: () => shape,
  });
  swatches[1].click();
  assert.deepStrictEqual(log.recolored, [SLOTS[1]],
    "a swatch click with a shape selected recolours the shape, as it always has");
  assert.deepStrictEqual(log.selected, [], "the palette selection stays put");
}

// ── and the dismissal that used to eat the click is exempted ──────────────

{
  // The other half. `_popupOutsideClick` fires on pointerdown, ahead of the
  // click above, so without an exemption it closes the picker first and the
  // handler above never sees an open one.
  const wire = src.slice(src.indexOf("      this._popupOutsideClick = function(e) {"),
                         src.indexOf("document.addEventListener(\"pointerdown\", this._popupOutsideClick, true);"));
  assert.ok(wire.includes('self._openPopupKind === "colors"') &&
            wire.includes('closest(".etcher-swatch")'),
    "a pointerdown on a palette swatch must not dismiss the open picker");
  assert.ok(wire.indexOf('closest(".etcher-swatch")') < wire.indexOf("self._closePopup();"),
    "…and the exemption has to come before the close, or it changes nothing");
}

console.log("palette picker retarget: all checks passed");
