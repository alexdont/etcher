// Pins the movable tool bar: a grip drags it off whatever it covers, the
// move is an offset from its bottom-centre home kept in the `toolbar_offset`
// preference, and it is clamped back inside the container whenever the bar
// is laid out — so a bar left at the edge of a wide board is still on screen
// on a narrow one. Double-click / Home puts it back (head dev, 2026-11-11).
//
//   node test/js/toolbar_move_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");
const CHROME_MARGIN = Number(src.match(/var CHROME_MARGIN = (\d+);/)[1]);

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

// A bar 300 wide x 40 tall, at home bottom-centre of an 800 x 600 container
// (its box follows its transform's px offset; the -50% is the centring).
function board(savedOffset) {
  const prefs = { toolbar_offset: savedOffset };
  const container = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) };
  const bar = {
    style: { transform: "" },
    getBoundingClientRect() {
      const m = this.style.transform.match(/-50% - (-?\d+)px \+ (-?\d+)px\), (-?\d+)px/);
      const shift = m ? Number(m[1]) : 0, x = m ? Number(m[2]) : 0, y = m ? Number(m[3]) : 0;
      const left = 250 - shift + x, top = 544 + y;
      return { left, right: left + 300, top, bottom: top + 40, width: 300, height: 40 };
    },
  };
  return {
    prefs,
    toolbar: bar,
    handle: { container },
    handleKind: "canvas",
    stylePanel: null,
    positioned: 0,
    _getPref(k) { return prefs[k]; },
    _setPref(k, v) { prefs[k] = v; },
    _positionActionBar() { this.positioned++; },
    _liftViewerZoom() {},
    _toolbarOffset: extract("_toolbarOffset"),
    _setToolbarShift: extract("_setToolbarShift"),
    _moveToolbarTo: extract("_moveToolbarTo"),
  };
}

// ── home: no offset, no inline transform (the stylesheet centres it) ──────
{
  const b = board(undefined);
  b._setToolbarShift(0);
  assert.strictEqual(b.toolbar.style.transform, "");
}

// ── a saved offset is applied on layout ───────────────────────────────────
{
  const b = board({ x: -200, y: -300 });
  b._setToolbarShift(0);
  assert.strictEqual(b.toolbar.getBoundingClientRect().left, 50);
  assert.strictEqual(b.toolbar.getBoundingClientRect().top, 244);
}

// ── a drag moves it and re-parks what sits against it; the end saves ─────
{
  const b = board(undefined);
  b._moveToolbarTo(-100, -50, false);
  assert.strictEqual(b.toolbar.getBoundingClientRect().left, 150);
  assert.ok(b.positioned > 0, "the action bar follows the bar");
  assert.strictEqual(b.prefs.toolbar_offset, undefined, "nothing saved mid-drag");
  b._moveToolbarTo(-100, -50, true);
  assert.deepStrictEqual(b.prefs.toolbar_offset, { x: -100, y: -50 });
}

// ── it never leaves the container ─────────────────────────────────────────
{
  const b = board(undefined);
  b._moveToolbarTo(-5000, -5000, true);
  const t = b.toolbar.getBoundingClientRect();
  assert.strictEqual(t.left, CHROME_MARGIN, "held at the left margin");
  assert.strictEqual(t.top, CHROME_MARGIN, "and the top");
  assert.deepStrictEqual(b.prefs.toolbar_offset,
    { x: CHROME_MARGIN - 250, y: CHROME_MARGIN - 544 }, "the clamped place is what is saved");

  const right = board({ x: 4000, y: 0 });
  right._setToolbarShift(0);
  assert.strictEqual(right.toolbar.getBoundingClientRect().right, 800 - CHROME_MARGIN,
    "a place saved on a wider board is pulled back on this one");
}

// ── back home clears the preference ───────────────────────────────────────
{
  const b = board({ x: 40, y: -40 });
  b._moveToolbarTo(0, 0, true);
  assert.strictEqual(b.prefs.toolbar_offset, null);
  assert.strictEqual(b.toolbar.style.transform, "");
}

// ── the compact layout's shift for the style trigger still applies ────────
{
  const b = board({ x: 0, y: -100 });
  b._setToolbarShift(30);
  assert.strictEqual(b.toolbar.getBoundingClientRect().left, 220);
  assert.strictEqual(b.toolbar.getBoundingClientRect().top, 444);
}

// ── wired in: the grip is the bar's first child, layout re-applies it ─────
{
  const build = src.slice(src.indexOf('bar.className = "etcher-toolbar";'),
                          src.indexOf('bar.appendChild(self._makeToolButton("cursor"'));
  assert.ok(build.indexOf("bar.appendChild(self._makeToolbarGrip());") !== -1,
    "the grip leads the bar");
  const layout = src.slice(src.indexOf("    _layoutToolbar: function"),
                           src.indexOf("\n    },", src.indexOf("    _layoutToolbar: function")));
  assert.ok(layout.indexOf("this._setToolbarShift(") !== -1, "a resize re-clamps the bar");
  assert.strictEqual((src.match(/toolbar\.style\.transform =/g) || []).length, 0,
    "the transform has one writer, _setToolbarShift");
}

// ── the grip outranks the bar's button rule, so it spans the bar's height ──
{
  assert.ok(src.includes('".etcher-toolbar .etcher-toolbar-grip {"'),
    "grip rule qualified by the bar (beats .etcher-toolbar button's 36px square)");
  assert.ok(!src.includes('"  .etcher-toolbar-grip {"') && !/"\.etcher-toolbar-grip \{"/.test(src),
    "no bare grip rule left for the button rule to override");
  assert.ok(src.includes('".etcher-toolbar .etcher-toolbar-grip svg { width: 6px; height: 14px; }"'),
    "grip dots keep their own size");
}

console.log("Toolbar move: all checks passed");
