// Etcher — annotation layer for Fresco-powered viewers.
//
// Drop a `<div phx-hook="EtcherLayer" data-fresco-id="...">` into your
// template (or, more typically, use the `<Etcher.layer>` Phoenix
// component) and this hook will:
//
//   1. Look up the named Fresco viewer via `window.Fresco.onViewerReady`.
//   2. Append a pencil button to the viewer's nav column via the
//      `handle.appendNavButton(...)` extension point (Fresco 0.2+).
//   3. Toggle a bottom toolbar with drawing tools when the pencil is
//      clicked.
//   4. Render shapes as an SVG overlay anchored to image pixel
//      coordinates — pan/zoom of the viewer rescales them for free.
//   5. Emit LiveView events (`etcher:created`, `:updated`, `:deleted`,
//      `:selected`) at each lifecycle moment so the consumer's LiveView
//      decides what to persist.
//
// Wire it once in your `app.js`:
//
//   import "../../deps/fresco/priv/static/fresco.js"
//   import "../../deps/etcher/priv/static/etcher.js"
//
//   let liveSocket = new LiveSocket("/live", Socket, {
//     hooks: { ...window.FrescoHooks, ...window.EtcherHooks, ...colocatedHooks }
//   });

(function() {
  if (window.EtcherLoaded) return;
  window.EtcherLoaded = true;

  // ===========================================================================
  // Public extension surface — `window.Etcher`
  //
  // Consumer-facing API surface, all optional. None of these need to be
  // set for a basic install to work — they're hooks for host apps and
  // future libraries to customize Etcher without forking.
  //
  //   window.Etcher.tooltipSlots = { header, body, footer }
  //     Override tooltip content per-slot. See "Customizing the tooltip"
  //     in the README. Returning null falls back to Etcher's default.
  //
  //   window.Etcher.colorSwatches = [{ key, color, title }, ...]
  //     Replace the color picker palette. Falls back to the bundled
  //     pastel rainbow + white + black if not set.
  //
  //   window.Etcher.defaultColor = "#93c5fd"
  //     Initial active color. Falls back to the first swatch's color.
  //
  //   window.Etcher.escapeHtml(value) → escaped string
  //     Stable escape helper consumer slot impls can reuse.
  //
  //   window.Etcher.layerFor(frescoId) → { ... } | null
  //     Programmatic control surface for a mounted layer. Returns null
  //     for unknown ids. Every built-in button / nav button delegates
  //     to a method on this object so consumers can drive the layer
  //     headlessly (e.g. render their own toolbar):
  //
  //       mode:        getMode(), setMode(on), toggleMode()
  //       visibility:  isVisible(), setVisible(on), toggleVisible()
  //       tool:        getTool(), selectTool(toolKey), tools(),
  //                    exitDrawing()  // alias for selectTool(null)
  //       color:       getColor(), setColor(c), swatches()
  //       palette:     getColors(), setColors([hex,...]),
  //                    setSlotColor(i, hex)   // 5 editable slots
  //       history:     undo(), redo(), canUndo(), canRedo()
  //       shapes:      getShapes(), getShape(uuid),
  //                    selectShape(uuid), unselectShape(),
  //                    enterEditMode(uuid), exitEditMode(),
  //                    deleteShape(uuid)
  //
  // Lifecycle CustomEvents are dispatched on the layer's host element
  // (the `<div phx-hook="EtcherLayer">`), bubbling up so consumers can
  // listen at any ancestor:
  //   etcher:tooltip-show / -hide / -pin / -unpin
  //   etcher:mode-changed       { detail: { annotationMode } }
  //   etcher:tool-changed       { detail: { tool } }
  //   etcher:color-changed      { detail: { color } }
  //   etcher:colors-changed     { detail: { colors } }  // slot palette edited; also pushed to LiveView
  //   etcher:visibility-changed { detail: { visible } }
  //   etcher:history-changed    { detail: { canUndo, canRedo } }
  // ===========================================================================

  window.Etcher = window.Etcher || {};
  window.Etcher.tooltipSlots = window.Etcher.tooltipSlots || {};

  // Registry of mounted layers, keyed by fresco_id. Populated on hook
  // mount, cleared on destroyed. `layerFor` reads this.
  var layerRegistry = {};

  window.Etcher.layerFor = function(frescoId) {
    var entry = layerRegistry[frescoId];
    return entry ? entry.api : null;
  };

  // Selectors for DOM nodes that own their own input. When a click /
  // pointerdown / dblclick lands inside one of these, Etcher's
  // doc-level hit-test handlers bail — otherwise the gesture would
  // shadow the owner's handler (a modal's button would never see its
  // own click, a tooltip's delete button would tear down its own
  // pin, etc.).
  //
  // The first five are Etcher's own internals. The last three cover
  // the established modal / dialog conventions so consumers don't
  // have to register their composer / settings / share-sheet
  // dialogs by hand:
  //
  //   dialog[open]       — native <dialog> shown via .showModal() / .show()
  //   .modal-open        — daisyUI / Bootstrap convention
  //   [role='dialog']    — ARIA-compliant custom modals
  //
  // Consumers shipping a non-conventional input-owning overlay can
  // append a selector via `Etcher.registerInputOwnerSelector(...)`.
  // The toolbar carries this many fixed, editable color slots. Clicking
  // a slot selects it; editing in the hue picker overwrites that slot's
  // color in place. The palette is seeded per-layer (the `data-colors`
  // attr, else `extensions.etcher.colors`, else the presets) and
  // persisted by the consumer through the `etcher:colors-changed` hook
  // — Etcher keeps no localStorage copy and never reorders the row.
  var COLOR_SLOTS = 5;

  var DEFAULT_INPUT_OWNER_SELECTORS = [
    ".etcher-handle",
    ".etcher-title-group",
    ".etcher-tooltip",
    ".etcher-toolbar",
    ".etcher-text-editor",
    ".etcher-popup",
    "dialog[open]",
    ".modal-open",
    "[role='dialog']"
  ];
  var inputOwnerSelectors = DEFAULT_INPUT_OWNER_SELECTORS.slice();
  var inputOwnerSelectorString = inputOwnerSelectors.join(", ");

  window.Etcher.registerInputOwnerSelector = function(selector) {
    if (typeof selector !== "string" || !selector.trim()) return;
    if (inputOwnerSelectors.indexOf(selector) !== -1) return;
    inputOwnerSelectors.push(selector);
    inputOwnerSelectorString = inputOwnerSelectors.join(", ");
  };

  function isInputOwner(target, overlayWrapper) {
    if (!target || typeof target.closest !== "function") return false;
    var match = target.closest(inputOwnerSelectorString);
    if (!match) return false;
    // A matched input-owner that contains our own overlay isn't a modal
    // "over us" — Etcher is rendered INSIDE that container (e.g. a daisyUI
    // `.modal-open` photo viewer). Don't gate: the cursor is genuinely over
    // our canvas, not over a separate modal layered above it.
    if (overlayWrapper && match.contains(overlayWrapper)) return false;
    return true;
  }

  // ===========================================================================
  // Icons (Heroicons, outline, 24×24, stroke="currentColor")
  // ===========================================================================

  var ICONS = {
    pencil:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"/></svg>',
    trash:    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>',
    paperclip:'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/></svg>',
    cursor:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4 11.07 21l2.51-7.39L20.97 11.1 4 4Z"/></svg>',
    undo:     '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-4"/></svg>',
    redo:     '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 15l5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h4"/></svg>',
    // Heroicons eye / eye-slash.
    eye:      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
    eyeSlash: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 11.683a1.012 1.012 0 0 0 0 .639C3.423 16.49 7.36 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639a10.51 10.51 0 0 1-4.193 5.371M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>',
    rectangle:'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>',
    circle:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>',
    polygon:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3.5 21 9.5 18 20H6L3 9.5 12 3.5Z"/></svg>',
    freehand: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17.25c2-2 3-4 5-4s2.5 2 4.5 2 3-2 5-2 2.5 1 3.5 1"/></svg>',
    // Callout / leader line — small filled dot at the anchor, a thin
    // diagonal line, and a sample "T" at the text endpoint. Mimics
    // the blueprint-callout shape so the toolbar icon advertises what
    // the tool draws.
    // Callout — anchor dot at the bottom-left, leader line up to the
    // bottom-left of an underlined "Aa" label. Mirrors the shape the
    // tool now draws (leader + underline + text bbox) so the toolbar
    // button matches the on-canvas output.
    callout:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3.5" cy="20" r="1.5" fill="currentColor" stroke="none"/><path d="M4 19.5 L8.5 14 L21 14"/><text x="9" y="13" font-size="9.5" font-weight="700" fill="currentColor" stroke="none">Aa</text></svg>',
    // Text tool — bold, serif-less "T" so the button reads cleanly at
    // toolbar sizes (the previous version had pinched serifs that
    // muddied the silhouette).
    text:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6 L19 6 M12 6 L12 18"/></svg>',
    // Dimension — horizontal shaft with V-arrows on both ends. Mirrors
    // the architectural dimension-line annotation the tool draws (line
    // + 2 arrows + black label sliding along the shaft).
    dimension:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12 L19 12 M5 12 L8 9 M5 12 L8 15 M19 12 L16 9 M19 12 L16 15"/></svg>',
    // Line — bare diagonal stroke. The line annotation is the
    // arrow-and-label-free sibling of dimension: same two-endpoint
    // geometry, title rendered via the standard sibling-above-shape
    // path (not inline on the line).
    line:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19 L19 5"/></svg>',
    close:    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>',
    // Three horizontal dots — overflow / "more" trigger in the
    // compact mobile toolbar. Heroicons solid `EllipsisHorizontal`.
    more:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>',
    // Artist's palette — the colors `[⋯]` trigger (opens the picker).
    palette: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21a9 9 0 1 1 0-18 9 8 0 0 1 9 8 4.5 4 0 0 1-4.5 4H14a2 2 0 0 0-1 3.75A1.3 1.3 0 0 1 12 21Z"/><circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/></svg>'
  };

  // ===========================================================================
  // Styles
  // ===========================================================================

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css = [
      ".etcher-toolbar {",
      "  position: absolute; left: 50%; bottom: 16px;",
      "  transform: translateX(-50%); z-index: 11;",
      "  display: none; gap: 6px; padding: 6px;",
      "  background: rgba(0, 0, 0, 0.7); border-radius: 10px;",
      "  pointer-events: auto;",
      "}",
      // Strip mode: the scroll container IS the scrolling element, so
      // anchor the toolbar to the viewport instead of the container.
      // Otherwise it scrolls out of view with the content.
      ".etcher-toolbar[data-strip] {",
      "  position: fixed; bottom: 16px;",
      "}",
      // Strip mode + drawing tool active: suppress native scroll on
      // the strip container so iOS Safari hands every touchmove to
      // the app instead of claiming the gesture for the scroller.
      // Without this, finger-drawing on iOS commits a single
      // oversized shape spanning from finger-down to finger-up
      // (the OS classifies the gesture as scroll at touchstart,
      // before `pointerdown` runs, so `preventDefault` arrives too
      // late). Cursor mode (annotation mode + no drawing tool)
      // keeps `touch-action: auto` so the reader can still scroll
      // the chapter to reach existing shapes.
      ".etcher-strip-drawing { touch-action: none; }",
      // Vertex / midpoint handles + the actively-edited or actively-
      // dragging shape body all need `touch-action: none` for the
      // same reason as the draw-tool fix above: without it, the
      // iOS scroll classifier claims the gesture at `touchstart`
      // (before our `pointerdown` + `setPointerCapture` runs) and
      // the user's drag becomes a page scroll. Scoped to interactive
      // states only so static shapes don't block native scroll
      // past them.
      ".etcher-handle, .etcher-handle-midpoint,",
      ".etcher-shape.is-editing, .etcher-shape.is-moving {",
      "  touch-action: none;",
      "}",
      ".etcher-toolbar.is-active { display: flex; }",
      ".etcher-toolbar button {",
      "  width: 36px; height: 36px;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  border: none; padding: 0; cursor: pointer;",
      "  background: transparent; color: #fff; border-radius: 6px;",
      "  transition: background 120ms ease;",
      "}",
      ".etcher-toolbar button:hover { background: rgba(255, 255, 255, 0.12); }",
      ".etcher-toolbar button.is-selected { background: rgba(255, 255, 255, 0.24); }",
      ".etcher-toolbar button:disabled {",
      "  opacity: 0.35; cursor: not-allowed;",
      "}",
      ".etcher-toolbar button:disabled:hover { background: transparent; }",
      ".etcher-toolbar button:focus-visible {",
      "  outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 1px;",
      "}",
      ".etcher-toolbar svg { width: 18px; height: 18px; }",
      // The colors palette trigger gets a larger glyph so it reads
      // clearly as the color picker rather than a tiny mark.
      ".etcher-toolbar .etcher-more[data-more='colors'] svg { width: 24px; height: 24px; }",
      ".etcher-toolbar .etcher-divider {",
      "  width: 1px; background: rgba(255, 255, 255, 0.2); margin: 4px 2px;",
      "}",
      // Color swatches — small circles inline in the toolbar. Picked
      // swatch gets a white ring so the choice is visible even when
      // the swatch is pastel-blue and the highlight is subtle.
      ".etcher-swatch {",
      "  width: 22px; height: 22px; border-radius: 999px;",
      "  border: 1px solid rgba(255, 255, 255, 0.4); padding: 0;",
      "  cursor: pointer; transition: transform 80ms ease;",
      "}",
      ".etcher-swatch:hover { transform: scale(1.15); }",
      ".etcher-swatch.is-selected {",
      "  box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(0, 0, 0, 0.5);",
      "}",
      // The progressive-overflow `[⋯]` buttons. Hidden by default;
      // `_layoutToolbar` toggles `.is-active` when at least one
      // tool or swatch had to be collapsed into the popup. The
      // popups they trigger are positioned absolutely against the
      // toolbar's container.
      // Scoped under `.etcher-toolbar` so these beat the generic
      // `.etcher-toolbar button { display: inline-flex }` rule above
      // (0,2,0 / 0,3,0 vs 0,1,1) — otherwise the `[⋯]` trigger would
      // stay visible regardless of `.is-active` and open an empty popup
      // when nothing actually overflowed.
      ".etcher-toolbar .etcher-more {",
      "  display: none;",
      "}",
      ".etcher-toolbar .etcher-more.is-active {",
      "  display: inline-flex;",
      "}",
      // The colors `[⋯]` is the permanent entry to the hue-wheel picker,
      // not just a swatch-overflow indicator — so it's always visible,
      // independent of `.is-active`. (The tools `[⋯]` stays overflow-
      // gated above.)
      ".etcher-toolbar .etcher-more[data-more='colors'] {",
      "  display: inline-flex;",
      "}",
      ".etcher-popup {",
      "  position: absolute; z-index: 12; display: none;",
      "  background: rgba(0, 0, 0, 0.85); border-radius: 10px;",
      "  padding: 6px; gap: 6px; pointer-events: auto;",
      "  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);",
      "}",
      ".etcher-popup.is-open { display: flex; flex-wrap: wrap; }",
      // Tools popup: 5-col grid so 9 tools + cursor fit in 2 rows.
      ".etcher-popup[data-kind=\"tools\"] { width: 222px; }",
      // Colors popup: row of preset swatches + recents row + custom
      // picker. Fixed width so the hue ring lays out predictably and
      // the popup doesn't jitter when recents toggle visibility.
      ".etcher-popup[data-kind=\"colors\"] {",
      "  width: 192px; align-items: center;",
      "}",
      ".etcher-popup button[data-tool] {",
      "  width: 36px; height: 36px; border: none; padding: 0;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  background: transparent; color: #fff; border-radius: 6px;",
      "  cursor: pointer; transition: background 120ms ease;",
      "}",
      ".etcher-popup button[data-tool]:hover {",
      "  background: rgba(255, 255, 255, 0.12);",
      "}",
      ".etcher-popup button[data-tool].is-selected {",
      "  background: rgba(255, 255, 255, 0.24);",
      "}",
      ".etcher-popup button[data-tool] svg { width: 18px; height: 18px; }",
      ".etcher-popup .etcher-swatch { width: 26px; height: 26px; }",
      // Full-width hairline divider used inside flex-wrap popups to
      // force the items after it onto a new row + visually section
      // them off (e.g., \"history\" buttons below the tools grid).
      ".etcher-popup-divider {",
      "  flex: 0 0 100%; height: 1px; margin: 4px 0;",
      "  background: rgba(255, 255, 255, 0.15);",
      "}",
      // History buttons share the tool-button visual but carry a
      // distinct data attribute so the layout logic can target them.
      ".etcher-popup button[data-history] {",
      "  width: 36px; height: 36px; border: none; padding: 0;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  background: transparent; color: #fff; border-radius: 6px;",
      "  cursor: pointer; transition: background 120ms ease;",
      "}",
      ".etcher-popup button[data-history]:hover {",
      "  background: rgba(255, 255, 255, 0.12);",
      "}",
      ".etcher-popup button[data-history]:disabled {",
      "  opacity: 0.35; cursor: not-allowed;",
      "}",
      ".etcher-popup button[data-history]:disabled:hover {",
      "  background: transparent;",
      "}",
      ".etcher-popup button[data-history] svg { width: 18px; height: 18px; }",
      // -- Custom color picker (hue ring + lightness slider) ----------------
      // The whole picker takes a single full-width row inside the
      // colors popup. Layout: hue ring on top, lightness slider +
      // preview swatch below it.
      ".etcher-picker {",
      "  flex: 0 0 100%;",
      "  display: flex; flex-direction: column;",
      "  align-items: center; gap: 8px;",
      "  padding: 4px 2px 2px;",
      "}",
      // Preset swatches inside the picker — horizontal row tucked
      // above the hue ring as bootstrap colors. Same swatch styling
      // as the recents row.
      ".etcher-presets {",
      "  display: flex; gap: 6px; flex-wrap: wrap;",
      "  align-items: center; justify-content: center;",
      "  padding: 0 2px;",
      "}",
      ".etcher-picker-ring-wrap {",
      "  position: relative; line-height: 0;",
      "}",
      ".etcher-picker-ring {",
      "  display: block; cursor: pointer;",
      "  touch-action: none;",
      "}",
      // Small filled dot that tracks the picked hue on the ring.
      // Position is updated via inline `left`/`top` in JS; transform
      // centers it on its anchor coords.
      ".etcher-picker-ring-knob {",
      "  position: absolute; width: 12px; height: 12px;",
      "  border: 2px solid #fff; border-radius: 999px;",
      "  box-shadow: 0 0 0 1px rgba(0,0,0,0.6);",
      "  transform: translate(-50%, -50%);",
      "  pointer-events: none;",
      "}",
      ".etcher-picker-slider-row {",
      "  display: flex; align-items: center; gap: 8px;",
      "  width: 100%;",
      "}",
      ".etcher-picker-slider-wrap {",
      "  position: relative; flex: 1; line-height: 0;",
      "}",
      ".etcher-picker-slider {",
      "  display: block; width: 100%; height: 14px;",
      "  border-radius: 8px; cursor: pointer;",
      "  touch-action: none;",
      "}",
      ".etcher-picker-slider-knob {",
      "  position: absolute; top: 50%;",
      "  width: 10px; height: 18px;",
      "  border: 2px solid #fff; border-radius: 4px;",
      "  box-shadow: 0 0 0 1px rgba(0,0,0,0.6);",
      "  transform: translate(-50%, -50%);",
      "  pointer-events: none;",
      "}",
      // Preview chip — solid swatch showing the currently picked
      // color. Sized to match the in-toolbar swatches so the
      // \"this is your color\" affordance is consistent.
      ".etcher-picker-preview {",
      "  width: 22px; height: 22px; border-radius: 999px;",
      "  border: 1px solid rgba(255, 255, 255, 0.4);",
      "  flex: 0 0 auto;",
      "}",
      // -- Recent custom colors row ----------------------------------------
      // Lives between the preset swatches and the picker. The row
      // itself collapses (display:none) when there are zero recents.
      ".etcher-recents {",
      "  flex: 0 0 100%;",
      "  display: flex; gap: 6px; flex-wrap: wrap;",
      "  align-items: center; padding: 0 2px;",
      "}",
      ".etcher-recents.is-empty { display: none; }",
      ".etcher-recents-label {",
      "  font-size: 10px; letter-spacing: 0.05em;",
      "  text-transform: uppercase;",
      "  color: rgba(255, 255, 255, 0.55);",
      "  margin-right: 2px;",
      "}",
      // Compact mode: below the `sm` breakpoint, hide everything in
      // the toolbar except the currently-active tool, undo/redo, the
      // currently-active swatch, the close button, and the two
      // overflow triggers. Dividers and the standalone cursor button
      // collapse — cursor moves into the tools popup as a regular
      // option.
      // Progressive overflow: `_layoutToolbar` walks the tool buttons
      // right-to-left and tags overflowed ones with `.etcher-overflow-
      // hidden` until the toolbar fits its container. Same path runs
      // for swatches when the tools group alone can't free enough
      // space. The active tool / swatch is pinned — it never collapses
      // into the popup, so the user always knows what's selected.
      ".etcher-toolbar .etcher-overflow-hidden { display: none !important; }",
      ".etcher-overlay {",
      "  position: absolute; inset: 0; pointer-events: none;",
      "}",
      ".etcher-overlay.is-drawing { cursor: crosshair; }",
      // Document-level hit-test marks the overlay with this class
      // when the cursor is over a shape, so the cursor changes to a
      // pointer without the SVG itself catching events (which would
      // block OSD's wheel + drag-pan from reaching the canvas below).
      ".etcher-overlay.is-shape-hovered { cursor: pointer; }",
      ".etcher-shape {",
      "  fill: rgba(59, 130, 246, 0.12); stroke: #3b82f6;",
      // Shapes are non-interactive at the DOM level — `pointer-events:
      // none` lets every mouse/wheel/touch event fall through to OSD's
      // canvas sibling, so scroll-zoom and click-drag pan work even
      // when the cursor is over an annotation. Hover styling, tooltips,
      // and click-to-edit are driven by document-level mousemove +
      // pointerdown listeners (`_wireGlobalShapeListeners`) that
      // hit-test the cursor against `self.shapes` in image-px space.
      "  pointer-events: none;",
      "}",
      // EXCEPT: the shape currently in edit mode catches pointer
      // events on its painted body so a click-drag from inside the
      // shape moves it (`_startShapeMove`). The user is actively
      // editing this one — they'd rather drag than pan past it; the
      // non-editing siblings stay pointer-events: none so pan/zoom
      // works everywhere else.
      ".etcher-shape.is-editing {",
      "  pointer-events: visiblePainted;",
      "}",
      // Reveal-pulse: a brief halo flash triggered by
      // `handle.revealShape(uuid, { pulse: true })` so users
      // can spot the just-navigated-to shape against a busy page.
      // Uses currentColor's outer drop-shadow over the existing
      // fill / stroke; doesn't disturb the shape's geometry, so
      // pointer-events behavior is unchanged.
      ".etcher-shape--pulse {",
      "  animation: etcher-shape-pulse 1.5s ease-out;",
      "}",
      "@keyframes etcher-shape-pulse {",
      "  0%   { filter: drop-shadow(0 0 0    rgba(59, 130, 246, 0.0)); }",
      "  20%  { filter: drop-shadow(0 0 14px rgba(59, 130, 246, 0.95)); }",
      "  60%  { filter: drop-shadow(0 0 10px rgba(59, 130, 246, 0.55)); }",
      "  100% { filter: drop-shadow(0 0 0    rgba(59, 130, 246, 0.0)); }",
      "}",
      // Callout: the <g> container picks up `color` (default blue,
      // overridden by the picker via `style.color`); children resolve
      // `currentColor` against it. Text gets a subtle white halo so
      // it stays readable over busy image regions.
      ".etcher-callout { color: #3b82f6; }",
      ".etcher-callout text {",
      "  paint-order: stroke fill;",
      "  stroke: rgba(255, 255, 255, 0.9);",
      "  stroke-width: 3;",
      "  stroke-linejoin: round;",
      "}",
      // Text shape — bordered box (visible only when hovered/selected/
      // editing) wrapping a content <text> that fills the box. Border
      // inherits the shape's color via currentColor. Default state is
      // text-only (no border) so the label looks freestanding.
      ".etcher-text { color: #3b82f6; }",
      ".etcher-text .etcher-text-rect {",
      "  fill: transparent; stroke: transparent;",
      "  pointer-events: all;",
      "  transition: stroke 120ms ease, fill 120ms ease;",
      "}",
      ".etcher-text.is-hovered .etcher-text-rect,",
      ".etcher-text.is-selected .etcher-text-rect,",
      ".etcher-text.is-editing .etcher-text-rect,",
      ".etcher-text.is-draft   .etcher-text-rect {",
      "  stroke: currentColor;",
      "  stroke-dasharray: 5 4;",
      "}",
      ".etcher-text .etcher-text-content,",
      ".etcher-text .etcher-text-content tspan {",
      "  fill: currentColor;",
      "  stroke: rgba(255, 255, 255, 0.95);",
      "  stroke-width: 2;",
      "  stroke-linejoin: round;",
      "  paint-order: stroke fill;",
      "  pointer-events: none;",
      "  user-select: none;",
      "}",
      // The foreignObject editor sits above the shape — its inner
      // <input> handles its own focus/blur, but a fallback z-index keeps
      // it clear of any overlapping shape.
      ".etcher-text-editor { z-index: 10; }",
      // Eraser mid-sweep: shapes the cursor has touched get
      // de-saturated + dimmed so the user can see what's about to
      // disappear when they release.
      ".etcher-shape.is-erasing,",
      ".etcher-title-group.is-erasing {",
      "  opacity: 0.35; filter: grayscale(1);",
      "  transition: opacity 80ms ease, filter 80ms ease;",
      "}",
      // Title group: a satellite text bbox attached to a parent shape.
      // Cursor changes to "grab" so users know they can drag it; the
      // leader line stays subtle so the parent shape remains the
      // primary visual.
      ".etcher-title-group { cursor: grab; }",
      ".etcher-title-group.is-dragging { cursor: grabbing; }",
      ".etcher-title-leader {",
      "  stroke-dasharray: 3 3;",
      "  opacity: 0.6;",
      "  pointer-events: none;",
      "}",
      // Inline title text for non-callout shapes. Rendered as a sibling
      // `<text>` of the shape (not a child) so it doesn't inherit the
      // shape's fill/stroke. Uses currentColor so `_applyShapeColor` can
      // recolor by setting style.color on the title element. White halo
      // matches the callout text for readability over busy media.
      ".etcher-title {",
      "  font-size: 12px;",
      "  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;",
      "  font-weight: 500;",
      "  fill: currentColor;",
      "  stroke: rgba(255, 255, 255, 0.9);",
      "  stroke-width: 3;",
      "  paint-order: stroke fill;",
      "  stroke-linejoin: round;",
      "  pointer-events: none;",
      "  color: #3b82f6;",
      "  user-select: none;",
      "}",
      // While a drawing tool is active, shapes step out of the way so a
      // drag started over an existing shape opens a new one instead of
      // getting trapped by the shape's pointer-events.
      ".etcher-overlay.is-drawing .etcher-shape {",
      "  pointer-events: none; cursor: crosshair;",
      "}",
      // Draft + edit share the same orange styling so the user has a
      // single visual language for "this shape is currently mine".
      ".etcher-shape.is-draft {",
      "  pointer-events: none;",
      "  stroke: #f59e0b; stroke-dasharray: 5 4;",
      "  fill: rgba(245, 158, 11, 0.15);",
      "}",
      ".etcher-shape.is-hovered {",
      "  fill: rgba(59, 130, 246, 0.22); stroke-width: 3;",
      "}",
      ".etcher-shape.is-selected {",
      "  stroke: #f59e0b; fill: rgba(245, 158, 11, 0.18);",
      "}",
      ".etcher-shape.is-editing {",
      "  stroke: #f59e0b; stroke-dasharray: 5 4;",
      "  fill: rgba(245, 158, 11, 0.12);",
      "  cursor: grab;",
      "}",
      ".etcher-shape.is-editing.is-moving { cursor: grabbing; }",
      // Multi-selection (shift-click) — distinct from `.is-editing` so
      // a shape that's part of a multi-selection doesn't grow vertex
      // handles. Solid orange stroke + a soft glow reads as
      // \"grouped\" without competing with the dashed edit-mode stroke.
      ".etcher-shape.is-multi-selected {",
      "  stroke: #f59e0b; stroke-width: 3;",
      "  fill: rgba(245, 158, 11, 0.16);",
      "  filter: drop-shadow(0 0 3px rgba(245, 158, 11, 0.7));",
      "}",
      ".etcher-shape.is-multi-selected.is-moving { cursor: grabbing; }",
      ".etcher-handle {",
      // Stroke + interactive fills bind to `currentColor` so a handle
      // inherits the shape's painted color (set via `style.color`
      // when the handle is created). Defaults to the inherited
      // element color (blue) when no custom color is picked.
      "  fill: #fff; stroke: currentColor; stroke-width: 2;",
      "  pointer-events: auto; cursor: grab;",
      // `transform-box: fill-box` anchors `transform-origin` to the
      // element's own box rather than the SVG viewport, so `scale()`
      // grows the dot around its own center instead of warping it
      // toward (0, 0). Bumping `transform` rather than `r` because
      // CSS-set `r` doesn't always win over the attribute-set `r="5"`
      // across all browsers.
      "  transform-box: fill-box; transform-origin: center;",
      "  transition: transform 80ms ease, stroke-width 80ms ease, fill 80ms ease, fill-opacity 80ms ease;",
      "}",
      ".etcher-handle:hover {",
      "  transform: scale(1.6); stroke-width: 3;",
      "  fill: currentColor; fill-opacity: 0.35;",
      "}",
      ".etcher-handle.is-dragging {",
      "  cursor: grabbing; transform: scale(1.8); stroke-width: 3;",
      "  fill: currentColor; fill-opacity: 0.55;",
      "}",
      // Vertex selected (click without drag). Highlights the vertex so
      // the user can see which point Backspace / Delete will remove.
      // Red outline reads as \"about to delete\" without making the
      // dot disappear on the canvas.
      ".etcher-handle.is-selected {",
      "  stroke: #dc2626; stroke-width: 3;",
      "  fill: #dc2626; fill-opacity: 0.45;",
      "  transform: scale(1.6);",
      "}",
      // While drafting a polygon the first vertex doubles as the close
      // button — highlight it when the cursor is near so the user knows
      // a click there finishes the shape. Same look as `:hover` for
      // consistency.
      ".etcher-handle.is-close-target {",
      "  transform: scale(1.6); stroke-width: 3;",
      "  fill: currentColor; fill-opacity: 0.4;",
      "}",
      // Freehand pen editor: thin tether from each anchor to its bezier
      // control dots, and the control dots themselves (smaller + filled so
      // they read as "handles" distinct from the white anchor dots). A
      // corner anchor is shaded to set it apart from a smooth (white) one.
      ".etcher-handle-line {",
      "  stroke: currentColor; stroke-width: 1.25; stroke-opacity: 0.6;",
      "  fill: none; pointer-events: none;",
      "}",
      ".etcher-bezier-handle {",
      "  fill: currentColor; fill-opacity: 0.85; stroke: #fff; stroke-width: 1.5;",
      "  pointer-events: auto; cursor: grab;",
      "  transform-box: fill-box; transform-origin: center;",
      "  transition: transform 80ms ease;",
      "}",
      ".etcher-bezier-handle:hover { transform: scale(1.5); }",
      ".etcher-bezier-handle.is-dragging { cursor: grabbing; transform: scale(1.7); }",
      ".etcher-anchor-handle.is-corner { fill: currentColor; fill-opacity: 0.5; }",
      // Midpoint "ghost" dot for polygon edges — faintly visible
      // whenever the polygon is in edit mode, so the user can see at
      // a glance where a new vertex would land. Fades to full
      // opacity on direct hover. Cursor: copy hints "click to add".
      ".etcher-handle-midpoint {",
      "  fill: currentColor; fill-opacity: 0;",
      "  stroke: currentColor; stroke-width: 2; stroke-opacity: 0;",
      "  pointer-events: all; cursor: copy;",
      "  transition: stroke-opacity 80ms ease, fill-opacity 80ms ease, transform 80ms ease;",
      "}",
      // `.is-active` is set on the closest midpoint to the cursor by
      // `_updateClosestMidpoint`. Only one shows at a time so the
      // polygon's edges don't get crowded with dots.
      ".etcher-handle-midpoint.is-active {",
      "  fill-opacity: 0.2; stroke-opacity: 0.85;",
      "}",
      ".etcher-handle-midpoint:hover {",
      "  stroke-opacity: 1;",
      "  fill: currentColor; fill-opacity: 0.35;",
      "  transform: scale(1.4); stroke-width: 2;",
      "}",
      ".etcher-handle-midpoint.is-dragging {",
      "  stroke-opacity: 1;",
      "  fill: currentColor; fill-opacity: 0.55;",
      "  transform: scale(1.6); stroke-width: 2;",
      "}",
      // Rectangle edge "grabbers" — small rounded rect aligned along
      // the edge. Different visual + cursor from polygon midpoints
      // (`+`/copy) so the UX reads as "drag this edge to resize",
      // not "add a vertex here". Same closest-only highlight via
      // `.is-active` driven by `_updateClosestMidpoint`.
      ".etcher-handle-edge {",
      "  fill: currentColor; fill-opacity: 0;",
      "  stroke: currentColor; stroke-width: 1.25; stroke-opacity: 0;",
      "  pointer-events: all;",
      "  transition: stroke-opacity 80ms ease, fill-opacity 80ms ease, transform 80ms ease;",
      "}",
      ".etcher-handle-edge--h { cursor: ns-resize; }",
      ".etcher-handle-edge--v { cursor: ew-resize; }",
      ".etcher-handle-edge.is-active {",
      "  fill-opacity: 0.35; stroke-opacity: 0.9;",
      "}",
      ".etcher-handle-edge:hover {",
      "  fill-opacity: 0.7; stroke-opacity: 1;",
      "  transform: scale(1.1);",
      "}",
      ".etcher-handle-edge.is-dragging {",
      "  fill-opacity: 0.85; stroke-opacity: 1;",
      "  transform: scale(1.15);",
      "}",
      // While a drawing tool is active, vector dots on the in-progress
      // draft are markers, not grab targets — let pointer events fall
      // through to the wrapper so the user can keep dragging the
      // active tool over them.
      ".etcher-overlay.is-drawing .etcher-handle {",
      "  pointer-events: none; cursor: crosshair;",
      "}",
      ".etcher-tooltip {",
      // pointer-events: auto so the user can move from shape to tooltip
      // and interact with the delete button. The tooltip is positioned
      // above the shape so it doesn't normally block hover on the shape
      // itself.
      "  position: absolute; z-index: 12; pointer-events: auto;",
      "  background: rgba(0, 0, 0, 0.85); color: #fff;",
      "  padding: 6px 10px; border-radius: 6px;",
      "  font-size: 12px; line-height: 1.35; max-width: 260px;",
      "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);",
      "  display: none;",
      "}",
      ".etcher-tooltip-header {",
      "  display: flex; align-items: center; gap: 10px;",
      "}",
      ".etcher-tooltip-kind {",
      "  font-weight: 600; text-transform: capitalize; flex: 1;",
      "}",
      ".etcher-tooltip-delete {",
      "  background: rgba(255, 255, 255, 0.08); border: none;",
      "  color: rgba(252, 165, 165, 0.95);",
      "  width: 24px; height: 24px; padding: 0;",
      "  border-radius: 4px; cursor: pointer;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  transition: background 120ms ease, color 120ms ease;",
      "}",
      ".etcher-tooltip-delete:hover {",
      "  background: rgba(239, 68, 68, 0.32); color: #fff;",
      "}",
      ".etcher-tooltip-delete:focus-visible {",
      "  outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 1px;",
      "}",
      ".etcher-tooltip-delete svg { width: 14px; height: 14px; }",
      // Opt-in styling primitives consumers can use inside their
      // `tooltipSlots.body` HTML — Etcher's defaults don't apply
      // these automatically, so a consumer slot returning plain HTML
      // is laid out plainly. Used as `<div class="etcher-tooltip-body">`
      // → flex row with thumb + text columns.
      ".etcher-tooltip-body {",
      "  display: flex; gap: 8px; margin-top: 6px; max-width: 260px;",
      "}",
      ".etcher-tooltip-thumb {",
      "  flex: 0 0 40px; width: 40px; height: 40px;",
      "  border-radius: 4px; object-fit: cover;",
      "  background: rgba(255, 255, 255, 0.08);",
      "}",
      // Paperclip fallback when the comment has an attachment but no
      // image thumbnail to render. Same 40x40 box; centered icon.
      ".etcher-tooltip-thumb-icon {",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  color: rgba(255, 255, 255, 0.85);",
      "}",
      ".etcher-tooltip-thumb-icon svg { width: 20px; height: 20px; }",
      ".etcher-tooltip-text { flex: 1; min-width: 0; }",
      ".etcher-tooltip-quote {",
      "  font-style: italic; opacity: 0.9;",
      "  display: -webkit-box; -webkit-box-orient: vertical;",
      "  -webkit-line-clamp: 2; overflow: hidden;",
      "  word-break: break-word;",
      "}",
      // Date · count subheader, sits between the header and the
      // comment body. Subtle so it doesn't compete with the comment
      // preview's actual content.
      ".etcher-tooltip-meta {",
      "  margin-top: 2px; opacity: 0.7; font-size: 11px;",
      "}",
      // Cross-component highlight: when an annotation is pinned, any
      // element in the document carrying `data-annotation-uuid="<uuid>"`
      // (typically a comment row in the consumer's discussion thread)
      // glows orange so the user can see the linked context at the
      // same time. The selector is generic — a consumer just needs to
      // stamp `data-annotation-uuid` on the element it wants
      // highlighted; no Etcher-side wiring required.
      ".etcher-comment-highlight {",
      "  outline: 2px solid #f59e0b; outline-offset: 2px;",
      "  border-radius: 0.5rem;",
      "  background-color: rgba(245, 158, 11, 0.12);",
      "  transition: background-color 200ms ease, outline-color 200ms ease;",
      "}"
    ].join("\n");

    var style = document.createElement("style");
    style.setAttribute("data-etcher", "");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ===========================================================================
  // Tool descriptors
  // ===========================================================================

  var TOOL_DEFS = {
    rectangle: { icon: ICONS.rectangle, title: "Rectangle" },
    circle:    { icon: ICONS.circle,    title: "Circle" },
    polygon:   { icon: ICONS.polygon,   title: "Polygon (double-click to close)" },
    freehand:  { icon: ICONS.freehand,  title: "Freehand" },
    callout:   { icon: ICONS.callout,   title: "Callout (point at something, write a label)" },
    text:      { icon: ICONS.text,      title: "Text label (drag a box, then type)" },
    dimension: { icon: ICONS.dimension, title: "Dimension (line with arrows + slidable label)" },
    line:      { icon: ICONS.line,      title: "Line" },
    eraser:    { icon: ICONS.trash,     title: "Eraser (click and drag to wipe shapes)" }
  };

  // Default color palette — pastel rainbow plus monochrome bookends.
  // Consumers override via `window.Etcher.colorSwatches`. The default
  // active color is the blue pastel so the picker has a non-empty
  // selected state on first open; consumers override via
  // `window.Etcher.defaultColor`.
  var DEFAULT_COLOR_SWATCHES = [
    { key: "red",    color: "#fca5a5", title: "Red" },
    { key: "orange", color: "#fdba74", title: "Orange" },
    { key: "yellow", color: "#fde68a", title: "Yellow" },
    { key: "green",  color: "#86efac", title: "Green" },
    { key: "blue",   color: "#93c5fd", title: "Blue" },
    { key: "indigo", color: "#a5b4fc", title: "Indigo" },
    { key: "violet", color: "#d8b4fe", title: "Violet" },
    { key: "white",  color: "#ffffff", title: "White" },
    { key: "black",  color: "#000000", title: "Black" }
  ];

  function resolveColorSwatches() {
    var custom = window.Etcher && window.Etcher.colorSwatches;
    return Array.isArray(custom) && custom.length ? custom : DEFAULT_COLOR_SWATCHES;
  }

  function resolveDefaultColor() {
    var swatches = resolveColorSwatches();
    if (window.Etcher && typeof window.Etcher.defaultColor === "string") {
      return window.Etcher.defaultColor;
    }
    // Prefer the blue swatch (back-compat with the pre-pluggable
    // default), then fall back to the first swatch.
    var blue = swatches.find(function(s) { return s.key === "blue"; });
    return blue ? blue.color : swatches[0].color;
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          el.setAttribute(k, attrs[k]);
        }
      }
    }
    return el;
  }

  // UUIDv7 generator — 48 bits of unix-ms timestamp + 74 bits of random
  // (with 4 bits version + 2 bits variant in their reserved positions).
  // Replaces 0.2.x's tmp-id round-trip: every shape gets its permanent
  // uuid at draw time, so the server never has to assign one. UUIDv7
  // sorts lexicographically by creation time, which is also nice for
  // debugging.
  function genUuidV7() {
    var nowMs = Date.now();
    var hexTs = nowMs.toString(16).padStart(12, "0");           // 48 bits = 12 hex chars
    var rand = new Uint8Array(10);
    (window.crypto || window.msCrypto).getRandomValues(rand);
    // Version = 7 in the top nibble of byte 6 (after the timestamp).
    rand[0] = (rand[0] & 0x0f) | 0x70;
    // Variant = 10 in the top two bits of byte 8.
    rand[2] = (rand[2] & 0x3f) | 0x80;
    var hexRand = "";
    for (var i = 0; i < rand.length; i++) {
      hexRand += rand[i].toString(16).padStart(2, "0");
    }
    return (
      hexTs.slice(0, 8) + "-" +
      hexTs.slice(8, 12) + "-" +
      hexRand.slice(0, 4) + "-" +
      hexRand.slice(4, 8) + "-" +
      hexRand.slice(8, 20)
    );
  }

  // Parse a `data-*-buttons`-style allowlist with three states:
  //   - attribute absent (`undefined`) → null (caller treats as "all on")
  //   - `"none"` sentinel → empty Set (caller treats as "everything hidden")
  //   - CSV → Set of trimmed names
  // Mirrors the Fresco-side convention so consumers see the same
  // semantics across both libraries.
  function parseAllowlistAttr(value) {
    if (value == null) return null;
    if (value === "none") return new Set();
    return new Set(
      value.split(",").map(function(s) { return s.trim(); }).filter(Boolean)
    );
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Stable escape helper for consumer slot impls so they don't have to
  // duplicate one.
  window.Etcher.escapeHtml = escapeHtml;

  // ---------------------------------------------------------------------------
  // Color math — minimal HSL ⇄ hex helpers for the custom-color picker.
  // Saturation is fixed at 100% throughout (the picker only varies hue +
  // lightness), but the conversions take the full HSL triple for clarity.
  // ---------------------------------------------------------------------------

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r1 = 0, g1 = 0, b1 = 0;
    if (hp < 1)      { r1 = c; g1 = x; b1 = 0; }
    else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else             { r1 = c; g1 = 0; b1 = x; }
    var m = l - c / 2;
    return [
      Math.round((r1 + m) * 255),
      Math.round((g1 + m) * 255),
      Math.round((b1 + m) * 255)
    ];
  }

  function hslToHex(h, s, l) {
    var rgb = hslToRgb(h, s, l);
    function pad(n) { var s = n.toString(16); return s.length === 1 ? "0" + s : s; }
    return "#" + pad(rgb[0]) + pad(rgb[1]) + pad(rgb[2]);
  }

  // Best-effort hex parse → HSL. Used to position the picker's knobs
  // when a recent color is re-selected. Returns null on malformed
  // input — callers fall back to a sensible default (hue 0, l 50).
  function hexToHsl(hex) {
    if (typeof hex !== "string") return null;
    var m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 0xff) / 255;
    var g = ((n >> 8) & 0xff) / 255;
    var b = (n & 0xff) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var l = (max + min) / 2;
    var h = 0, s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  // How long a hover-shown tooltip dwells before it auto-closes. The
  // timer starts when the tooltip is shown and is independent of where
  // the cursor goes afterward — move off the shape and it still rides
  // out the full window. Pinned tooltips ignore this entirely (they
  // close only on an explicit click). Hovering the tooltip itself
  // pauses the countdown so the delete button stays reachable.
  var TOOLTIP_DWELL_MS = 5000;

  // Neutral defaults read from generic, non-comment-specific metadata
  // keys — a consumer who just populates these gets a working tooltip
  // without registering any custom slots.
  //   metadata.title    → header (else capitalized shape.kind)
  //   metadata.body     → body (raw HTML; the consumer owns escaping)
  //   metadata.subtitle → footer ("date · count"-style sub-line)
  var DEFAULT_TOOLTIP_SLOTS = {
    header: function(shape) {
      var m = shape.metadata || {};
      return escapeHtml(m.title || shape.kind || "");
    },
    body: function(shape) {
      var m = shape.metadata || {};
      return m.body || null;
    },
    footer: function(shape) {
      var m = shape.metadata || {};
      return m.subtitle ? escapeHtml(m.subtitle) : null;
    }
  };

  // Slot resolver: custom > default > null. Errors in consumer slots
  // are swallowed (warn-only) so a broken override can't take down
  // the whole tooltip; the corresponding default kicks in instead.
  function resolveSlot(name, shape) {
    var slots = window.Etcher.tooltipSlots || {};
    var custom = slots[name];
    if (typeof custom === "function") {
      try {
        var result = custom(shape);
        if (result != null) return result;
      } catch (e) {
        if (window.console && console.warn) {
          console.warn("[Etcher] tooltipSlots." + name + " threw:", e);
        }
      }
    }
    return DEFAULT_TOOLTIP_SLOTS[name](shape);
  }

  // ===========================================================================
  // EtcherLayer LiveView hook
  // ===========================================================================

  window.EtcherHooks = window.EtcherHooks || {};

  window.EtcherHooks.EtcherLayer = {
    mounted: function() {
      injectStyles();

      var self = this;
      self.frescoId = self.el.dataset.frescoId;

      try {
        self.tools = JSON.parse(self.el.dataset.tools || "[]");
      } catch (_) { self.tools = ["rectangle", "circle", "polygon", "freehand"]; }

      // Chrome-allowlist parsing — same `"none"` sentinel convention
      // as Fresco's `:nav_buttons` / `:gestures`. `null` here means
      // "no allowlist set; everything enabled"; an empty Set means
      // "explicit hide-all." `_chromeEnabled(name)` consults the
      // Set for per-button gates.
      self._navButtonAllowlist = parseAllowlistAttr(self.el.dataset.navButtons);
      self.showToolbar = self.el.dataset.toolbar !== "false";

      self.shapes = [];           // { uuid, kind, geometry, style?, metadata?, el }
      self.activeTool = null;     // null = cursor mode
      self.annotationMode = false;
      // Default color comes from `window.Etcher.defaultColor` (else the
      // blue swatch in the active palette, else the first swatch) so
      // the picker has a non-empty selected state on first open and
      // consumers can override the starting color.
      // Fixed editable color slots — seeded for real in `_buildToolbar`
      // (and `_renderInitial` for headless layers) once the handle and
      // its `extensions.etcher.colors` are readable. `activeColor` starts
      // at the configured default and is re-pointed at the selected slot
      // when the palette seeds.
      self._colorSlots = [];      // up to COLOR_SLOTS hex strings
      self._activeSlot = 0;       // index of the selected slot
      self.activeColor = resolveDefaultColor();
      self.draftState = null;     // per-tool drawing state

      if (!self.frescoId) {
        console.warn("[Etcher] Missing data-fresco-id on layer host", self.el);
        return;
      }

      if (!window.Fresco || !window.Fresco.onReady) {
        console.warn("[Etcher] Fresco not loaded — load fresco.js before etcher.js");
        return;
      }

      window.Fresco.onReady(self.frescoId, function(handle) {
        self.handle = handle;
        self._whenCanvasReady(function() { self._init(); });
      });

      // Register this layer in the public `window.Etcher.layerFor`
      // registry so external code can drive it programmatically.
      // Every toolbar / nav button delegates to the same primitives
      // these methods call, so a consumer can run the whole layer
      // without rendering the built-in UI if they want.
      layerRegistry[self.frescoId] = {
        api: {
          // Mode + visibility ----------------------------------------
          getMode: function() { return self.annotationMode; },
          setMode: function(on) { self._setAnnotationMode(!!on); },
          toggleMode: function() { self._setAnnotationMode(!self.annotationMode); },
          isVisible: function() { return self.annotationsVisible !== false; },
          setVisible: function(on) {
            var want = !!on;
            if ((self.annotationsVisible !== false) !== want) {
              self._toggleAnnotationsVisible();
            }
          },
          toggleVisible: function() { self._toggleAnnotationsVisible(); },

          // Tool select -----------------------------------------------
          // `null` selects the cursor (no drawing tool active).
          getTool: function() { return self.activeTool; },
          selectTool: function(toolKey) {
            self._selectTool(toolKey == null ? null : toolKey);
          },
          tools: function() { return (self.tools || []).slice(); },
          exitDrawing: function() { self._selectTool(null); },

          // Color -----------------------------------------------------
          getColor: function() { return self.activeColor; },
          setColor: function(color) { self._selectColor(color); },
          // The fixed editable palette. `getColors` returns a copy;
          // `setColors` replaces the whole palette (clamped/backfilled to
          // COLOR_SLOTS); `setSlotColor` overwrites one slot. Programmatic
          // setters don't auto-persist — the consumer decides when to
          // call them and owns storage (they fire no `etcher:colors-changed`).
          getColors: function() { return (self._colorSlots || []).slice(); },
          setColors: function(arr) {
            self._colorSlots = self._sanitizeColorSlots(arr);
            if (self._activeSlot >= self._colorSlots.length) self._activeSlot = 0;
            self._refreshToolbarSwatches();
            self._selectColor(self._colorSlots[self._activeSlot]);
          },
          setSlotColor: function(i, hex) { self._setSlotColor(i, hex); },
          swatches: function() {
            return resolveColorSwatches().map(function(s) {
              return { color: s.color, title: s.title };
            });
          },

          // History ---------------------------------------------------
          undo: function() { self._undo(); },
          redo: function() { self._redo(); },
          canUndo: function() { return (self._undoStack || []).length > 0; },
          canRedo: function() { return (self._redoStack || []).length > 0; },

          // Shape selection + edit ------------------------------------
          getShapes: function() {
            return self.shapes.map(function(s) { return self._shapeDescriptor(s); });
          },
          getShape: function(uuid) {
            var s = self.shapes.find(function(x) { return x.uuid === uuid; });
            return s ? self._shapeDescriptor(s) : null;
          },

          // Hit-test a point against the current shapes. Returns the
          // top-most shape under `pt` as a shape descriptor (same
          // shape as `getShape`), or `null`. Coordinate space matches
          // the active Fresco handle:
          //   • strip:  pt = { imageIdx, x, y }  (per-image source px)
          //   • canvas: pt = { x, y }            (canvas px)
          //
          // Intended for consumers that wire their own tap-zone
          // handlers (page navigation on left/right thirds, sidebars,
          // mini-maps) and need to know whether the tap landed on an
          // annotation. Etcher's internal pointer pipeline still
          // runs — this is just exposing the same per-kind hit-test
          // (`_shapeContainsPoint`) consumers would otherwise
          // re-implement against `getShapes()`.
          shapeAt: function(pt) {
            if (!pt) return null;
            var s = self._shapeAt(pt);
            return s ? self._shapeDescriptor(s) : null;
          },
          selectShape: function(uuid) {
            var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
            if (shape) self._pinTooltipFor(shape);
          },
          unselectShape: function() { self._unpinTooltip(); },
          enterEditMode: function(uuid) {
            var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
            if (shape) self._enterEditMode(shape);
          },
          exitEditMode: function() { self._exitEditMode(); },
          deleteShape: function(uuid) {
            var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
            if (shape) self._deleteShape(shape);
          },

          // Splice a single shape into the live layer without
          // remounting. Mirrors the persisted-annotation payload
          // shape: `{kind, geometry, image_idx?, image_id?, style?,
          // metadata?, uuid?}`. Returns the shape's uuid (generated
          // when not supplied) or `null` if validation fails.
          //
          // Strip mode REQUIRES `image_idx` — the renderer can't
          // pick the right per-image overlay without it. Canvas
          // multi-image hosts auto-resolve `image_id` from the
          // centroid when omitted (same path hydrated shapes use).
          //
          // Use case: multi-chapter strip readers that fetch the
          // next chapter's annotations on scroll. The previous
          // workaround — full-layer remount — wiped in-flight UI
          // state (active tool, multi-selection, undo stack,
          // pinned tooltip). `addShape` keeps all of that intact.
          //
          // Multiple sibling `addShape` / `addShapes` calls in the
          // same microtask collapse to one
          // `etcher:annotations-changed` emit so the consumer's
          // server-sync handler doesn't see a flurry of full-array
          // replays.
          addShape: function(payload) {
            return self._addShape(payload);
          },

          // Bulk variant of `addShape`. Returns the array of uuids
          // (in input order, with any rejected payloads filtered
          // out). Same microtask-batch emit semantics.
          addShapes: function(payloads) {
            return self._addShapes(payloads);
          },

          // Inspect the currently-shown tooltip. Returns `null` when
          // no tooltip is up, otherwise `{shape, pinned}` — the
          // shape descriptor (`{uuid, kind, geometry, style?,
          // metadata?}`, same shape as `getShape`) and whether the
          // tooltip is in pinned state. Consumers driving custom
          // chrome that need to react to "user just opened the
          // tooltip on shape X" can poll this from
          // `etcher:tooltip-show` / `:tooltip-pin` listeners (or
          // anywhere else).
          //
          // The raw `tooltipEl` reference is intentionally omitted
          // — direct DOM access would couple consumers to internal
          // structure that's free to change between releases. Use
          // `repositionTooltip()` for the most common need (re-
          // anchor after a layout change).
          tooltip: function() {
            if (!self._tooltipShape) return null;
            return {
              shape: {
                uuid: self._tooltipShape.uuid,
                kind: self._tooltipShape.kind,
                geometry: self._tooltipShape.geometry,
                style: self._tooltipShape.style || null,
                metadata: self._tooltipShape.metadata || null
              },
              pinned: !!self.tooltipPinned
            };
          },

          // Re-anchor the currently-shown tooltip to its shape (no-
          // op when no tooltip is up). Useful after a consumer-
          // driven layout change — toggling a side panel, adjusting
          // strip padding, etc. — where the tooltip's last
          // computed position has drifted from its shape.
          repositionTooltip: function() {
            if (self._tooltipShape) self._positionTooltip(self._tooltipShape);
          },

          // Strip mode: re-query the strip's `getImages()` and
          // create overlays for any pages appended to the container
          // since the initial mount. Existing overlays have their
          // layout refreshed in place. No-op on canvas hosts.
          //
          // Internally just calls the same path the window-`resize`
          // / `image-loaded` listeners use, so consumers who already
          // dispatch a synthetic resize don't need this. Use it
          // when the resize side-channel doesn't fit — e.g. the
          // consumer hydrates the next chapter's annotations
          // synchronously after appending its `<img>`s and wants
          // overlays in place before the first `addShape` call.
          refreshPages: function() {
            if (typeof self._onResize === "function") self._onResize();
          },

          // Bring a shape into the viewport. Strip mode scrolls the
          // strip so the shape's image is centered (smooth by default);
          // canvas mode calls `handle.fitBounds` on the shape's image-
          // px bounding box. Useful for reveal-comment-on-page flows
          // where the consumer LV navigates by uuid.
          //
          // Returns a Promise that resolves with
          //   { uuid, image_idx?, image_id?, scrollTop?, cameraBounds? }
          // once the reveal action has been issued (the Promise does
          // NOT wait for scroll to settle — pulse / consumer follow-up
          // can rely on the resolution). Rejects with
          //   { reason: "timeout" | "no_geometry" | "no_image_idx" |
          //             "scroll_failed" | "fitBounds_failed" |
          //             "unsupported_handleKind" }.
          //
          // Polls for late-mounted shapes for `opts.timeout` ms
          // (default 10000) — chapters that hydrate on scroll, async
          // annotation backfills. Also fires an `etcher:shape-revealed`
          // DOM event on the layer host with the same payload, so
          // LiveView hooks / event-bus consumers can react without
          // owning the Promise.
          //
          // Options:
          //   { behavior: "smooth" | "instant" }    // default "smooth"
          //   { align: "center" | "top" | "bottom" } // strip only, default "center"
          //   { pulse: boolean }                    // flash the shape, default false
          //   { pulseDuration: <ms> }               // default 1500
          //   { timeout: <ms> }                     // poll budget, default 10000
          //   { padding: <natural-px> }             // canvas fitBounds padding
          revealShape: function(uuid, opts) {
            return self._revealShape(uuid, opts || {});
          },

          // Patch in-place: merge `fields` into the shape's existing
          // values. Currently honors `metadata` and `style`; other
          // fields are no-ops (geometry edits need geometry-specific
          // re-rendering; uuid/kind are immutable identity).
          //
          // Purpose: consumers that drive annotation state from the
          // server (`<Fresco.canvas>` with `phx-update="ignore"`, so
          // `handle.getExtension("etcher")` returns the initial-mount
          // value forever) need a way to refresh in-DOM metadata when
          // server-side state changes (e.g., a user posts a comment
          // and the tooltip should now show comment_* fields). Without
          // this API the only options were full layer remount or
          // mutating private state.
          patchShape: function(uuid, fields) {
            var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
            if (!shape || !fields) return;
            if (fields.metadata && typeof fields.metadata === "object") {
              shape.metadata = Object.assign({}, shape.metadata || {}, fields.metadata);
            }
            if (fields.style && typeof fields.style === "object") {
              shape.style = Object.assign({}, shape.style || {}, fields.style);
              if (shape.style.color && shape.el) {
                self._applyShapeColor(shape.el, shape.style.color);
              }
            }
            // Re-render the shape so DOM that derives from metadata
            // (dimension labels, callout text, title siblings with
            // their leader lines) reflects the patched values. Without
            // this, server-pushed titles arrive in shape.metadata.title
            // but the on-shape text never redraws. _renderShape is
            // idempotent; for tooltip-only patches (comment_* fields
            // that only affect hover state) this is a no-op visually.
            if (shape.el) {
              self._renderShape(shape);
            }
          }
        }
      };
    },

    destroyed: function() {
      this._exitEditMode();
      this._removeTooltipOutsideClickHandler();
      this._clearCommentHighlights();
      this._unwireGlobalShapeListeners();
      if (this._undoKeyHandler) {
        document.removeEventListener("keydown", this._undoKeyHandler);
        this._undoKeyHandler = null;
      }
      if (this.removeNavBtn) { try { this.removeNavBtn(); } catch (_) {} }
      if (this.visibilityBtn) { try { this.visibilityBtn(); } catch (_) {} }
      if (this.toolbar && this.toolbar.parentNode) {
        this.toolbar.parentNode.removeChild(this.toolbar);
      }
      this._closePopup();
      if (this.toolsPopup && this.toolsPopup.parentNode) {
        this.toolsPopup.parentNode.removeChild(this.toolsPopup);
        this.toolsPopup = null;
      }
      if (this.colorsPopup && this.colorsPopup.parentNode) {
        this.colorsPopup.parentNode.removeChild(this.colorsPopup);
        this.colorsPopup = null;
      }
      if (this._toolbarResizeObserver) {
        try { this._toolbarResizeObserver.disconnect(); } catch (_) {}
        this._toolbarResizeObserver = null;
      }
      if (this._toolbarFallbackResize) {
        window.removeEventListener("resize", this._toolbarFallbackResize);
        this._toolbarFallbackResize = null;
      }
      if (this.overlayWrapper && this.overlayWrapper.parentNode) {
        this.overlayWrapper.parentNode.removeChild(this.overlayWrapper);
      }
      // Strip-mode teardown: pointer handlers on `handle.container`,
      // per-image SVG siblings, the container-level tooltip, and the
      // resize listeners.
      if (this.handleKind === "strip") {
        var container = this.handle && this.handle.container;
        if (container) {
          if (this._stripPointerDown) container.removeEventListener("pointerdown", this._stripPointerDown);
          if (this._stripPointerMove) container.removeEventListener("pointermove", this._stripPointerMove);
          if (this._stripPointerUp) {
            container.removeEventListener("pointerup", this._stripPointerUp);
            container.removeEventListener("pointercancel", this._stripPointerUp);
          }
          if (this._stripDblClick) container.removeEventListener("dblclick", this._stripDblClick);
          if (this._stripTouchStart) {
            container.removeEventListener("touchstart", this._stripTouchStart,
              { passive: false });
          }
          container.classList.remove("etcher-strip-drawing");
          container.style.cursor = "";
        }
        if (this.pageOverlays) {
          this.pageOverlays.forEach(function(entry) {
            if (entry && entry.svg && entry.svg.parentNode) {
              entry.svg.parentNode.removeChild(entry.svg);
            }
          });
          this.pageOverlays = null;
        }
        if (this.tooltipEl && this.tooltipEl.parentNode) {
          this.tooltipEl.parentNode.removeChild(this.tooltipEl);
          this.tooltipEl = null;
        }
        if (this._onResize) {
          window.removeEventListener("resize", this._onResize);
          window.removeEventListener("orientationchange", this._onResize);
          this._onResize = null;
        }
        if (this._unsubImageLoaded) {
          try { this._unsubImageLoaded(); } catch (_) {}
          this._unsubImageLoaded = null;
        }
      }
      if (this._unsubViewport) {
        this._unsubViewport.forEach(function(fn) { try { fn(); } catch (_) {} });
        this._unsubViewport = null;
      }
      if (this._unsubImageVisibility) {
        try { this._unsubImageVisibility(); } catch (_) {}
        this._unsubImageVisibility = null;
      }
      if (this.frescoId) delete layerRegistry[this.frescoId];
      this._setAnnotationMode(false);
    },

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    _whenCanvasReady: function(cb) {
      // Fresco 0.5's <Fresco.canvas> exposes canvas dimensions at mount
      // — no async wait needed (unlike OSD's tile-load gate). The
      // helper stays for API symmetry; future per-image swap support
      // could wire it back through `handle.on("open", ...)`.
      cb();
    },

    _init: function() {
      var self = this;
      var handle = self.handle;

      // Handle-type dispatch (added in 0.4 with Fresco 0.5.3).
      //
      // Fresco's `<Fresco.canvas>` and `<Fresco.scroll_strip>` both publish
      // their handle through the same `window.Fresco.onReady` registry,
      // but expose different surfaces:
      //
      //   - canvas handle has `getCanvasSize()` + image positions in a
      //     single canvas-pixel coordinate space (`imageToScreen({x, y})`).
      //   - strip handle has `scrollTo({imageIdx, y})` + per-image
      //     coordinates (`imageToScreen({imageIdx, x, y})`).
      //
      // The renderers are quite different (strip = per-image SVG
      // siblings of the imgs, scrolled by native browser scroll; canvas
      // = one stage-anchored SVG that scales/translates with the
      // transform engine), so each gets its own init path. Both end
      // up calling `_buildNavButton` / `_buildVisibilityButton` so the
      // pencil + eye buttons attach via `appendNavButton` (which works
      // identically on both handles).
      self.handleKind = ("scrollTo" in handle && typeof handle.scrollTo === "function")
        ? "strip"
        : (typeof handle.getCanvasSize === "function" ? "canvas" : null);

      if (self.handleKind === "strip") {
        self._initStripRenderer(handle);
      } else if (self.handleKind === "canvas") {
        self._initCanvasRenderer(handle);
      } else {
        console.warn(
          "[Etcher] Unknown Fresco handle shape — needs <Fresco.canvas> or " +
          "<Fresco.scroll_strip>."
        );
      }
    },

    _initCanvasRenderer: function(handle) {
      var self = this;

      // Fresco 0.5 canvas-pixel extent — replaces OSD's
      // `world.getItemAt(0).getContentSize()`. `imageSize` stays as the
      // variable name throughout the file; the math is identical, only
      // the source of the dimensions changed.
      var size = handle.getCanvasSize();
      if (!size.width || !size.height) {
        console.warn(
          "[Etcher] Canvas handle reports zero size; check <Fresco.canvas> :canvas dimensions."
        );
        return;
      }
      self.imageSize = { x: size.width, y: size.height };

      self._buildOverlay();
      if (self.showToolbar) self._buildToolbar();
      // Visibility toggle goes above the annotation-mode pencil so
      // it reads "look first, edit second" top-to-bottom. Both are
      // gated by the `:nav_buttons` allowlist so consumers shipping
      // their own chrome can hide them and wire `handle.toggleMode()`
      // / `handle.toggleVisible()` to their own buttons.
      if (self._chromeEnabled("visibility")) self._buildVisibilityButton();
      if (self._chromeEnabled("pencil")) self._buildNavButton();
      self._wireUndoKeyboard();
      self._wireGlobalShapeListeners();

      // Multi-image canvases (paged readers, lookbooks): subscribe
      // to Fresco's `image-visibility-change` and hide shapes whose
      // host image is currently `display: none`. Seed from
      // `handle.getHiddenImageIds()` so an extension mounting after
      // the host already toggled images off still picks up the
      // current state — the event is fire-and-forget, not replayed.
      self._hiddenImageIds = new Set();
      if (typeof handle.getHiddenImageIds === "function") {
        try {
          handle.getHiddenImageIds().forEach(function(id) {
            self._hiddenImageIds.add(id);
          });
        } catch (_) { /* older fresco — no-op, the on-hex package may not have it */ }
      }
      if (typeof handle.on === "function") {
        self._unsubImageVisibility = handle.on(
          "image-visibility-change",
          function(payload) {
            if (!payload || typeof payload.imageId !== "string") return;
            if (payload.visible) self._hiddenImageIds.delete(payload.imageId);
            else self._hiddenImageIds.add(payload.imageId);
            self._applyImageVisibility();
          }
        );
      }

      self._renderInitial();
      // `_applyImageVisibility` runs after `_renderInitial` so the
      // hydrated shapes are present to be toggled.
      self._applyImageVisibility();
    },

    // ─────────────────────────────────────────────────────────────────
    // Strip renderer (0.4+, requires Fresco ~> 0.5.3).
    //
    // <Fresco.scroll_strip> renders N <img> elements as direct children of
    // a scrollable container, sized by aspect-ratio CSS so memory windowing
    // can evict src without collapsing the layout. Etcher attaches one SVG
    // overlay per image as a sibling of that image; the overlay shares the
    // scroll container so native browser scroll moves it in lockstep with
    // its image. Overlays default to `pointer-events: none` so native
    // scroll keeps working — drawing-mode pointer events are captured on
    // `handle.container` instead (added on enter-draw-mode, removed on
    // exit) so the rest of the strip stays scrollable.
    //
    // Each overlay SVG has `viewBox="0 0 naturalWidth naturalHeight"`, so
    // shape attributes can be written directly in image-pixel coordinates
    // without per-frame scaling. The viewBox + percentage sizing combo
    // also means overlays automatically rescale on container width change
    // (orientation flip, window resize) — only `top`/`height` need
    // repositioning, which the resize listener handles.
    //
    // Strip annotations carry an extra `image_idx` field identifying which
    // image they live on; canvas annotations don't. The `etcher:annotations-
    // changed` payload stays a single array — consumers' handle_event
    // doesn't need to branch on mode.
    // ─────────────────────────────────────────────────────────────────

    _initStripRenderer: function(handle) {
      var self = this;

      // Cache page layout once at mount; re-query on resize. getImages
      // forces a sync layout flush so we don't want to call it per scroll
      // tick — but it's stable across memory-windowing evict/restore
      // because aspect-ratio CSS holds each image's slot.
      self.pages = handle.getImages();
      if (!self.pages || self.pages.length === 0) {
        console.warn(
          "[Etcher] Strip handle returned no images; check <Fresco.scroll_strip> :sources."
        );
        return;
      }

      // pageOverlays[image_idx] = { svg, page, titleLayer? }
      // The SVG is the drawable surface; shapes attach as children.
      self.pageOverlays = [];

      self._buildStripOverlays();
      self._buildStripTooltip();
      if (self.showToolbar) self._buildToolbar();
      if (self._chromeEnabled("visibility")) self._buildVisibilityButton();
      if (self._chromeEnabled("pencil")) self._buildNavButton();
      self._wireUndoKeyboard();
      self._wireStripPointerInput();
      self._wireStripResize();
      // Shared shape-interaction listeners: hover → tooltip,
      // tap → _onShapeTap (→ pin in browse, edit-mode in cursor).
      // The handlers route through `_toImage` + `_shapeAt`, both of
      // which already understand strip's `{imageIdx, x, y}` shape.
      self._wireGlobalShapeListeners();
      self._renderInitial();
    },

    // Build one SVG overlay per image. The overlay is inserted into the
    // scroll container as a sibling immediately after its image, so
    // native browser scroll moves them together — no per-frame
    // repositioning needed during scroll. viewBox is image-natural so
    // shape coords are 1:1 with the geometry stored in extensions.
    _buildStripOverlays: function() {
      var self = this;
      var container = self.handle.container;

      // Make sure the container can position absolute children.
      // Scroll containers usually have `overflow: auto` but no explicit
      // position; we need `position: relative` so our absolute overlays
      // anchor to the container (not the page).
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      self.pages.forEach(function(page) { self._buildStripOverlay(page); });
    },

    // Build a strip overlay for a single page and stash it in
    // `pageOverlays[page.idx]`. Idempotent: if an overlay already
    // exists for `page.idx`, refresh its layout in place (preserving
    // any shape children) and return the existing entry.
    //
    // Shared by mount-time iteration (`_buildStripOverlays`) and the
    // post-mount resync (`_onResize`), which encounters pages
    // appended to the strip after the initial build — multi-chapter
    // infinite-scroll readers fetching the next chapter's `<img>`s
    // on demand. Without this path, appended pages have no overlay
    // and `addShape` / draw-tool taps for those pages silently fail.
    _buildStripOverlay: function(page) {
      var self = this;
      var existing = self.pageOverlays && self.pageOverlays[page.idx];
      if (existing && existing.svg) {
        existing.page = page;
        self._applyStripOverlayLayout(existing.svg, page);
        return existing;
      }
      var svg = svgEl("svg", {
        "data-etcher-strip-overlay": "",
        "data-image-idx": String(page.idx)
      });
      self._applyStripOverlayLayout(svg, page);
      // Critical: never consume pointer events. Native scroll on the
      // container must keep working when the user touches inside an
      // overlay region; draw-mode capture lives on the container.
      svg.style.pointerEvents = "none";
      svg.style.overflow = "visible";
      // No `preserveAspectRatio` attribute — the SVG default
      // (`xMidYMid meet`) letterboxes on momentary mismatches
      // between the overlay element box and the viewBox (during
      // image-load, aspect-ratio correction, container-padding
      // changes). The previous `"none"` value would stretch shapes
      // during those windows, which the user sees as a flash of
      // distorted geometry.

      // Insert as sibling immediately after the image so DOM order
      // matches z-order and the overlay scrolls with its image
      // naturally.
      if (page.element && page.element.parentNode) {
        page.element.parentNode.insertBefore(svg, page.element.nextSibling);
      }
      if (!self.pageOverlays) self.pageOverlays = [];
      self.pageOverlays[page.idx] = { svg: svg, page: page };
      return self.pageOverlays[page.idx];
    },

    // Apply geometry + viewBox to a single overlay. Shared by
    // `_buildStripOverlays` (initial mount) and `_onResize` (window
    // resize, image-loaded, consumer-dispatched layout-changed). All
    // four positioning values come from `getImages()` so any
    // consumer-side CSS that shifts each `<img>` (centered narrow
    // pages, horizontal padding, aspect-ratio correction) flows
    // through transparently. The viewBox refresh handles the case
    // where the consumer fixes natural dimensions after the image
    // bitmap loads — without refreshing, shapes would render against
    // a stale natural ratio and visibly stretch.
    _applyStripOverlayLayout: function(svg, page) {
      svg.setAttribute(
        "viewBox",
        "0 0 " + (page.naturalWidth || 1) + " " + (page.naturalHeight || 1)
      );
      svg.style.position = "absolute";
      svg.style.top = page.top + "px";
      svg.style.left = ((page.left != null) ? page.left : 0) + "px";
      svg.style.width = ((page.width != null) ? page.width : "100%") +
        (typeof page.width === "number" ? "px" : "");
      svg.style.height = page.height + "px";
    },

    // Tooltip element lives in the scroll container too (not in a per-
    // image overlay) so it can be positioned freely with respect to
    // any shape. Visibility toggles via opacity; pointer-events: auto
    // when shown so the delete button is clickable.
    _buildStripTooltip: function() {
      var self = this;
      var container = self.handle.container;
      var tip = document.createElement("div");
      tip.className = "etcher-tooltip";
      tip.style.position = "absolute";
      tip.style.zIndex = "12";
      // Hovering the tooltip pauses the dwell countdown so the user can
      // read it / reach the delete button; leaving restarts the full
      // window. Same behavior as canvas mode.
      tip.addEventListener("mouseenter", function() { self._cancelTooltipAutoClose(); });
      tip.addEventListener("mouseleave", function() {
        if (!self.tooltipPinned) self._startTooltipAutoClose();
      });
      tip.addEventListener("click", function(e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-etcher-action]");
        if (!btn) return;
        if (btn.dataset.etcherAction === "delete") {
          self._deleteShape(self._tooltipShape);
        }
      });
      container.appendChild(tip);
      self.tooltipEl = tip;
    },

    // Re-query page positions and resize each overlay. Called on window
    // resize / orientation change. The viewBox stays the same (image
    // natural dimensions don't change); only `top`/`height` shift to
    // match the new display size.
    _wireStripResize: function() {
      var self = this;
      // Universal re-sync path: refreshes every overlay's viewBox +
      // position + size from the live `getImages()` snapshot. Consumers
      // who mutate page layout outside of `image-loaded` (toggling a
      // padding slider, swapping an aspect-ratio correction class)
      // can trigger this manually by dispatching a `resize` event on
      // the window — same hook the browser uses.
      self._onResize = function() {
        if (!self.pageOverlays) return;
        var pages = self.handle.getImages();
        pages.forEach(function(page) {
          var entry = self.pageOverlays[page.idx];
          if (!entry || !entry.svg) {
            // Page appended to the strip after initial mount —
            // multi-chapter infinite-scroll readers fetching the next
            // chapter's `<img>`s. Build the overlay now so subsequent
            // `addShape` calls and draw-tool taps for this page can
            // land on it.
            self._buildStripOverlay(page);
            return;
          }
          entry.page = page;
          self._applyStripOverlayLayout(entry.svg, page);
        });
        self.pages = pages;
        // Tooltip might be showing — reposition to its anchor shape.
        if (self._tooltipShape && self.tooltipEl &&
            self.tooltipEl.style.display !== "none") {
          self._positionTooltip(self._tooltipShape);
        }
      };
      window.addEventListener("resize", self._onResize);
      window.addEventListener("orientationchange", self._onResize);

      // Fresco's strip emits `image-loaded` when each <img> finishes
      // loading (and after memory-windowing restores an evicted src).
      // In normal operation the aspect-ratio CSS already holds the slot
      // so offsetTop / offsetHeight don't shift on load — but if a
      // consumer ever ships an image whose actual intrinsic ratio
      // diverges from the width/height attrs, the slot resizes when
      // the bitmap arrives. Re-syncing on image-loaded covers that
      // edge case cheaply; it's a single getImages() call per load.
      if (typeof self.handle.on === "function") {
        self._unsubImageLoaded = self.handle.on("image-loaded", function() {
          if (self._onResize) self._onResize();
        });
      }
    },

    // Capture drawing gestures on the scroll container. Overlays are
    // pointer-events: none so native scroll keeps working in every other
    // state. When `activeTool` is set we hit-test, snapshot the starting
    // image (so cross-image drag clamps to that image's screen rect),
    // activate the matching per-image overlay so the existing
    // `self.svg.appendChild(...)` paths land in the right SVG, and forward
    // to the shared `_onPointerDown / Move / Up` handlers.
    _wireStripPointerInput: function() {
      var self = this;
      var container = self.handle.container;

      self._stripPointerDown = function(e) {
        if (!self.annotationMode || !self.activeTool) return;
        if (e.button !== 0) return;
        var pt;
        try { pt = self.handle.screenToImage({ x: e.clientX, y: e.clientY }); }
        catch (_) { return; }
        if (!pt || typeof pt.imageIdx !== "number") return;

        // Multi-click flows (polygon, callout) lock to the page where
        // the first click landed. Subsequent clicks on other images
        // are ignored — all vertices must share one image's natural-
        // pixel space. ESC clears the draft if the user wants to
        // restart on a different page.
        if (self.draftPolygon || self.draftCallout) {
          if (!self._stripActiveDraw) return;
          if (pt.imageIdx !== self._stripActiveDraw.imageIdx) return;
        } else {
          var entry = self.pageOverlays && self.pageOverlays[pt.imageIdx];
          if (!entry) return;

          // Lock subsequent moves to this image's screen rect so a drag
          // that wanders into the next image still records into the
          // page it started on.
          var elRect = entry.page.element.getBoundingClientRect();
          self._stripActiveDraw = {
            imageIdx: pt.imageIdx,
            rect: {
              left: elRect.left,
              right: elRect.right,
              top: elRect.top,
              bottom: elRect.bottom
            }
          };
          self._activateOverlayForImage(pt.imageIdx);
        }

        // Block native scroll while drawing; the user is intentionally
        // gesturing inside the canvas and a competing scroll feels wrong.
        try { container.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        // Stop the pointerdown from bubbling to the doc-level shape
        // listeners. Without this, `_docPointerDown` would set a
        // `_pendingTap` on the shape under the cursor and a stationary
        // click (polygon vertex, callout anchor) would fire
        // `_onShapeTap` on release — pinning a tooltip mid-draw. The
        // canvas wrapper does the same `stopPropagation()` for the
        // identical reason; we mirror it here on the container.
        e.stopPropagation();
        self._onPointerDown(e);
      };

      self._stripPointerMove = function(e) {
        // Tool-active hover previews (eraser, polygon next-vertex)
        // need to flow through `_onPointerMove` too, but only over the
        // active image. Without an active draw we don't clamp.
        if (!self.annotationMode || !self.activeTool) return;
        var ev = e;
        var lock = self._stripActiveDraw;
        if (lock && self.draftState) {
          var r = lock.rect;
          var cx = Math.max(r.left, Math.min(r.right - 1, e.clientX));
          var cy = Math.max(r.top, Math.min(r.bottom - 1, e.clientY));
          if (cx !== e.clientX || cy !== e.clientY) {
            ev = {
              clientX: cx,
              clientY: cy,
              pointerId: e.pointerId,
              pointerType: e.pointerType,
              button: e.button,
              buttons: e.buttons,
              target: e.target,
              preventDefault: function() { try { e.preventDefault(); } catch (_) {} },
              stopPropagation: function() { try { e.stopPropagation(); } catch (_) {} }
            };
          }
          e.preventDefault();
        }
        self._onPointerMove(ev);
      };

      self._stripPointerUp = function(e) {
        if (!self.annotationMode) return;
        self._onPointerUp(e);
        // Keep the per-image lock alive during multi-click polygon /
        // callout flows. Clear once the draft is gone (commit / cancel
        // both clear draftPolygon / draftCallout / draftState).
        if (self._stripActiveDraw && !self.draftPolygon &&
            !self.draftCallout && !self.draftState) {
          try { container.releasePointerCapture(e.pointerId); } catch (_) {}
          self._stripActiveDraw = null;
        }
      };

      self._stripDblClick = function(e) {
        if (!self.annotationMode) return;
        self._onDoubleClick(e);
      };

      // iOS Safari: cursor-mode finger drags on a shape get claimed by
      // the strip's native scroller before `pointerdown`'s
      // `preventDefault` runs. By that point `setPointerCapture` is a
      // no-op for scroll cancellation. The OS bakes the
      // scroll-vs-app decision into `touchstart`, so a same-frame
      // `preventDefault` there is the only API that defers
      // classification long enough for app hit-testing.
      //
      // Only act when the finger lands on an existing shape — every
      // other tap should keep scrolling so the reader can still
      // navigate the chapter without exiting annotation mode. Skipped
      // when a drawing tool is active (0.4.4's `.etcher-strip-drawing`
      // already sets `touch-action: none` for that case).
      //
      // `{ passive: false }` is required: modern browsers silently
      // ignore `preventDefault` on passive listeners.
      self._stripTouchStart = function(e) {
        if (!self.annotationMode || self.activeTool) return;
        if (!e.touches || e.touches.length !== 1) return;
        var t = e.touches[0];
        var pt;
        try {
          pt = self.handle.screenToImage({ x: t.clientX, y: t.clientY });
        } catch (_) { return; }
        if (!pt || typeof pt.imageIdx !== "number") return;
        if (self._shapeAt(pt)) e.preventDefault();
      };

      container.addEventListener("pointerdown", self._stripPointerDown);
      container.addEventListener("pointermove", self._stripPointerMove);
      container.addEventListener("pointerup", self._stripPointerUp);
      container.addEventListener("pointercancel", self._stripPointerUp);
      container.addEventListener("dblclick", self._stripDblClick);
      container.addEventListener("touchstart", self._stripTouchStart,
        { passive: false });
    },

    // Switch the "current overlay" so the existing draw / render /
    // handle-creation code paths (which all `appendChild` to `self.svg`)
    // land in the right per-image SVG. No-op for canvas mode.
    _activateOverlayForImage: function(imageIdx) {
      if (this.handleKind !== "strip") return;
      var entry = this.pageOverlays && this.pageOverlays[imageIdx];
      if (entry && entry.svg) this.svg = entry.svg;
    },

    // Activate the overlay that owns `shape.el`. Used by interaction
    // entry points (edit-mode enter, shape-move start, midpoint refresh)
    // so handles / title labels render in the same SVG as the shape
    // they decorate.
    _activateOverlayForShape: function(shape) {
      if (this.handleKind !== "strip") return;
      if (shape && shape.el && shape.el.ownerSVGElement) {
        this.svg = shape.el.ownerSVGElement;
      }
    },

    // ⌘Z / Ctrl+Z to undo, +Shift to redo. Only handled while
    // annotation mode is on — keeps the layer from hijacking shortcuts
    // when the user is just browsing the image. Skips when focus is
    // inside a text input (the inline editor, a form on the page).
    _wireUndoKeyboard: function() {
      var self = this;
      self._undoKeyHandler = function(e) {
        if (!self.annotationMode) return;
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
                  (t.isContentEditable === true))) return;

        // Backspace / Delete deletes the currently-selected shape(s).
        // Multi-selection wins when present (one batched delete +
        // single bulk-undo entry); otherwise falls back to the
        // single edit-mode shape. Goes through the same path as the
        // eraser so undo + server sync work identically. No meta key
        // required — the !INPUT/!TEXTAREA gate above keeps it from
        // firing while the user is typing in a form.
        if (e.key === "Backspace" || e.key === "Delete") {
          // Vertex selection wins over shape selection — clicking a
          // polygon vertex first scopes the next delete to just those
          // points. Falls through if removing the selected count would
          // drop the polygon below 3 vertices so the user can still
          // delete the shape via the regular path.
          if (
            self.editingShape &&
            self.selectedVertexIndices &&
            self.selectedVertexIndices.size > 0
          ) {
            if (self._deleteSelectedVertex()) {
              e.preventDefault();
              return;
            }
          }
          if (self.selectedShapes && self.selectedShapes.length > 0) {
            e.preventDefault();
            self._deleteSelectedShapes();
            return;
          }
          if (self.editingShape) {
            e.preventDefault();
            self._deleteShape(self.editingShape);
            return;
          }
        }

        var meta = e.metaKey || e.ctrlKey;
        if (!meta) return;
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) self._redo();
          else self._undo();
        } else if (e.key === "y" || e.key === "Y") {
          // Windows-style redo (Ctrl+Y) for users who don't reach
          // for Shift.
          e.preventDefault();
          self._redo();
        }
      };
      document.addEventListener("keydown", self._undoKeyHandler);
    },

    // -------------------------------------------------------------------------
    // SVG overlay — absolutely positioned over the viewer container, rendered
    // in *screen pixels*. Shape geometry is stored in image px and converted
    // to screen px on every viewport change via `handle.imageToScreen`.
    //
    // (We don't use OSD's `viewer.addOverlay` because OSD's MouseTracker
    // captures pointer events on the canvas before they reach DOM overlays,
    // which silently breaks drawing input.)
    // -------------------------------------------------------------------------

    _buildOverlay: function() {
      var self = this;
      var handle = self.handle;
      var container = handle.container;

      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      var wrapper = document.createElement("div");
      wrapper.className = "etcher-overlay";
      // `inset: 0` from CSS already covers the container; absolute + top/left
      // are belt-and-braces for older browsers.
      wrapper.style.position = "absolute";
      wrapper.style.top = "0";
      wrapper.style.left = "0";
      wrapper.style.right = "0";
      wrapper.style.bottom = "0";

      var svg = svgEl("svg", { width: "100%", height: "100%" });
      svg.style.position = "absolute";
      svg.style.inset = "0";
      svg.style.overflow = "visible";
      wrapper.appendChild(svg);

      self.overlayWrapper = wrapper;
      self.svg = svg;

      container.appendChild(wrapper);

      // Tooltip — sibling of the SVG, positioned in container-px so it
      // doesn't move with the image (it follows the cursor's shape, but
      // is anchored to the viewport, not the annotation). Interactive
      // (`pointer-events: auto`) so the user can move from the shape to
      // the tooltip and click the delete button — a short hide-delay
      // bridges the gap so the tooltip doesn't snap closed mid-traverse.
      var tip = document.createElement("div");
      tip.className = "etcher-tooltip";
      wrapper.appendChild(tip);
      self.tooltipEl = tip;

      tip.addEventListener("mouseenter", function() { self._cancelTooltipAutoClose(); });
      tip.addEventListener("mouseleave", function() {
        if (!self.tooltipPinned) self._startTooltipAutoClose();
      });
      tip.addEventListener("click", function(e) {
        // Keep clicks from bubbling to OSD's mouse tracker so the
        // delete button never doubles as a click-to-zoom.
        e.stopPropagation();
        var btn = e.target.closest("[data-etcher-action]");
        if (!btn) return;
        if (btn.dataset.etcherAction === "delete") {
          self._deleteShape(self._tooltipShape);
        }
      });

      // Drawing input — only listens when we're in annotation mode with a
      // tool other than cursor. `pointer-events: auto` is toggled on the
      // wrapper to gate this.
      //
      // `data-fresco-no-capture` tells Fresco 0.5's pointerdown handler
      // to bail when an event originates inside the overlay. Combined
      // with `e.stopPropagation()` in our handler, drawing never
      // triggers Fresco's pan/zoom even though the wrapper sits inside
      // the Fresco host's event tree.
      wrapper.setAttribute("data-fresco-no-capture", "");
      wrapper.addEventListener("pointerdown", function(e) {
        e.stopPropagation();
        self._onPointerDown(e);
      });
      wrapper.addEventListener("pointermove", function(e) { self._onPointerMove(e); });
      wrapper.addEventListener("pointerup",   function(e) { self._onPointerUp(e); });
      wrapper.addEventListener("pointerleave", function() { self._onPointerLeave(); });
      wrapper.addEventListener("dblclick",    function(e) { self._onDoubleClick(e); });

      // Re-render shapes in lockstep with the viewer. `animation` fires on
      // every spring-interpolation tick during a zoom or pan, so the
      // annotations follow OSD's smooth motion frame-for-frame. The other
      // events catch one-off cases (resize, source swap) that don't go
      // through the animation loop.
      function render() { self._renderAll(); }

      // Fresco 0.5 emits `animation` on every transform-write frame
      // (and `resize`/`open` on lifecycle moments). That's all the
      // overlay needs — no separate fast-pan path. The previous
      // `pan_optimized` machinery was an OSD-era workaround for the
      // canvas-redraw-per-frame cost that the new CSS-transform engine
      // doesn't have.
      self._unsubViewport = [
        handle.on("animation", render),
        handle.on("resize",    render),
        handle.on("open",      render)
      ];
    },

    // -------------------------------------------------------------------------
    // Bottom toolbar — drawing-tool buttons + close button.
    // -------------------------------------------------------------------------

    _buildToolbar: function() {
      var self = this;
      var container = self.handle.container;

      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      var bar = document.createElement("div");
      bar.className = "etcher-toolbar";

      // Strip mode: the scroll container IS the scrolling element, so an
      // absolutely-positioned toolbar anchored to it would scroll away
      // with the content. Tag the toolbar so the stylesheet can switch
      // it to `position: fixed`. Canvas mode keeps the existing
      // absolute positioning (the canvas container is itself fixed in
      // the viewport).
      if (self.handleKind === "strip") {
        bar.setAttribute("data-strip", "");
      }

      // `data-fresco-no-capture` tells Fresco 0.5's pointerdown handler
      // to bail when the user clicks a toolbar button — otherwise the
      // host's `e.preventDefault()` cancels the button's click event
      // and the gesture handler captures the pointer.
      bar.setAttribute("data-fresco-no-capture", "");

      // Cursor (deselect any active drawing tool). Lives in the
      // tools group and follows the same active/hidden rule in
      // compact mode (visible only while it's the selected
      // \"tool\" — i.e., when no drawing tool is active).
      bar.appendChild(self._makeToolButton("cursor", ICONS.cursor, "Cursor"));

      // Intra-group divider between the cursor and the drawing
      // tools. Kept on wide viewports for visual rhythm; hidden by
      // `_layoutToolbar` once the tools group starts collapsing —
      // a divider next to a single visible item reads as a stray
      // mark, not a group separator.
      var divider = document.createElement("div");
      divider.className = "etcher-divider";
      bar.appendChild(divider);
      self._cursorToolsDivider = divider;

      self.tools.forEach(function(toolKey) {
        var def = TOOL_DEFS[toolKey];
        if (!def) return;
        bar.appendChild(self._makeToolButton(toolKey, def.icon, def.title));
      });

      // Compact-mode overflow trigger for tools. Sits right after the
      // tool buttons so the layout reads `[active_tool] [⋯]`
      // when only one tool is visible. Tap to open the tools popup.
      self.toolsMoreBtn = self._makeMoreButton("tools", "More tools");
      bar.appendChild(self.toolsMoreBtn);

      var divider2 = document.createElement("div");
      divider2.className = "etcher-divider";
      // Survives in compact mode — separates the tools group from the
      // undo/redo group.
      divider2.setAttribute("data-compact-keep", "");
      bar.appendChild(divider2);

      // Undo / redo — inline whenever the whole bar fits; treated as a
      // single unit that collapses into the tools `[⋯]` popup BOTH AT
      // ONCE the moment the bar runs short (before any tool/swatch — see
      // `_computeToolbarOverflow`). Disabled when there's nothing to
      // undo/redo. Shortcuts (Cmd/Ctrl+Z, +Shift) are wired in
      // `_wireKeyboard`.
      self.undoBtn = document.createElement("button");
      self.undoBtn.type = "button";
      self.undoBtn.title = "Undo (⌘Z)";
      self.undoBtn.setAttribute("aria-label", "Undo");
      self.undoBtn.innerHTML = ICONS.undo;
      self.undoBtn.addEventListener("click", function(e) {
        e.preventDefault();
        self._undo();
      });
      bar.appendChild(self.undoBtn);

      self.redoBtn = document.createElement("button");
      self.redoBtn.type = "button";
      self.redoBtn.title = "Redo (⌘⇧Z)";
      self.redoBtn.setAttribute("aria-label", "Redo");
      self.redoBtn.innerHTML = ICONS.redo;
      self.redoBtn.addEventListener("click", function(e) {
        e.preventDefault();
        self._redo();
      });
      bar.appendChild(self.redoBtn);

      var dividerUndo = document.createElement("div");
      dividerUndo.className = "etcher-divider";
      bar.appendChild(dividerUndo);
      // Collapsed together with undo/redo when the pair folds into the
      // menu (so it doesn't sit adjacent to divider2 once they're gone).
      self._undoSwatchesDivider = dividerUndo;

      self._refreshUndoButtons();

      // Compact-mode overflow trigger for colors. Sits right after
      // the swatches so the layout reads `[active_swatch] [⋯]` when
      // only one is visible; swatches are inserted before it by
      // `_refreshToolbarSwatches`.
      self.colorsMoreBtn = self._makeMoreButton("colors", "More colors");
      bar.appendChild(self.colorsMoreBtn);

      // Inline toolbar swatches reflect the user's effective palette:
      // recents first (MRU), then preset colors backfilling any
      // unused slots. New users see the static presets until they
      // pick anything; established users see their actual usage.
      //
      // The refresh reads `self.toolbar` to find its insertion
      // anchor, so point that reference at `bar` before calling —
      // even though `bar` isn't appended to the container yet,
      // insertions on a detached element work the same and `bar`
      // ends up in the DOM at the bottom of this method.
      self.toolbar = bar;
      // Seeds `_colorSlots` (if empty) and renders the slot row.
      self._refreshToolbarSwatches();

      var divider3 = document.createElement("div");
      divider3.className = "etcher-divider";
      // Survives in compact mode — separates swatches from close.
      divider3.setAttribute("data-compact-keep", "");
      bar.appendChild(divider3);

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.title = "Exit annotation mode";
      closeBtn.setAttribute("aria-label", "Exit annotation mode");
      closeBtn.innerHTML = ICONS.close;
      closeBtn.addEventListener("click", function(e) {
        e.preventDefault();
        self._setAnnotationMode(false);
      });
      bar.appendChild(closeBtn);

      container.appendChild(bar);
      // `self.toolbar = bar` was set earlier so the inline swatch
      // refresh had its insertion anchor; no need to re-assign.

      // Popups are siblings of the toolbar inside the same container so
      // they share its absolute-positioning origin. Built lazily on
      // first open isn't worth the complexity — they're cheap.
      self._buildToolsPopup();
      self._buildColorsPopup();

      // Re-run the overflow layout on every container resize. The
      // observer fires immediately on attach so the initial layout
      // happens via this path too — no separate call needed. Skipped
      // entirely when the toolbar is hidden (annotation mode off);
      // measurements return 0 in that state.
      if (typeof ResizeObserver === "function") {
        self._toolbarResizeObserver = new ResizeObserver(function() {
          self._layoutToolbar();
        });
        self._toolbarResizeObserver.observe(container);
      } else {
        // Defensive fallback for older browsers: layout on window
        // resize only.
        self._toolbarFallbackResize = function() { self._layoutToolbar(); };
        window.addEventListener("resize", self._toolbarFallbackResize);
      }
    },

    // Progressive-overflow layout. Walks tools and swatches in lockstep
    // (one tool, one swatch, one tool, one swatch, …), tagging each
    // with `.etcher-overflow-hidden` until the toolbar's intrinsic
    // width fits its container. When one group runs out of hideable
    // items, the other continues alone. Active tool / swatch is pinned
    // — never collapsed, so the user always sees what's selected.
    //
    // Called from:
    //   - ResizeObserver on the container (fires on initial attach
    //     too, so initial layout flows through here)
    //   - `_setAnnotationMode(true)` after the toolbar becomes visible
    //   - `_selectTool` / `_selectColor` (active item changed → re-pin)
    _layoutToolbar: function() {
      // Compute which buttons overflow (tagging them hidden), then sync
      // the tools popup so it carries ONLY the hidden tools and the
      // `[⋯]` trigger shows only when something is actually hidden.
      this._computeToolbarOverflow();
      this._syncToolsPopup();
      this._syncColorsPopup();
    },

    _computeToolbarOverflow: function() {
      var self = this;
      if (!self.toolbar) return;
      // Toolbar is `display: none` until annotation mode is on; bail
      // so scrollWidth/clientWidth measurements aren't taken against
      // a hidden element (which would return 0 and skew the logic).
      if (!self.toolbar.classList.contains("is-active")) return;

      var container = self.handle && self.handle.container;
      if (!container) return;

      // Reset every overflow-hidden tag from the previous pass.
      var toolBtns = Array.prototype.slice.call(
        self.toolbar.querySelectorAll("button[data-tool]")
      );
      var swatchBtns = Array.prototype.slice.call(
        self.toolbar.querySelectorAll(".etcher-swatch")
      );
      toolBtns.forEach(function(b) { b.classList.remove("etcher-overflow-hidden"); });
      swatchBtns.forEach(function(b) { b.classList.remove("etcher-overflow-hidden"); });
      if (self.toolsMoreBtn) self.toolsMoreBtn.classList.remove("is-active");
      if (self.colorsMoreBtn) self.colorsMoreBtn.classList.remove("is-active");
      if (self._cursorToolsDivider) {
        self._cursorToolsDivider.classList.remove("etcher-overflow-hidden");
      }
      if (self.undoBtn) self.undoBtn.classList.remove("etcher-overflow-hidden");
      if (self.redoBtn) self.redoBtn.classList.remove("etcher-overflow-hidden");
      if (self._undoSwatchesDivider) {
        self._undoSwatchesDivider.classList.remove("etcher-overflow-hidden");
      }

      // Available width: container minus a comfort margin so the
      // toolbar doesn't kiss the viewer edges — a 32px gutter each side
      // (collapses a tool into the `[⋯]` / palette menus well before the
      // bar reaches the page sides). Buttons keep their natural size;
      // overflow HIDES the extras rather than shrinking anything.
      var available = container.clientWidth - 64;
      if (available <= 0) return;
      if (self.toolbar.scrollWidth <= available) return;  // already fits

      // Undo / redo are treated as ONE unit: the moment the bar runs
      // short on room they collapse together (both at once) into the
      // tools `[⋯]` popup, before any individual tool/swatch is touched.
      // So they're inline only while the whole bar fits; any overflow
      // folds the pair first (often enough on its own, leaving every
      // tool visible).
      if (self.undoBtn) self.undoBtn.classList.add("etcher-overflow-hidden");
      if (self.redoBtn) self.redoBtn.classList.add("etcher-overflow-hidden");
      if (self._undoSwatchesDivider) {
        self._undoSwatchesDivider.classList.add("etcher-overflow-hidden");
      }
      if (self.toolbar.scrollWidth <= available) return;

      // Build the hideable queues — non-active items in right-to-left
      // order so the rightmost button collapses first.
      var activeToolKey = self.activeTool == null ? "cursor" : self.activeTool;
      var toolsQueue = [];
      for (var i = toolBtns.length - 1; i >= 0; i--) {
        if (toolBtns[i].dataset.tool !== activeToolKey) toolsQueue.push(toolBtns[i]);
      }
      var swatchQueue = [];
      // Pin the active slot by index (two slots can share a color, so a
      // color compare could pin the wrong/both swatches).
      for (var j = swatchBtns.length - 1; j >= 0; j--) {
        if (Number(swatchBtns[j].dataset.slot) !== self._activeSlot) {
          swatchQueue.push(swatchBtns[j]);
        }
      }

      // Hide one button at a time from whichever group currently
      // occupies MORE horizontal space, so tools and color swatches
      // converge to an even ~50/50 split instead of tools (which start
      // with far more buttons) keeping the lion's share. The pinned
      // active tool / swatch are excluded from the queues, so each group
      // always keeps at least its selected item.
      //
      // (The `[⋯]` triggers aren't toggled here: the tools trigger is
      // always shown via `_syncToolsPopup`, the colors trigger always
      // via CSS — both because each popup holds permanent content.)
      function visibleWidth(btns) {
        var w = 0;
        for (var k = 0; k < btns.length; k++) {
          if (!btns[k].classList.contains("etcher-overflow-hidden")) {
            w += btns[k].offsetWidth;
          }
        }
        return w;
      }

      var tIdx = 0, sIdx = 0;
      while (tIdx < toolsQueue.length || sIdx < swatchQueue.length) {
        var hideTool;
        if (tIdx >= toolsQueue.length) {
          hideTool = false;                       // tools exhausted
        } else if (sIdx >= swatchQueue.length) {
          hideTool = true;                        // swatches exhausted
        } else {
          hideTool = visibleWidth(toolBtns) >= visibleWidth(swatchBtns);
        }

        if (hideTool) {
          // First tool hidden: collapse the cursor/tools divider so a
          // lone visible tool doesn't sit beside a stray separator.
          if (tIdx === 0 && self._cursorToolsDivider) {
            self._cursorToolsDivider.classList.add("etcher-overflow-hidden");
          }
          toolsQueue[tIdx++].classList.add("etcher-overflow-hidden");
        } else {
          swatchQueue[sIdx++].classList.add("etcher-overflow-hidden");
        }
        if (self.toolbar.scrollWidth <= available) return;
      }
    },

    // Keep the tools `[⋯]` popup in lockstep with the overflow state:
    // show only the popup buttons whose main-toolbar counterpart is
    // currently hidden (the active tool is pinned, so it never appears),
    // surface undo / redo only when the history group itself overflowed,
    // and light the `[⋯]` trigger iff the popup actually has something to
    // offer. Driven from `_layoutToolbar` after every overflow pass, so
    // a wider toolbar that fits everything hides the trigger outright.
    _syncToolsPopup: function() {
      var self = this;
      if (!self.toolsPopup || !self.toolbar) return;

      var anyToolHidden = false;
      (self.toolsPopupBtns || []).forEach(function(pb) {
        var main = self.toolbar.querySelector(
          'button[data-tool="' + pb.dataset.tool + '"]'
        );
        var hidden = !!(main && main.classList.contains("etcher-overflow-hidden"));
        pb.style.display = hidden ? "" : "none";
        if (hidden) anyToolHidden = true;
      });

      // Undo / redo appear in the popup ONLY when their inline buttons
      // were collapsed off the toolbar (the pair folds into the menu when
      // the bar runs short) — otherwise they ride out on the toolbar
      // itself. The divider shows only when overflowed tools ALSO sit
      // above them.
      var histHidden = !!(self.undoBtn &&
        self.undoBtn.classList.contains("etcher-overflow-hidden"));
      if (self.popupUndoBtn) self.popupUndoBtn.style.display = histHidden ? "" : "none";
      if (self.popupRedoBtn) self.popupRedoBtn.style.display = histHidden ? "" : "none";
      if (self._popupHistoryDivider) {
        self._popupHistoryDivider.style.display = (histHidden && anyToolHidden) ? "" : "none";
      }

      // `[⋯]` shows only when the popup has content — overflowed tools
      // and/or collapsed undo/redo.
      if (self.toolsMoreBtn) {
        self.toolsMoreBtn.classList.toggle("is-active", anyToolHidden || histHidden);
      }
    },

    // Mirror the overflowed color slots into the colors popup (above the
    // preset row) so the user's customizable colors stay reachable when
    // they don't fit on the toolbar. Rebuilt from the current overflow
    // state each pass; the row + its divider hide when every slot is
    // inline. Clicking one selects that slot (it then pins back onto the
    // toolbar) and keeps the picker open so it can be tweaked.
    _syncColorsPopup: function() {
      var self = this;
      var row = self.colorsPopupSlotsRow;
      if (!row) return;
      while (row.firstChild) row.removeChild(row.firstChild);

      var anyHidden = false;
      (self.swatchEls || []).forEach(function(toolbarSwatch, i) {
        if (!toolbarSwatch.classList.contains("etcher-overflow-hidden")) return;
        anyHidden = true;
        var color = toolbarSwatch.dataset.color;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "etcher-swatch";
        b.dataset.color = color;
        b.dataset.slot = String(i);
        b.title = color;
        b.setAttribute("aria-label", "Color slot " + (i + 1) + ": " + color);
        b.style.background = color;
        b.addEventListener("click", function(e) {
          e.preventDefault();
          // Select the slot but keep the picker open so the user can
          // immediately tweak it on the wheel; re-aim the wheel at the
          // freshly-selected color.
          self._selectSlot(i);
          self._syncPickerToActiveColor();
        });
        row.appendChild(b);
      });

      row.style.display = anyHidden ? "" : "none";
      if (self.colorsPopupSlotsDivider) {
        self.colorsPopupSlotsDivider.style.display = anyHidden ? "" : "none";
      }
    },

    // Compact-mode `[⋯]` trigger. Calls into a kind-specific opener
    // (`_openToolsPopup` / `_openColorsPopup`); both pop above the
    // button anchored to the toolbar.
    _makeMoreButton: function(kind, title) {
      var self = this;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "etcher-more";
      btn.dataset.more = kind;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      // Colors trigger opens the color picker, so it wears a palette;
      // the tools trigger keeps the generic overflow dots.
      btn.innerHTML = kind === "colors" ? ICONS.palette : ICONS.more;
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        self._togglePopup(kind);
      });
      return btn;
    },

    // Tools popup: every drawing tool + cursor, rendered as a wrapping
    // grid above the `[⋯]` trigger. Reuses `_selectTool` so the
    // popup's selection flows through the same path as the main
    // toolbar (state stays in lockstep — the popup is just an
    // alternate UI).
    _buildToolsPopup: function() {
      var self = this;
      var popup = document.createElement("div");
      popup.className = "etcher-popup";
      popup.dataset.kind = "tools";
      popup.setAttribute("data-fresco-no-capture", "");
      // Cursor first so it's the easy reach when exiting draw mode.
      var entries = [{ key: "cursor", icon: ICONS.cursor, title: "Cursor" }];
      self.tools.forEach(function(toolKey) {
        var def = TOOL_DEFS[toolKey];
        if (!def) return;
        entries.push({ key: toolKey, icon: def.icon, title: def.title });
      });
      self.toolsPopupBtns = entries.map(function(entry) {
        var b = document.createElement("button");
        b.type = "button";
        b.dataset.tool = entry.key;
        b.title = entry.title;
        b.setAttribute("aria-label", entry.title);
        b.innerHTML = entry.icon;
        b.addEventListener("click", function(e) {
          e.preventDefault();
          self._selectTool(entry.key === "cursor" ? null : entry.key);
          self._closePopup();
        });
        popup.appendChild(b);
        return b;
      });

      // Hairline + undo / redo. The popup is also the overflow target
      // for the history group when the toolbar narrows past the point
      // where even tools and swatches can't free enough space. Always
      // rendered (cheap) so the popup contents don't shift when the
      // user resizes the viewer.
      var historyDivider = document.createElement("div");
      historyDivider.className = "etcher-popup-divider";
      popup.appendChild(historyDivider);
      self._popupHistoryDivider = historyDivider;

      self.popupUndoBtn = document.createElement("button");
      self.popupUndoBtn.type = "button";
      self.popupUndoBtn.dataset.history = "undo";
      self.popupUndoBtn.title = "Undo (⌘Z)";
      self.popupUndoBtn.setAttribute("aria-label", "Undo");
      self.popupUndoBtn.innerHTML = ICONS.undo;
      self.popupUndoBtn.addEventListener("click", function(e) {
        e.preventDefault();
        self._undo();
        // Don't auto-close — users often undo multiple times in a row.
        self._refreshUndoButtons();
      });
      popup.appendChild(self.popupUndoBtn);

      self.popupRedoBtn = document.createElement("button");
      self.popupRedoBtn.type = "button";
      self.popupRedoBtn.dataset.history = "redo";
      self.popupRedoBtn.title = "Redo (⌘⇧Z)";
      self.popupRedoBtn.setAttribute("aria-label", "Redo");
      self.popupRedoBtn.innerHTML = ICONS.redo;
      self.popupRedoBtn.addEventListener("click", function(e) {
        e.preventDefault();
        self._redo();
        self._refreshUndoButtons();
      });
      popup.appendChild(self.popupRedoBtn);

      self.handle.container.appendChild(popup);
      self.toolsPopup = popup;
    },

    // Colors popup: preset swatches + recent-customs row + a
    // hue-ring / lightness-slider picker. Selecting anything routes
    // through `_selectColor`, which (for non-preset colors) also
    // pushes the pick onto the recents stack so the user can
    // re-grab it from a single swatch on subsequent sessions.
    _buildColorsPopup: function() {
      var self = this;
      var popup = document.createElement("div");
      popup.className = "etcher-popup";
      popup.dataset.kind = "colors";
      popup.setAttribute("data-fresco-no-capture", "");

      // Custom picker: preset swatches + hue ring + lightness slider.
      // No separate \"Recent\" row inside the popup — the toolbar's
      // inline swatches are now the recents display, so duplicating
      // them in the popup would just be redundant chrome. The static
      // preset row stays inside the picker as a quick way back to
      // default colors even after the user's palette has drifted.
      var picker = document.createElement("div");
      picker.className = "etcher-picker";

      // Overflowed color slots — the user's customizable swatches that
      // don't fit on the toolbar appear here, above the permanent preset
      // row, so they stay reachable. Populated by `_syncColorsPopup`;
      // this row and its divider hide when every slot fits inline.
      var slotsRow = document.createElement("div");
      slotsRow.className = "etcher-presets etcher-popup-slots";
      slotsRow.style.display = "none";
      picker.appendChild(slotsRow);
      self.colorsPopupSlotsRow = slotsRow;

      var slotsDivider = document.createElement("div");
      slotsDivider.className = "etcher-popup-divider";
      slotsDivider.style.display = "none";
      picker.appendChild(slotsDivider);
      self.colorsPopupSlotsDivider = slotsDivider;

      var presetColors = resolveColorSwatches().map(function(s) { return s.color; });
      self._presetColors = presetColors;
      var presetRow = document.createElement("div");
      presetRow.className = "etcher-presets";
      self.colorsPopupBtns = resolveColorSwatches().map(function(s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "etcher-swatch";
        b.dataset.color = s.color;
        b.title = s.title;
        b.setAttribute("aria-label", "Color: " + s.title);
        b.style.background = s.color;
        if (s.color === self.activeColor) b.classList.add("is-selected");
        b.addEventListener("click", function(e) {
          e.preventDefault();
          // Presets are a quick way to set the selected slot to a known
          // color — overwrite the active slot in place (same as a hue-
          // ring pick) and persist, rather than spawning a new entry.
          // Keep the picker open (it only closes on an outside click) so
          // the user can keep adjusting.
          self._setSlotColor(self._activeSlot, s.color);
          self._selectColor(s.color);
          self._emitColorsChanged();
        });
        presetRow.appendChild(b);
        return b;
      });
      picker.appendChild(presetRow);

      // Hue ring — a torus-shaped canvas painted once. Clicking /
      // dragging on it sets `_pickerHue`. Default size keeps the
      // popup compact while still leaving a comfortable thumb-tap
      // target on phones.
      var ringSize = 132;
      var ringWrap = document.createElement("div");
      ringWrap.className = "etcher-picker-ring-wrap";
      ringWrap.style.width = ringSize + "px";
      ringWrap.style.height = ringSize + "px";

      var ring = document.createElement("canvas");
      ring.className = "etcher-picker-ring";
      ring.width = ringSize;
      ring.height = ringSize;
      ringWrap.appendChild(ring);

      var ringKnob = document.createElement("div");
      ringKnob.className = "etcher-picker-ring-knob";
      ringWrap.appendChild(ringKnob);

      picker.appendChild(ringWrap);

      // Lightness slider + preview, on a single row below the ring.
      var sliderRow = document.createElement("div");
      sliderRow.className = "etcher-picker-slider-row";

      var sliderWrap = document.createElement("div");
      sliderWrap.className = "etcher-picker-slider-wrap";
      var slider = document.createElement("canvas");
      slider.className = "etcher-picker-slider";
      slider.width = 120;
      slider.height = 14;
      sliderWrap.appendChild(slider);

      var sliderKnob = document.createElement("div");
      sliderKnob.className = "etcher-picker-slider-knob";
      sliderWrap.appendChild(sliderKnob);

      var preview = document.createElement("div");
      preview.className = "etcher-picker-preview";

      sliderRow.appendChild(sliderWrap);
      sliderRow.appendChild(preview);
      picker.appendChild(sliderRow);
      popup.appendChild(picker);

      // Cache for the layout + redraw routines.
      self._pickerRing = ring;
      self._pickerRingWrap = ringWrap;
      self._pickerRingKnob = ringKnob;
      self._pickerRingSize = ringSize;
      self._pickerRingOuter = ringSize / 2 - 2;
      self._pickerRingInner = ringSize / 2 - 18;
      self._pickerSlider = slider;
      self._pickerSliderKnob = sliderKnob;
      self._pickerPreview = preview;

      // Seed the picker from the active color when it's a non-preset
      // hex (so re-opening the popup after a custom pick puts the
      // knobs where the user left them). Otherwise default to a
      // neutral starting position.
      var seed = self.activeColor &&
                 self._presetColors.indexOf(self.activeColor) === -1
        ? hexToHsl(self.activeColor)
        : null;
      self._pickerHue = seed ? seed.h : 200;
      self._pickerLightness = seed ? seed.l : 50;

      self._drawHueRing();
      self._drawLightnessSlider();
      self._positionPickerKnobs();
      self._updatePickerPreview();
      self._wirePickerInput();

      self.handle.container.appendChild(popup);
      self.colorsPopup = popup;
    },

    // Paint the hue ring once. The torus is drawn pixel-by-pixel via
    // `ImageData` so each ring pixel maps to its angle's hue at full
    // saturation + 50% lightness. A 1-pixel alpha falloff at both
    // edges softens the otherwise-aliased ring boundary.
    // Move the hue-ring + lightness knobs to match the active slot's
    // color. Only repositions for custom (non-preset) colors — the
    // picker's saturation is locked at 100, so presets aren't faithfully
    // representable and the knobs are left where the user last put them.
    // The preview chip is owned by `_selectColor` (shows the real active
    // color), so we don't touch it here.
    _syncPickerToActiveColor: function() {
      if (!this._pickerRing) return;
      var presets = this._presetColors || [];
      if (!this.activeColor || presets.indexOf(this.activeColor) !== -1) return;
      if (!/^#[0-9a-f]{6}$/i.test(this.activeColor)) return;
      var hsl = hexToHsl(this.activeColor);
      this._pickerHue = hsl.h;
      this._pickerLightness = hsl.l;
      this._drawLightnessSlider();
      this._positionPickerKnobs();
    },

    _drawHueRing: function() {
      var canvas = this._pickerRing;
      if (!canvas) return;
      var size = this._pickerRingSize;
      var outer = this._pickerRingOuter;
      var inner = this._pickerRingInner;
      var ctx = canvas.getContext("2d");
      var img = ctx.createImageData(size, size);
      var data = img.data;
      var cx = size / 2, cy = size / 2;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var dx = x - cx, dy = y - cy;
          var r = Math.sqrt(dx * dx + dy * dy);
          if (r > outer || r < inner - 1) continue;
          // 0° at the top so the wheel reads like a clock.
          var ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          if (ang < 0) ang += 360;
          var rgb = hslToRgb(ang, 100, 50);
          var alpha = 255;
          if (r > outer - 1) alpha = (outer - r) * 255;
          else if (r < inner) alpha = (r - (inner - 1)) * 255;
          if (alpha < 0) alpha = 0;
          if (alpha > 255) alpha = 255;
          var idx = (y * size + x) * 4;
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = alpha;
        }
      }
      ctx.clearRect(0, 0, size, size);
      ctx.putImageData(img, 0, 0);
    },

    // Repaint the lightness slider for the current hue. Cheap (one
    // canvas gradient fill) so we redraw it every time the user
    // moves the ring knob, keeping the slider visually anchored to
    // the actual hue they're tuning.
    _drawLightnessSlider: function() {
      var canvas = this._pickerSlider;
      if (!canvas) return;
      var w = canvas.width, h = canvas.height;
      var ctx = canvas.getContext("2d");
      var grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "hsl(" + this._pickerHue + ", 100%, 0%)");
      grad.addColorStop(0.5, "hsl(" + this._pickerHue + ", 100%, 50%)");
      grad.addColorStop(1, "hsl(" + this._pickerHue + ", 100%, 100%)");
      // Rounded corners via clip — matches the CSS border-radius so
      // the gradient doesn't leak past the slider's visible bounds.
      ctx.clearRect(0, 0, w, h);
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, h / 2);
        ctx.fillStyle = grad;
        ctx.fill();
      } else {
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    },

    _positionPickerKnobs: function() {
      var size = this._pickerRingSize;
      var cx = size / 2, cy = size / 2;
      // Midline radius of the ring band — knob hugs the center of
      // the colored donut.
      var midR = (this._pickerRingOuter + this._pickerRingInner) / 2;
      var ang = (this._pickerHue - 90) * Math.PI / 180;
      var kx = cx + midR * Math.cos(ang);
      var ky = cy + midR * Math.sin(ang);
      if (this._pickerRingKnob) {
        this._pickerRingKnob.style.left = kx + "px";
        this._pickerRingKnob.style.top = ky + "px";
      }
      if (this._pickerSliderKnob) {
        var w = this._pickerSlider.width;
        var x = (this._pickerLightness / 100) * w;
        this._pickerSliderKnob.style.left = x + "px";
      }
    },

    _updatePickerPreview: function() {
      if (!this._pickerPreview) return;
      this._pickerPreview.style.background =
        hslToHex(this._pickerHue, 100, this._pickerLightness);
    },

    // Pointer wiring for both the hue ring and the lightness slider.
    // Both support press + drag (the user can scrub continuously
    // without lifting their finger); on every move we overwrite the
    // selected slot's color and `_selectColor` immediately so the
    // in-flight draft / edit updates live. `pointerup` commits the
    // edited slot via `_emitColorsChanged` (the persistence hook).
    _wirePickerInput: function() {
      var self = this;
      var ring = self._pickerRing;
      var slider = self._pickerSlider;
      if (!ring || !slider) return;

      function ringEvent(e) {
        var rect = ring.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        var ang = Math.atan2(y, x) * 180 / Math.PI + 90;
        if (ang < 0) ang += 360;
        self._pickerHue = ang;
        self._drawLightnessSlider();
        self._positionPickerKnobs();
        var hex = hslToHex(self._pickerHue, 100, self._pickerLightness);
        self._updatePickerPreview();
        self._setSlotColor(self._activeSlot, hex);
        self._selectColor(hex);
      }

      function sliderEvent(e) {
        var rect = slider.getBoundingClientRect();
        var t = (e.clientX - rect.left) / rect.width;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        self._pickerLightness = t * 100;
        self._positionPickerKnobs();
        var hex = hslToHex(self._pickerHue, 100, self._pickerLightness);
        self._updatePickerPreview();
        self._setSlotColor(self._activeSlot, hex);
        self._selectColor(hex);
      }

      function attachDrag(el, onMove) {
        el.addEventListener("pointerdown", function(e) {
          e.preventDefault();
          e.stopPropagation();
          try { el.setPointerCapture(e.pointerId); } catch (_) {}
          onMove(e);
          function move(ev) { onMove(ev); }
          function up(ev) {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
            try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
            // Commit the edited slot on release — persist via the hook.
            self._emitColorsChanged();
          }
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
          el.addEventListener("pointercancel", up);
        });
      }

      attachDrag(ring, ringEvent);
      attachDrag(slider, sliderEvent);
    },

    // -------------------------------------------------------------------------
    // Color slots
    //
    // The toolbar carries `COLOR_SLOTS` fixed swatches. Clicking one
    // selects it (sets the active draw color); editing in the hue picker
    // overwrites the selected slot's color in place. The palette is
    // seeded per-layer and persisted by the consumer through the
    // `etcher:colors-changed` hook — no localStorage, no MRU reordering,
    // so a slot stays put once a user customizes it.
    // -------------------------------------------------------------------------

    // Coerce an arbitrary list into exactly COLOR_SLOTS valid `#rrggbb`
    // entries, backfilling short / invalid lists from the preset palette
    // so the row is always full. Returns lowercased hex strings.
    _sanitizeColorSlots: function(list) {
      var presets = resolveColorSwatches().map(function(s) { return s.color; });
      var out = [];
      function valid(c) { return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c); }
      (Array.isArray(list) ? list : []).forEach(function(c) {
        if (out.length < COLOR_SLOTS && valid(c)) out.push(c.toLowerCase());
      });
      for (var i = 0; out.length < COLOR_SLOTS && i < presets.length; i++) {
        if (valid(presets[i])) out.push(presets[i].toLowerCase());
      }
      // Last resort if the presets were somehow unusable.
      while (out.length < COLOR_SLOTS) out.push("#000000");
      return out;
    },

    // Seed `_colorSlots` + `_activeSlot`. Priority: the layer's
    // `data-colors` attr → the viewer's `extensions.etcher.colors` (the
    // same JSON annotations ride in) → the preset palette. The starting
    // selection prefers a slot matching `window.Etcher.defaultColor`,
    // else slot 0. Idempotent at mount; never re-run after a user edit.
    _seedColorSlots: function() {
      var seed = null;
      try {
        var raw = this.el && this.el.dataset && this.el.dataset.colors;
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) seed = parsed;
        }
      } catch (_) { /* malformed attr → fall through */ }

      if (!seed && this.handle && typeof this.handle.getExtension === "function") {
        try {
          var ext = this.handle.getExtension("etcher");
          if (ext && Array.isArray(ext.colors) && ext.colors.length) seed = ext.colors;
        } catch (_) { /* no extension → fall through */ }
      }

      this._colorSlots = this._sanitizeColorSlots(seed);

      var def = window.Etcher && typeof window.Etcher.defaultColor === "string"
        ? window.Etcher.defaultColor.toLowerCase()
        : null;
      var idx = def ? this._colorSlots.indexOf(def) : -1;
      this._activeSlot = idx === -1 ? 0 : idx;
      this.activeColor = this._colorSlots[this._activeSlot];
    },

    // Select slot `i` — make it the active draw color. Pure selection:
    // no palette mutation and no persist (editing the hue picker is what
    // mutates a slot). Clamps out-of-range indices defensively.
    _selectSlot: function(i) {
      if (!this._colorSlots || !this._colorSlots.length) return;
      if (i < 0 || i >= this._colorSlots.length) i = 0;
      this._activeSlot = i;
      this._selectColor(this._colorSlots[i]);
    },

    // Overwrite slot `i`'s color and repaint just that swatch. Used by
    // the hue ring / slider (on the active slot, as the user drags) and
    // by the programmatic API. Does not persist — `_emitColorsChanged`
    // fires once on commit (pointer-release).
    _setSlotColor: function(i, hex) {
      if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return;
      if (!this._colorSlots || i < 0 || i >= this._colorSlots.length) return;
      hex = hex.toLowerCase();
      this._colorSlots[i] = hex;
      var btn = (this.swatchEls || [])[i];
      if (btn) {
        btn.dataset.color = hex;
        btn.title = hex;
        btn.style.background = hex;
        btn.setAttribute("aria-label", "Color slot " + (i + 1) + ": " + hex);
      }
      if (i === this._activeSlot) this.activeColor = hex;
    },

    // Generic persistence hook for the color palette — fires on every
    // committed slot edit. Two channels (mirrors `etcher:annotations-
    // changed` + the lifecycle CustomEvents) so consumers can persist
    // server-side (LiveView `handle_event` → DB / user meta) or in pure
    // JS. Etcher stores nothing itself.
    _emitColorsChanged: function() {
      var colors = (this._colorSlots || []).slice();
      if (this.pushEventTo) {
        this.pushEventTo(this.el, "etcher:colors-changed", {
          fresco_id: this.frescoId || null,
          colors: colors
        });
      }
      this._dispatch("etcher:colors-changed", { colors: colors });
    },

    // Rebuild the toolbar's inline swatch row from `_colorSlots`. Stable
    // order (slot index = position); the selected slot gets
    // `.is-selected`. Seeds the palette on first call. Rebuilt rather
    // than diffed — the row is at most COLOR_SLOTS items and rebuilds are
    // user-driven (slot picks / edits), not per-frame.
    _refreshToolbarSwatches: function() {
      var self = this;
      if (!self.toolbar || !self.colorsMoreBtn) return;
      if (!self._colorSlots || !self._colorSlots.length) self._seedColorSlots();

      // Strip old swatches that are direct children of the toolbar.
      // (Popup swatches live inside `.etcher-popup` and are unaffected
      // by this scoped query.)
      Array.prototype.slice.call(
        self.toolbar.children
      ).forEach(function(child) {
        if (child.classList && child.classList.contains("etcher-swatch")) {
          self.toolbar.removeChild(child);
        }
      });

      self.swatchEls = self._colorSlots.map(function(color, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "etcher-swatch";
        b.dataset.color = color;
        b.dataset.slot = String(i);
        b.title = color;
        b.setAttribute("aria-label", "Color slot " + (i + 1) + ": " + color);
        b.style.background = color;
        if (i === self._activeSlot) b.classList.add("is-selected");
        b.addEventListener("click", function(e) {
          e.preventDefault();
          self._selectSlot(i);
        });
        self.toolbar.insertBefore(b, self.colorsMoreBtn);
        return b;
      });

      // Layout may have changed (active slot moved) — re-run the
      // overflow pinning so the active swatch stays visible.
      self._layoutToolbar();
    },

    _togglePopup: function(kind) {
      var open = this._openPopupKind;
      this._closePopup();
      if (open !== kind) this._openPopup(kind);
    },

    _openPopup: function(kind) {
      var popup = kind === "tools" ? this.toolsPopup : this.colorsPopup;
      var trigger = kind === "tools" ? this.toolsMoreBtn : this.colorsMoreBtn;
      if (!popup || !trigger) return;

      // The hue picker edits the selected slot, so start its knobs at
      // that slot's color when the colors popup opens; refresh the
      // overflowed-slots row so collapsed colors are reachable.
      if (kind === "colors") {
        this._syncPickerToActiveColor();
        this._syncColorsPopup();
      }
      // Defensive: make sure the tools popup reflects the current overflow
      // set right before it's shown (in case a layout pass was missed).
      if (kind === "tools") this._syncToolsPopup();

      // Position above the trigger. Both popup and trigger live in
      // the same container so we work in its coordinate space.
      // Display before measuring so getBoundingClientRect returns
      // real dims (display:none → zero).
      popup.classList.add("is-open");
      var container = this.handle.container;
      var cRect = container.getBoundingClientRect();
      var tRect = trigger.getBoundingClientRect();
      var pRect = popup.getBoundingClientRect();
      var top = (tRect.top - cRect.top) - pRect.height - 8;
      // Strip mode's toolbar uses `position: fixed`, so the popup
      // should too — anchor it directly to the viewport instead of
      // to the container (which scrolls). `getBoundingClientRect` on
      // the trigger returns viewport coords either way.
      if (this.handleKind === "strip") {
        popup.style.position = "fixed";
        popup.style.top = (tRect.top - pRect.height - 8) + "px";
        popup.style.left = "auto";
        // Center horizontally on the trigger button.
        var leftViewport = tRect.left + tRect.width / 2 - pRect.width / 2;
        var maxLeft = window.innerWidth - pRect.width - 8;
        if (leftViewport < 8) leftViewport = 8;
        if (leftViewport > maxLeft) leftViewport = maxLeft;
        popup.style.left = leftViewport + "px";
      } else {
        popup.style.position = "absolute";
        popup.style.top = top + "px";
        // Center horizontally on the trigger button, clamped to the
        // container.
        var leftContainer = (tRect.left - cRect.left) + tRect.width / 2 - pRect.width / 2;
        var maxLeftContainer = cRect.width - pRect.width - 8;
        if (leftContainer < 8) leftContainer = 8;
        if (leftContainer > maxLeftContainer) leftContainer = maxLeftContainer;
        popup.style.left = leftContainer + "px";
      }

      this._openPopupKind = kind;
      // Outside-click closer. Capture phase so we run before
      // inner stopPropagation handlers (toolbar buttons all
      // stopPropagation), and exclude the popup + trigger itself
      // so re-clicks don't immediately reopen.
      var self = this;
      this._popupOutsideClick = function(e) {
        if (popup.contains(e.target)) return;
        if (trigger.contains(e.target)) return;
        self._closePopup();
      };
      document.addEventListener("pointerdown", this._popupOutsideClick, true);
    },

    _closePopup: function() {
      if (this.toolsPopup) this.toolsPopup.classList.remove("is-open");
      if (this.colorsPopup) this.colorsPopup.classList.remove("is-open");
      this._openPopupKind = null;
      if (this._popupOutsideClick) {
        document.removeEventListener("pointerdown", this._popupOutsideClick, true);
        this._popupOutsideClick = null;
      }
    },

    _makeToolButton: function(toolKey, icon, title) {
      var self = this;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.tool = toolKey;
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.innerHTML = icon;
      btn.addEventListener("click", function(e) {
        e.preventDefault();
        self._selectTool(toolKey === "cursor" ? null : toolKey);
      });
      return btn;
    },

    _buildNavButton: function() {
      var self = this;
      self.removeNavBtn = self.handle.appendNavButton(ICONS.pencil, "Annotate", function() {
        self._setAnnotationMode(!self.annotationMode);
      });
    },

    // Eye toggle — show/hide all annotations on the image. Lives
    // above the pencil button so the user reads "look (eye) → edit
    // (pencil)" top to bottom. While hidden, the entire SVG overlay
    // is display:none which automatically hides shapes, handles, the
    // tooltip, title groups, midpoint dots, and any in-flight draft.
    _buildVisibilityButton: function() {
      var self = this;
      self.annotationsVisible = self.annotationsVisible !== false;
      self.visibilityBtn = self.handle.appendNavButton(
        self.annotationsVisible ? ICONS.eye : ICONS.eyeSlash,
        self.annotationsVisible ? "Hide annotations" : "Show annotations",
        function() { self._toggleAnnotationsVisible(); }
      );
    },

    _toggleAnnotationsVisible: function() {
      this.annotationsVisible = !this.annotationsVisible;
      if (this.svg) {
        this.svg.style.display = this.annotationsVisible ? "" : "none";
      }
      // Tooltip and the composer popover live OUTSIDE the SVG (the
      // host page positions them via assigns), so the consumer
      // governs those — we just hide our own painted overlay.
      if (this.tooltipEl) {
        this.tooltipEl.style.display = this.annotationsVisible
          ? this.tooltipEl.style.display
          : "none";
      }
      if (this.visibilityBtn) {
        if (this.visibilityBtn.setIcon) {
          this.visibilityBtn.setIcon(
            this.annotationsVisible ? ICONS.eye : ICONS.eyeSlash
          );
        }
        if (this.visibilityBtn.setTitle) {
          this.visibilityBtn.setTitle(
            this.annotationsVisible ? "Hide annotations" : "Show annotations"
          );
        }
      }
      this._dispatch("etcher:visibility-changed", {
        visible: this.annotationsVisible
      });
    },

    // -------------------------------------------------------------------------
    // Mode + tool selection
    // -------------------------------------------------------------------------

    // Push the current annotations array to the consumer's LiveView.
    // Replaces 0.2.x's per-op `etcher:created` / `etcher:updated` /
    // `etcher:deleted` events with a single bulk event — the consumer
    // pipes the payload through `Fresco.Canvas.put_extension(canvas,
    // "etcher", %{"version" => "1", "annotations" => annotations})`.
    //
    // Every commit / edit / delete in the JS hook ends with
    // `self._emitChanged()` after mutating `self.shapes` in place.
    // True iff a named piece of nav-column chrome (`"pencil"` /
    // `"visibility"`) is enabled. Mirrors Fresco's `:nav_buttons`
    // semantics — `null` allowlist means "no allowlist set, all
    // enabled"; an empty Set means "explicit hide-all."
    _chromeEnabled: function(name) {
      return this._navButtonAllowlist == null ||
             this._navButtonAllowlist.has(name);
    },

    // Microtask-batched `_emitChanged`. Multiple `_addShape` / other
    // mutations queued in the same tick collapse to one emit + one
    // network round-trip — useful when a consumer is splicing in a
    // whole chapter's worth of annotations and would otherwise
    // generate N full-array replays.
    _scheduleEmitChanged: function() {
      if (this._emitChangedScheduled) return;
      this._emitChangedScheduled = true;
      var self = this;
      var run = function() {
        self._emitChangedScheduled = false;
        self._emitChanged();
      };
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run);
    },

    // Splice a single shape into the live layer without remounting.
    // The payload mirrors the persisted-annotation shape used by
    // `_renderAnnotation` (kind, geometry, image_idx / image_id,
    // style, metadata, optional uuid) — same fields the
    // `etcher:annotations-changed` event emits. Returns the shape's
    // uuid (generated if not supplied), or `null` if validation
    // fails. Strip-mode payloads MUST include `image_idx`; without
    // it the renderer can't pick the right per-image overlay.
    //
    // Multiple sibling calls in the same microtask batch into one
    // `etcher:annotations-changed` emit.
    _addShape: function(payload) {
      if (!payload || typeof payload.kind !== "string" || !payload.geometry) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[Etcher] addShape: payload requires `kind` + `geometry`.", payload);
        }
        return null;
      }
      var uuid = (typeof payload.uuid === "string" && payload.uuid)
        ? payload.uuid : genUuidV7();
      var ann = Object.assign({}, payload, { uuid: uuid });

      // Strip mode: hand off to the right per-image overlay before
      // rendering so the SVG element lands on the correct page.
      // Without this `_renderAnnotation` would append to whatever
      // overlay was last active.
      if (this.handleKind === "strip") {
        var idx = ann.image_idx;
        if (typeof idx !== "number" || !this.pageOverlays || !this.pageOverlays[idx]) {
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "[Etcher] addShape: strip mode requires a valid `image_idx`. " +
              "Got `" + idx + "` against " +
              (this.pageOverlays ? this.pageOverlays.length : 0) + " pages."
            );
          }
          return null;
        }
        this._activateOverlayForImage(idx);
      }

      this._renderAnnotation(ann);
      this._scheduleEmitChanged();
      return uuid;
    },

    _addShapes: function(payloads) {
      if (!Array.isArray(payloads)) return [];
      var self = this;
      var out = [];
      for (var i = 0; i < payloads.length; i++) {
        var uuid = self._addShape(payloads[i]);
        if (uuid) out.push(uuid);
      }
      return out;
    },

    _emitChanged: function() {
      if (!this.pushEventTo) return;
      var stripMode = this.handleKind === "strip";
      var payload = (this.shapes || []).map(function(s) {
        var entry = { uuid: s.uuid, kind: s.kind, geometry: s.geometry };
        // Strip annotations carry per-image index (which page of N).
        // Canvas multi-image annotations carry `image_id` (which
        // image on the canvas) — same purpose, different field
        // because the two coordinate models are otherwise distinct
        // (image-natural px vs canvas-pixel). Single-image canvases
        // omit `image_id` entirely.
        if (stripMode && typeof s.image_idx === "number") {
          entry.image_idx = s.image_idx;
        }
        if (!stripMode && typeof s.image_id === "string") {
          entry.image_id = s.image_id;
        }
        if (s.style != null) entry.style = s.style;
        if (s.metadata != null) entry.metadata = s.metadata;
        return entry;
      });
      this.pushEventTo(this.el, "etcher:annotations-changed", {
        fresco_id: this.frescoId || null,
        annotations: payload
      });
    },

    // Dispatch a bubbling CustomEvent on the layer host so consumer JS
    // can react without forking etcher.js. Documented in the README.
    _dispatch: function(name, detail) {
      if (!this.el || typeof CustomEvent !== "function") return;
      try {
        this.el.dispatchEvent(new CustomEvent(name, {
          detail: detail || {},
          bubbles: true
        }));
      } catch (_) {}
    },

    _setAnnotationMode: function(on) {
      var self = this;
      if (self.annotationMode === on) return;
      self.annotationMode = on;
      if (self.toolbar) self.toolbar.classList.toggle("is-active", on);
      // Toolbar just became visible (or just hid). When visible, run
      // the overflow layout immediately — `_layoutToolbar` bails when
      // the toolbar is hidden, so the `off` path is a no-op.
      if (on) self._layoutToolbar();

      // In Fresco 0.5 pan/zoom isn't a set of toggleable gesture flags
      // on an OSD viewer — it's the engine's own pointer/wheel handlers
      // on the host. We block them while drawing by:
      //   (1) routing pointer events through the overlay wrapper (which
      //       has `pointer-events: auto` only when annotation mode is on),
      //   (2) calling `e.stopPropagation()` inside the overlay's own
      //       pointerdown handler so it never bubbles to Fresco's host
      //       and triggers `setPointerCapture` → pan.
      // No gesture-flag freeze/restore dance is needed.

      if (!on) {
        self._selectTool(null);
        self._cancelDraft();
        self._exitEditMode();
        self._clearSelection();
        self._closePopup();
      }

      self._dispatch("etcher:mode-changed", { annotationMode: on });
    },

    _selectTool: function(toolKey) {
      var self = this;
      if (self.activeTool !== toolKey) self._cancelDraft();
      // Leaving the eraser tool clears any in-flight hover preview
      // so a grayed shape doesn't get stuck looking "about to delete"
      // after the user picks a different tool.
      if (self.activeTool === "eraser" && toolKey !== "eraser") {
        self._clearEraserHover();
      }
      self.activeTool = toolKey;
      // Drawing and editing are mutually exclusive — picking a tool
      // means we're done admiring the current edit. Same goes for
      // multi-selection: entering draw mode clears the group so a
      // stray Backspace mid-draw doesn't wipe the selected shapes.
      if (toolKey != null) {
        self._exitEditMode();
        self._clearSelection();
      }

      // Sync `.is-selected` across the main toolbar AND the
      // compact-mode tools popup. The popup is an alternate UI; its
      // buttons must reflect the same selected state so re-opening
      // it shows the current tool highlighted.
      function syncToolButtons(root) {
        if (!root) return;
        root.querySelectorAll("button[data-tool]").forEach(function(b) {
          var match = (toolKey == null && b.dataset.tool === "cursor") ||
                      (toolKey != null && b.dataset.tool === toolKey);
          b.classList.toggle("is-selected", match);
        });
      }
      syncToolButtons(self.toolbar);
      syncToolButtons(self.toolsPopup);

      // Wrapper catches input only while a drawing tool is active. Shapes
      // catch their own hover + click independently via CSS, so the
      // wrapper can stay `pointer-events: none` in every other state and
      // let background clicks pass through to OSD's canvas.
      var drawingNow = toolKey != null;
      if (self.overlayWrapper) {
        self.overlayWrapper.style.pointerEvents = drawingNow ? "auto" : "none";
        self.overlayWrapper.classList.toggle("is-drawing", drawingNow);
      }
      // Strip mode has no overlay wrapper (per-image overlays sit on the
      // scroll container directly). Apply the crosshair cursor + is-
      // drawing class to the container so the user gets the same visual
      // affordance, and the scroll container's native gestures still
      // bubble for non-draw moments. Restore the original cursor on tool
      // exit; `''` is the spec-correct way to clear an inline style.
      if (self.handleKind === "strip" && self.handle && self.handle.container) {
        self.handle.container.classList.toggle("etcher-strip-drawing", drawingNow);
        self.handle.container.style.cursor = drawingNow ? "crosshair" : "";
      }
      if (drawingNow) self._hideTooltip();

      // Active tool changed → re-pin in the overflow layout so the
      // newly-active button never sits in the collapsed set.
      self._layoutToolbar();

      self._dispatch("etcher:tool-changed", { tool: toolKey });
    },

    // Color picker — affects the active draft if drawing, the editing
    // shape if one is being edited, and the default for future shapes.
    // `null` resets to the CSS default blue.
    _selectColor: function(color) {
      this.activeColor = color;
      this._dispatch("etcher:color-changed", { color: color });

      // Sync `.is-selected` across the main toolbar swatches AND
      // the compact-mode colors popup. Same alternate-UI rationale
      // as the tool-button sync above.
      // Toolbar swatches highlight by slot index (two slots can hold the
      // same color, so a color match would light up both).
      var activeSlot = this._activeSlot;
      if (this.swatchEls) {
        this.swatchEls.forEach(function(el, i) {
          el.classList.toggle("is-selected", i === activeSlot);
        });
      }
      if (this.colorsPopupBtns) {
        this.colorsPopupBtns.forEach(function(el) {
          el.classList.toggle("is-selected", el.dataset.color === color);
        });
      }
      // Preview chip in the picker reflects the active color so
      // \"this is what you have selected\" reads consistently whether
      // the source was a preset, a recent, or the picker itself.
      if (this._pickerPreview && typeof color === "string") {
        this._pickerPreview.style.background = color;
      }

      // Active swatch changed → re-pin in the overflow layout so the
      // newly-active swatch is the one that stays visible.
      this._layoutToolbar();

      // Apply to the in-flight draft (if any) so the user sees the new
      // color while still drawing.
      if (this.draftState) {
        this._applyShapeColor(this.draftState.el, color);
      }
      if (this.draftPolygon) {
        this._applyShapeColor(this.draftPolygon.el, color);
      }

      // Apply to the currently-edited shape and commit upstream so the
      // server's `style` field reflects the change.
      var shape = this.editingShape;
      if (shape && shape.uuid) {
        var historyBefore = this._snapshotShape(shape);
        shape.style = Object.assign({}, shape.style || {}, { color: color });
        this._applyShapeColor(shape.el, color);
        // Keep the inline title sibling in sync with the shape color.
        if (shape.titleGroup) shape.titleGroup.style.color = color || "";
        this._emitChanged();
        this._pushUndo(shape.uuid, historyBefore, this._snapshotShape(shape));
      }

      // Repaint any active handles so the vertex dots match the new
      // shape color immediately instead of waiting for the next handle
      // refresh.
      var handleColor = color || "#3b82f6";
      (this.handles || []).forEach(function(h) { h.style.color = handleColor; });
      (this.titleHandles || []).forEach(function(h) { h.style.color = handleColor; });
    },

    _applyShapeColor: function(el, color) {
      if (!el) return;
      // Callout shapes use a <g> with `currentColor`-bound children
      // (line stroke + dot fill + text fill). Setting `style.color` on
      // the group propagates through the SVG `currentColor` keyword so
      // every child picks it up, and we skip the rgba fill-opacity that
      // would make the dot + text semi-transparent.
      if (el.tagName && el.tagName.toLowerCase() === "g") {
        el.style.color = color || "";
        return;
      }
      if (color) {
        el.style.stroke = color;
        el.style.fill = color;
        el.style.fillOpacity = "0.18";
      } else {
        el.style.stroke = "";
        el.style.fill = "";
        el.style.fillOpacity = "";
      }
    },

    // -------------------------------------------------------------------------
    // Coord helpers — canvas px ↔ container px (the SVG's coordinate space)
    //
    // Fresco 0.5's `handle.screenToImage` / `handle.imageToScreen` are
    // stable round-trips: the CSS-transform engine doesn't have OSD's
    // tile-source axis-shift (no tile pyramid) or modal-traversal drift
    // (uses standard getBoundingClientRect throughout). So Etcher
    // delegates straight to the handle here — none of the workaround
    // math from 0.2.x is needed.
    //
    // Geometry stays in canvas-pixel coords (Fresco.Canvas's coordinate
    // system) so annotations compose uniformly across multi-image
    // canvases and travel verbatim through `.fresco` files.
    // -------------------------------------------------------------------------

    _toImage: function(e) {
      // Both handle shapes expose `screenToImage({x, y})` but the
      // return is different: canvas returns `{x, y}` in canvas-pixel
      // coords; strip returns `{imageIdx, x, y}` in per-image natural
      // pixel coords. Strip draw paths consume `imageIdx`; canvas
      // draw paths ignore it (extra field is harmless).
      return this.handle.screenToImage({ x: e.clientX, y: e.clientY });
    },

    _imageToContainer: function(pt) {
      // Strip mode: each shape's SVG element lives inside a per-image
      // overlay whose `viewBox` is set to that image's natural pixel
      // dimensions. So SVG attrs in image-pixel coords render
      // correctly without any transform — the identity case lets the
      // existing per-shape render switch in `_renderShape` work
      // unchanged.
      if (this.handleKind === "strip") return pt;

      // Canvas mode: convert image-pixel → container-pixel for the
      // single canvas-spanning overlay SVG. Fresco's imageToScreen
      // returns page coords; subtract the container origin.
      var page = this.handle.imageToScreen(pt);
      var r = this.handle.container.getBoundingClientRect();
      return { x: page.x - r.left, y: page.y - r.top };
    },

    // Render one shape (or draft) by projecting its image-px geometry into
    // container-px coordinates and writing the result onto its SVG element.
    // For non-callout shapes that carry `metadata.title`, also renders a
    // sibling `<text>` element above the shape's bounding box (or at
    // `metadata.title_offset` if the user has dragged it).
    _renderShape: function(shape) {
      if (!shape || !shape.el) return;
      var self = this;
      var g = shape.geometry;
      var el = shape.el;
      // Track the bbox top-center in IMAGE coords for non-callout shapes
      // — populated below in each switch branch, used after the switch
      // to place the title sibling. Image coords (not container) so the
      // user-saved `metadata.title_offset` survives pan/zoom.
      var bboxTopImage = null;

      switch (shape.kind) {
        case "rectangle": {
          var tl = self._imageToContainer({ x: g.x,         y: g.y });
          var br = self._imageToContainer({ x: g.x + g.w,   y: g.y + g.h });
          el.setAttribute("x", Math.min(tl.x, br.x));
          el.setAttribute("y", Math.min(tl.y, br.y));
          el.setAttribute("width",  Math.abs(br.x - tl.x));
          el.setAttribute("height", Math.abs(br.y - tl.y));
          bboxTopImage = { x: g.x + g.w / 2, y: g.y };
          break;
        }
        case "circle": {
          var c  = self._imageToContainer({ x: g.cx, y: g.cy });
          var rp = self._imageToContainer({ x: g.cx + g.r, y: g.cy });
          el.setAttribute("cx", c.x);
          el.setAttribute("cy", c.y);
          el.setAttribute("r", Math.abs(rp.x - c.x));
          bboxTopImage = { x: g.cx, y: g.cy - g.r };
          break;
        }
        case "polygon": {
          var minIX = Infinity, maxIX = -Infinity, minIY = Infinity;
          var pts = (g.points || []).map(function(p) {
            if (p[0] < minIX) minIX = p[0];
            if (p[0] > maxIX) maxIX = p[0];
            if (p[1] < minIY) minIY = p[1];
            var s = self._imageToContainer({ x: p[0], y: p[1] });
            return s.x + "," + s.y;
          }).join(" ");
          el.setAttribute("points", pts);
          if (isFinite(minIX) && isFinite(minIY)) {
            bboxTopImage = { x: (minIX + maxIX) / 2, y: minIY };
          }
          break;
        }
        case "freehand": {
          if (g.nodes) {
            // Vector curve: draw the cubic-bezier path; derive the title-
            // anchor bbox from the flattened curve so it hugs the real
            // outline, not just the sparse anchor points.
            el.setAttribute("d", self._freehandPathD(g.nodes, function(p) {
              return self._imageToContainer({ x: p[0], y: p[1] });
            }));
            var flat = self._freehandFlatten(g);
            var fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity;
            for (var fi = 0; fi < flat.length; fi++) {
              if (flat[fi][0] < fMinX) fMinX = flat[fi][0];
              if (flat[fi][0] > fMaxX) fMaxX = flat[fi][0];
              if (flat[fi][1] < fMinY) fMinY = flat[fi][1];
            }
            if (isFinite(fMinX) && isFinite(fMinY)) {
              bboxTopImage = { x: (fMinX + fMaxX) / 2, y: fMinY };
            }
          } else {
            // Legacy raw polyline (pre-vector strokes).
            var lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity;
            var lpts = (g.points || []).map(function(p) {
              if (p[0] < lMinX) lMinX = p[0];
              if (p[0] > lMaxX) lMaxX = p[0];
              if (p[1] < lMinY) lMinY = p[1];
              var s = self._imageToContainer({ x: p[0], y: p[1] });
              return s.x + "," + s.y;
            }).join(" ");
            el.setAttribute("points", lpts);
            if (isFinite(lMinX) && isFinite(lMinY)) {
              bboxTopImage = { x: (lMinX + lMaxX) / 2, y: lMinY };
            }
          }
          break;
        }
        case "callout": {
          // shape.el is a <g> containing <line>, <rect> (text bbox),
          // <text>, and <circle> (anchor dot). The text endpoint is a
          // resizable bbox (`geometry.text_box`) that behaves like a
          // text shape — leader line connects the anchor to the bbox's
          // nearest edge midpoint.
          // First <line> child is the leader; the .etcher-callout-
          // underline class identifies the horizontal underline.
          var lineEls = el.querySelectorAll("line");
          var coLine = lineEls[0];
          var coUnderline = el.querySelector(".etcher-callout-underline");
          var coDot  = el.querySelector("circle");
          var coRect = el.querySelector(".etcher-text-rect");
          var coText = el.querySelector(".etcher-text-content");

          var anchor = self._imageToContainer({ x: g.anchor[0], y: g.anchor[1] });

          // Tolerate the legacy `text_at` point shape — derive a
          // default bbox at the legacy point so existing rows render.
          var box = self._calloutTextBoxImage(g);
          var bTL = self._imageToContainer({ x: box.x,           y: box.y           });
          var bBR = self._imageToContainer({ x: box.x + box.w,   y: box.y + box.h   });
          var bx = Math.min(bTL.x, bBR.x);
          var by = Math.min(bTL.y, bBR.y);
          var bw = Math.abs(bBR.x - bTL.x);
          var bh = Math.abs(bBR.y - bTL.y);

          if (coRect) {
            coRect.setAttribute("x", bx);
            coRect.setAttribute("y", by);
            coRect.setAttribute("width",  bw);
            coRect.setAttribute("height", bh);
          }
          if (coText) {
            var calloutText = (shape.metadata && shape.metadata.title) || "";
            var coPad = 4;
            var coFontFamily = "ui-sans-serif, system-ui, -apple-system, sans-serif";
            var coFontWeight = "500";
            var coFontSizeByHeight = Math.max(10, bh * 0.65);

            // Width-fit cap: same fix `_renderTitleSibling` got in
            // 0.2.3 — without it, callout text that overflows the box
            // width at the height-derived font-size wraps onto
            // multiple lines, `coActualH` exceeds `bh`, the snap on
            // body-drag release writes that taller height back into
            // `geometry.text_box`, the next render derives an even
            // larger font, more lines wrap, and the callout grows
            // exponentially per interaction. Capping the font-size so
            // the text fits the box width on a single line bounds
            // `coActualH` to one line of text and breaks the cycle.
            if (!self._measureCanvas) {
              self._measureCanvas = document.createElement("canvas");
            }
            var coCtx = self._measureCanvas.getContext("2d");
            coCtx.font = coFontWeight + " " + coFontSizeByHeight + "px " + coFontFamily;
            var coWidthAtHeightFont;
            try { coWidthAtHeightFont = coCtx.measureText(calloutText).width; }
            catch (_) { coWidthAtHeightFont = calloutText.length * coFontSizeByHeight * 0.55; }
            var coAvailWidth = Math.max(1, bw - coPad * 2);
            var coFontSize = coFontSizeByHeight;
            if (coWidthAtHeightFont > coAvailWidth) {
              coFontSize = Math.max(10, coFontSizeByHeight * coAvailWidth / coWidthAtHeightFont);
            }

            coText.setAttribute("x", bx + coPad);
            coText.setAttribute("y", by + coPad);
            coText.setAttribute("font-size", coFontSize);
            coText.setAttribute("font-family", coFontFamily);
            coText.setAttribute("font-weight", coFontWeight);
            // Cross-browser baseline fix: override the factory-default
            // `dominant-baseline: hanging` with `alphabetic` (the
            // default for SVG text). Safari's `hanging` interpretation
            // renders text ABOVE the hanging baseline, Firefox's
            // renders text BELOW per spec — so a callout that fits in
            // Safari shows its text below the rect in Firefox. Both
            // browsers honor `alphabetic` identically, and the wrap
            // helper's `dy="1em"` on the first tspan still positions
            // the line one em below the text element's y (the
            // alphabetic baseline lands at by + coPad + coFontSize).
            coText.setAttribute("dominant-baseline", "alphabetic");
            var coMeasured = self._fillTextWithWrappedTspans(
              coText, calloutText, coAvailWidth, coFontSize
            );

            // Shrink-wrap the callout's text bbox the same way text
            // shapes and titles do — keeps the underline + leader
            // attached to the visible text edge. `_renderedBox` is
            // the shrunk visual; geometry.text_box stays at the
            // user-set size. Handle drag math (in _startHandleDrag
            // / _applyHandleDrag) uses delta from startPt against
            // the FULL geometry, so dragging a handle never bakes
            // the visual shrink back into the storage box.
            var coActualW = Math.max(coMeasured.width + coPad * 2, coFontSize);
            var coActualH = Math.max(coMeasured.height + coPad * 2, coFontSize * 1.2);
            if (coRect) {
              coRect.setAttribute("width",  coActualW);
              coRect.setAttribute("height", coActualH);
            }
            var cosx = bw > 0 ? bw / box.w : 1;
            var cosy = bh > 0 ? bh / box.h : cosx;
            shape._renderedBox = {
              x: box.x,
              y: box.y,
              w: cosx > 0 ? coActualW / cosx : box.w,
              h: cosy > 0 ? coActualH / cosy : box.h
            };
            bw = coActualW;
            bh = coActualH;
          } else {
            shape._renderedBox = null;
          }

          // Underline spans the full bottom edge of the bbox.
          var bxRight = bx + bw;
          var byBottom = by + bh;
          if (coUnderline) {
            coUnderline.setAttribute("x1", bx);
            coUnderline.setAttribute("y1", byBottom);
            coUnderline.setAttribute("x2", bxRight);
            coUnderline.setAttribute("y2", byBottom);
          }

          if (coLine) {
            // Leader attaches to whichever bottom corner sits closer
            // to the anchor. Blueprint-style: anchor on the left →
            // line meets the bottom-left vertex; on the right → meets
            // the bottom-right.
            var bottomMidX = bx + bw / 2;
            var attachX = anchor.x < bottomMidX ? bx : bxRight;
            coLine.setAttribute("x1", anchor.x);
            coLine.setAttribute("y1", anchor.y);
            coLine.setAttribute("x2", attachX);
            coLine.setAttribute("y2", byBottom);
          }
          if (coDot) {
            coDot.setAttribute("cx", anchor.x);
            coDot.setAttribute("cy", anchor.y);
          }
          break;
        }
        case "text": {
          // <g> wrapping a hit-zone <rect> and a content <text>. After
          // initial rect+text positioning, the rect shrinks to hug
          // the actual rendered text — width and height = text + pad.
          // The cached `shape._renderedBox` (image px) is what
          // handles + drag math read from so the user interacts with
          // the visible rect, not the storage envelope.
          var trect = el.querySelector(".etcher-text-rect");
          var ttext = el.querySelector(".etcher-text-content");
          var ttl = self._imageToContainer({ x: g.x,         y: g.y });
          var tbr = self._imageToContainer({ x: g.x + g.w,   y: g.y + g.h });
          var tx = Math.min(ttl.x, tbr.x);
          var ty = Math.min(ttl.y, tbr.y);
          var tw = Math.abs(tbr.x - ttl.x);
          var th = Math.abs(tbr.y - ttl.y);

          if (trect) {
            trect.setAttribute("x", tx);
            trect.setAttribute("y", ty);
            trect.setAttribute("width",  tw);
            trect.setAttribute("height", th);
          }
          if (ttext) {
            var titleText = (shape.metadata && shape.metadata.title) || "";
            var pad = 4;
            var fontSize = Math.max(10, th * 0.65);
            ttext.setAttribute("x", tx + pad);
            ttext.setAttribute("y", ty + pad);
            ttext.setAttribute("font-size", fontSize);
            ttext.setAttribute(
              "font-family",
              "ui-sans-serif, system-ui, -apple-system, sans-serif"
            );
            ttext.setAttribute("font-weight", "500");
            // Cross-browser baseline fix — see callout render block.
            // `hanging` is interpreted differently by Safari and Firefox
            // for Latin text; switching to `alphabetic` (the SVG
            // default) keeps text positioned identically across browsers.
            ttext.setAttribute("dominant-baseline", "alphabetic");
            var measured =
              self._fillTextWithWrappedTspans(ttext, titleText, tw - pad * 2, fontSize);

            var actualW = Math.max(measured.width + pad * 2, fontSize);
            var actualH = Math.max(measured.height + pad * 2, fontSize * 1.2);
            if (trect) {
              trect.setAttribute("width",  actualW);
              trect.setAttribute("height", actualH);
            }
            var sx = tw > 0 ? tw / g.w : 1;
            var sy = th > 0 ? th / g.h : sx;
            shape._renderedBox = {
              x: g.x,
              y: g.y,
              w: sx > 0 ? actualW / sx : g.w,
              h: sy > 0 ? actualH / sy : g.h
            };
          } else {
            shape._renderedBox = null;
          }
          break;
        }
        case "dimension": {
          // <g> with: <line> shaft, two <polyline> V-arrows at the
          // endpoints, and a <text> label that floats at a 0–1 offset
          // along the line (default midpoint). Arrow color follows
          // the shape's currentColor; label is always black with a
          // white halo for cross-color readability.
          var shaftEl = el.querySelector(".etcher-dim-shaft");
          var arrowEls = el.querySelectorAll(".etcher-dim-arrow");
          var labelEl = el.querySelector(".etcher-dim-label");

          var aImg = { x: g.a[0], y: g.a[1] };
          var bImg = { x: g.b[0], y: g.b[1] };
          var aC = self._imageToContainer(aImg);
          var bC = self._imageToContainer(bImg);

          if (shaftEl) {
            shaftEl.setAttribute("x1", aC.x);
            shaftEl.setAttribute("y1", aC.y);
            shaftEl.setAttribute("x2", bC.x);
            shaftEl.setAttribute("y2", bC.y);
          }

          // V-arrowheads at each endpoint, opening backward toward
          // the other end. Skip when the line is degenerate (length
          // 0) — draft state during the very first pointermove tick.
          var ddx = bC.x - aC.x;
          var ddy = bC.y - aC.y;
          var dlen = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dlen > 0.001) {
            var ux = ddx / dlen, uy = ddy / dlen;
            var arrowLen = 10;
            var arrowHalfWidth = 5;
            // Arrow at A: tip at A, wings extending toward B
            // (`+ u * arrowLen`) ± perpendicular.
            var aWxA = aC.x + ux * arrowLen + -uy * arrowHalfWidth;
            var aWyA = aC.y + uy * arrowLen + ux * arrowHalfWidth;
            var aWxB = aC.x + ux * arrowLen - -uy * arrowHalfWidth;
            var aWyB = aC.y + uy * arrowLen - ux * arrowHalfWidth;
            if (arrowEls[0]) {
              arrowEls[0].setAttribute(
                "points",
                aWxA + "," + aWyA + " " + aC.x + "," + aC.y + " " + aWxB + "," + aWyB
              );
            }
            // Arrow at B: tip at B, wings extending toward A
            // (`- u * arrowLen`) ± perpendicular.
            var bWxA = bC.x - ux * arrowLen + -uy * arrowHalfWidth;
            var bWyA = bC.y - uy * arrowLen + ux * arrowHalfWidth;
            var bWxB = bC.x - ux * arrowLen - -uy * arrowHalfWidth;
            var bWyB = bC.y - uy * arrowLen - ux * arrowHalfWidth;
            if (arrowEls[1]) {
              arrowEls[1].setAttribute(
                "points",
                bWxA + "," + bWyA + " " + bC.x + "," + bC.y + " " + bWxB + "," + bWyB
              );
            }
          } else {
            if (arrowEls[0]) arrowEls[0].setAttribute("points", "");
            if (arrowEls[1]) arrowEls[1].setAttribute("points", "");
          }

          // Label at lerp(A, B, title_offset). Always horizontal
          // (text-anchor middle, alphabetic baseline) so the label
          // stays readable at any line angle. The white halo created
          // by stroke + paint-order visually breaks the shaft line
          // behind the text.
          if (labelEl) {
            var labelText = (shape.metadata && shape.metadata.title) || "";
            var tOff = 0.5;
            if (shape.metadata && typeof shape.metadata.title_offset === "number") {
              tOff = Math.max(0, Math.min(1, shape.metadata.title_offset));
            }
            var labelX = aC.x + (bC.x - aC.x) * tOff;
            var labelYCenter = aC.y + (bC.y - aC.y) * tOff;
            var dimFontSize = 14;
            labelEl.setAttribute("x", labelX);
            // y here positions the alphabetic baseline; offset by
            // ~0.35em so the visible text glyphs are vertically
            // centered on the shaft line.
            labelEl.setAttribute("y", labelYCenter + dimFontSize * 0.35);
            labelEl.setAttribute("font-size", dimFontSize);
            labelEl.setAttribute(
              "font-family",
              "ui-sans-serif, system-ui, -apple-system, sans-serif"
            );
            labelEl.setAttribute("font-weight", "500");
            labelEl.textContent = labelText;
          }

          bboxTopImage = {
            x: (aImg.x + bImg.x) / 2,
            y: Math.min(aImg.y, bImg.y)
          };
          break;
        }
        case "line": {
          // Bare stroked line A→B — no arrows, no inline label. Title
          // (if any) is rendered above by the standard sibling path
          // (see `_renderTitleSibling` below).
          var lineShaft = el.querySelector(".etcher-line-shaft");
          var lAImg = { x: g.a[0], y: g.a[1] };
          var lBImg = { x: g.b[0], y: g.b[1] };
          var lAC = self._imageToContainer(lAImg);
          var lBC = self._imageToContainer(lBImg);
          if (lineShaft) {
            lineShaft.setAttribute("x1", lAC.x);
            lineShaft.setAttribute("y1", lAC.y);
            lineShaft.setAttribute("x2", lBC.x);
            lineShaft.setAttribute("y2", lBC.y);
          }
          bboxTopImage = {
            x: (lAImg.x + lBImg.x) / 2,
            y: Math.min(lAImg.y, lBImg.y)
          };
          break;
        }
      }

      // Inline title sibling for non-callout shapes (rect/circle/poly/
      // freehand/line). Callout renders its title as a child <text>
      // inside its <g>; dimension paints the title inline along the
      // shaft. Text is its own free-floating-label shape kind.
      if (shape.kind !== "callout" && shape.kind !== "text" && shape.kind !== "dimension") {
        // Cache so title-drag handlers can resolve the default
        // anchor without recomputing the parent's bbox.
        shape.bboxTopImage = bboxTopImage;
        self._renderTitleSibling(shape, bboxTopImage);
      }
    },

    // Render a movable "title group" for shapes that carry a non-blank
    // `metadata.title`. The group is a callout-style satellite:
    // bbox + scaled+wrapped text + a thin leader line back to the
    // parent shape's nearest perimeter point. Drag the title to move
    // it (persisted as `metadata.title_box`); double-click to open
    // the inline editor; the leader auto-updates.
    _renderTitleSibling: function(shape, bboxTopImage) {
      var title =
        (shape && shape.metadata && shape.metadata.title) ||
        null;
      var trimmed = title && String(title).trim();

      if (!trimmed || !bboxTopImage) {
        if (shape.titleGroup && shape.titleGroup.parentNode) {
          shape.titleGroup.parentNode.removeChild(shape.titleGroup);
        }
        shape.titleGroup = null;
        return;
      }

      if (!shape.titleGroup) {
        var tg = svgEl("g");
        tg.classList.add("etcher-shape", "etcher-text", "etcher-title-group");
        // Leader first so it draws under the bbox + text overlay.
        var tLine = svgEl("line", {
          "stroke-width": "1.5",
          stroke: "currentColor",
          fill: "none"
        });
        tLine.classList.add("etcher-title-leader");
        var tRect = svgEl("rect", {
          fill: "transparent",
          stroke: "currentColor",
          "stroke-width": "2"
        });
        tRect.classList.add("etcher-text-rect");
        var tText = svgEl("text", {
          "text-anchor": "start",
          "dominant-baseline": "hanging",
          fill: "currentColor",
          stroke: "none"
        });
        tText.classList.add("etcher-text-content");
        tg.appendChild(tLine);
        tg.appendChild(tRect);
        tg.appendChild(tText);
        if (shape.uuid) tg.setAttribute("data-title-for", shape.uuid);
        if (shape.style && shape.style.color) tg.style.color = shape.style.color;
        this.svg.appendChild(tg);
        shape.titleGroup = tg;
        this._attachTitleInteractions(shape);
      }

      var titleBox = this._shapeTitleBoxImage(shape, bboxTopImage);
      var tl = this._imageToContainer({ x: titleBox.x,                 y: titleBox.y                 });
      var br = this._imageToContainer({ x: titleBox.x + titleBox.w,    y: titleBox.y + titleBox.h    });
      var tx = Math.min(tl.x, br.x);
      var ty = Math.min(tl.y, br.y);
      var tw = Math.abs(br.x - tl.x);
      var th = Math.abs(br.y - tl.y);

      var rectEl = shape.titleGroup.querySelector(".etcher-text-rect");
      var textEl = shape.titleGroup.querySelector(".etcher-text-content");
      var lineEl = shape.titleGroup.querySelector(".etcher-title-leader");

      if (rectEl) {
        rectEl.setAttribute("x", tx);
        rectEl.setAttribute("y", ty);
        rectEl.setAttribute("width",  tw);
        rectEl.setAttribute("height", th);
      }
      if (textEl) {
        var pad = 4;
        var fontFamily = "ui-sans-serif, system-ui, -apple-system, sans-serif";
        var fontWeight = "500";
        var fontSizeByHeight = Math.max(10, th * 0.65);

        // Width-fit cap: scale the font down so the title fits the box
        // width on a single line. Critical for stability — without it,
        // an overflowing title wraps onto multiple lines, `actualH`
        // exceeds `th`, that taller height gets persisted back into
        // `title_box` on release, the next render derives an even
        // larger font, more lines wrap, and the title grows
        // exponentially per interaction. With the cap, font-size is
        // bounded by both axes and the system has a fixed point.
        if (!this._measureCanvas) {
          this._measureCanvas = document.createElement("canvas");
        }
        var ctx = this._measureCanvas.getContext("2d");
        ctx.font = fontWeight + " " + fontSizeByHeight + "px " + fontFamily;
        var widthAtHeightFont;
        try { widthAtHeightFont = ctx.measureText(trimmed).width; }
        catch (_) { widthAtHeightFont = trimmed.length * fontSizeByHeight * 0.55; }
        var availWidth = Math.max(1, tw - pad * 2);
        var fontSize = fontSizeByHeight;
        if (widthAtHeightFont > availWidth) {
          // Floor of 10 keeps the title legible in pathologically
          // narrow boxes — at that point we let the rect grow past
          // `tw` to fit the text rather than render unreadable glyphs.
          fontSize = Math.max(10, fontSizeByHeight * availWidth / widthAtHeightFont);
        }

        textEl.setAttribute("x", tx + pad);
        textEl.setAttribute("y", ty + pad);
        textEl.setAttribute("font-size", fontSize);
        textEl.setAttribute("font-family", fontFamily);
        textEl.setAttribute("font-weight", fontWeight);
        // Cross-browser baseline fix — see callout render block.
        // `hanging` is interpreted differently by Safari and Firefox
        // for Latin text (Safari renders text above the hanging
        // baseline, Firefox renders below per spec). Switching to
        // `alphabetic` (the SVG default) keeps the title text in the
        // same position in both browsers, with the wrap helper's
        // `dy="1em"` on the first tspan dropping the alphabetic
        // baseline one em below `textEl.y`.
        textEl.setAttribute("dominant-baseline", "alphabetic");
        // At the width-fit font-size the title fits in one line, so
        // the wrap helper produces a single tspan — no multi-line
        // growth path.
        var measured = this._fillTextWithWrappedTspans(
          textEl, trimmed, availWidth, fontSize
        );

        // How we size the rect splits on whether the user has manually
        // sized the title. A freshly-created title carries no
        // `metadata.title_box`, so we shrink-wrap the rect to the text
        // for a tidy label that hugs its content. The moment the user
        // grabs a handle, `metadata.title_box` is written and from then
        // on we honor those exact dimensions every render: resizing
        // sticks instead of collapsing back to the text, and the
        // release-snap in the drag handlers becomes a faithful no-op.
        //
        // (The old code shrink-wrapped unconditionally, then snapped
        // `title_box` to the shrunk box on release. Because the font is
        // `th * 0.65` but the wrapped height lands at `fontSize * 1.2`
        // ≈ `0.78 * th`, every resize persisted a box ~22% shorter and
        // collapsed to the text width — so each grab visibly "scaled
        // the title down again." Honoring the box fixes that.)
        var hasExplicitBox = !!(shape.metadata && shape.metadata.title_box);
        if (hasExplicitBox) {
          // Honor the dragged box. The rect is already at tx/ty/tw/th
          // from above; just vertically center the text line in it and
          // mirror the box into `_renderedTitleImage` so handle
          // positions + drag math operate on the real (visible) rect.
          var centeredY = ty + Math.max(pad, (th - measured.height) / 2);
          textEl.setAttribute("y", centeredY);
          shape._renderedTitleImage = {
            x: titleBox.x,
            y: titleBox.y,
            w: titleBox.w,
            h: titleBox.h
          };
        } else {
          // Shrink-wrap the rect to the rendered text dimensions so
          // handles + the underline sit right at the text edge instead
          // of leaving empty space inside the default bbox.
          var actualW = Math.max(measured.width + pad * 2, fontSize);
          var actualH = Math.max(measured.height + pad * 2, fontSize * 1.2);
          if (rectEl) {
            rectEl.setAttribute("width",  actualW);
            rectEl.setAttribute("height", actualH);
          }
          // Convert the container-px shrink back to image px so handles
          // + drag math operate on the visible rect. Falls back to the
          // input bbox if the scale degenerates.
          var sx = tw > 0 ? tw / titleBox.w : 1;
          var sy = th > 0 ? th / titleBox.h : sx;
          shape._renderedTitleImage = {
            x: titleBox.x,
            y: titleBox.y,
            w: sx > 0 ? actualW / sx : titleBox.w,
            h: sy > 0 ? actualH / sy : titleBox.h
          };
          tw = actualW;
          th = actualH;
        }
      } else {
        shape._renderedTitleImage = null;
      }
      if (lineEl) {
        // If the title sits inside the parent shape, the leader is
        // redundant — the title visibly IS part of the shape. Hide it.
        // Otherwise draw from the title-bbox bottom-center to the
        // closest point on the parent's perimeter for a clean link.
        var titleCenterImage = {
          x: titleBox.x + titleBox.w / 2,
          y: titleBox.y + titleBox.h / 2
        };
        if (this._shapeContainsImagePoint(shape, titleCenterImage)) {
          lineEl.setAttribute("visibility", "hidden");
        } else {
          lineEl.removeAttribute("visibility");
          var titleAnchor = { x: tx + tw / 2, y: ty + th };
          var parentAnchor = this._shapeNearestPoint(shape, titleAnchor);
          lineEl.setAttribute("x1", titleAnchor.x);
          lineEl.setAttribute("y1", titleAnchor.y);
          lineEl.setAttribute("x2", parentAnchor.x);
          lineEl.setAttribute("y2", parentAnchor.y);
        }
      }
    },

    // Image-px point-in-shape test for rect / circle / polygon.
    // Freehand falls through to the polygon test since its geometry
    // is also a points-array. Used by _renderTitleSibling to decide
    // whether the leader line adds value.
    _shapeContainsImagePoint: function(shape, pt) {
      var g = shape.geometry;
      switch (shape.kind) {
        case "rectangle":
          return (
            pt.x >= g.x && pt.x <= g.x + g.w &&
            pt.y >= g.y && pt.y <= g.y + g.h
          );
        case "circle": {
          var dx = pt.x - g.cx, dy = pt.y - g.cy;
          return dx * dx + dy * dy <= g.r * g.r;
        }
        case "polygon":
        case "freehand": {
          // Ray-casting: count edge crossings to the right of `pt`.
          // Freehand curves are flattened to a polyline first so the test
          // follows the rendered bezier outline, not the sparse anchors.
          var pts = shape.kind === "freehand" ? this._freehandFlatten(g) : (g.points || []);
          if (pts.length < 3) return false;
          var inside = false;
          for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            var xi = pts[i][0], yi = pts[i][1];
            var xj = pts[j][0], yj = pts[j][1];
            var intersect =
              ((yi > pt.y) !== (yj > pt.y)) &&
              (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-9) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        }
        default:
          return false;
      }
    },

    // Resolve the title's image-px bbox. Persisted user position lives
    // in `metadata.title_box`; otherwise default above the parent
    // bbox's top-center with a comfortable single-line size.
    _shapeTitleBoxImage: function(shape, bboxTopImage) {
      if (shape && shape.metadata && shape.metadata.title_box) {
        return shape.metadata.title_box;
      }
      if (!bboxTopImage) return null;
      var basePx = this._textDefaultBoxImagePx();
      var w = basePx * 6;
      var h = basePx * 1.4;
      return {
        x: bboxTopImage.x - w / 2,
        y: bboxTopImage.y - h - basePx,
        w: w,
        h: h
      };
    },

    // Return the closest point on a parent shape's perimeter (in
    // container px) to a given container-px point. Used to terminate
    // the title's leader line. Cheap approximations per kind — good
    // enough to read as "the line points at the shape".
    _shapeNearestPoint: function(shape, pt) {
      var self = this;
      var g = shape.geometry;
      switch (shape.kind) {
        case "rectangle": {
          var tl = self._imageToContainer({ x: g.x,         y: g.y });
          var br = self._imageToContainer({ x: g.x + g.w,   y: g.y + g.h });
          var rx1 = Math.min(tl.x, br.x), ry1 = Math.min(tl.y, br.y);
          var rx2 = Math.max(tl.x, br.x), ry2 = Math.max(tl.y, br.y);
          var cx = Math.max(rx1, Math.min(pt.x, rx2));
          var cy = Math.max(ry1, Math.min(pt.y, ry2));
          // Snap onto the nearest edge so the leader doesn't end
          // inside the bbox when the title overlaps the parent.
          var dLeft = Math.abs(cx - rx1), dRight = Math.abs(cx - rx2);
          var dTop = Math.abs(cy - ry1), dBot = Math.abs(cy - ry2);
          var minD = Math.min(dLeft, dRight, dTop, dBot);
          if (minD === dLeft)  cx = rx1;
          else if (minD === dRight) cx = rx2;
          else if (minD === dTop)   cy = ry1;
          else                       cy = ry2;
          return { x: cx, y: cy };
        }
        case "circle": {
          var c  = self._imageToContainer({ x: g.cx, y: g.cy });
          var rp = self._imageToContainer({ x: g.cx + g.r, y: g.cy });
          var r  = Math.abs(rp.x - c.x);
          var dx = pt.x - c.x, dy = pt.y - c.y;
          var d  = Math.sqrt(dx * dx + dy * dy) || 1;
          return { x: c.x + (dx / d) * r, y: c.y + (dy / d) * r };
        }
        case "polygon":
        case "freehand": {
          var src = shape.kind === "freehand" ? self._freehandFlatten(g) : (g.points || []);
          var pts = src.map(function(p) {
            return self._imageToContainer({ x: p[0], y: p[1] });
          });
          var best = null;
          var bestDist = Infinity;
          for (var i = 0; i < pts.length; i++) {
            var d2 = (pts[i].x - pt.x) * (pts[i].x - pt.x) +
                     (pts[i].y - pt.y) * (pts[i].y - pt.y);
            if (d2 < bestDist) { bestDist = d2; best = pts[i]; }
          }
          return best || pt;
        }
        default:
          return pt;
      }
    },

    // Hover + double-click + drag handlers for a shape's title group.
    // Once wired, the title behaves like a satellite text shape that
    // moves independently of the parent but follows it on translate.
    _attachTitleInteractions: function(shape) {
      var self = this;
      var tg = shape.titleGroup;
      if (!tg || tg._etcherWired) return;
      tg._etcherWired = true;

      tg.addEventListener("mouseenter", function() {
        if (self.annotationMode && self.activeTool != null) return;
        tg.classList.add("is-hovered");
      });
      tg.addEventListener("mouseleave", function() {
        tg.classList.remove("is-hovered");
      });
      tg.addEventListener("dblclick", function(e) {
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        e.stopPropagation();
        e.preventDefault();
        self._startTextEdit(shape);
      });
      tg.addEventListener("click", function(e) {
        // Click the title in annotation mode + cursor tool → enter
        // title-edit-mode, which shows 4 corner handles for resizing
        // the title bbox. Drag the title body (separate pointerdown
        // listener below) still moves the whole bbox.
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        e.stopPropagation();
        e.preventDefault();
        self._enterTitleEditMode(shape);
      });
      tg.addEventListener("pointerdown", function(e) {
        if (e.button !== 0) return;
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        self._startTitleDrag(shape, e);
      });
    },

    // -------------------------------------------------------------------------
    // Title edit mode — parallel to `editingShape` but operates on the
    // title bbox (`metadata.title_box`). Shows 4 corner handles that
    // resize the bbox; the font scales automatically with the new
    // height since `_renderTitleSibling` derives font-size from the
    // bbox dimensions.
    // -------------------------------------------------------------------------

    _enterTitleEditMode: function(shape) {
      if (!shape || !shape.titleGroup) return;
      if (this.editingTitleShape === shape) return;
      this._exitEditMode();
      this._exitTitleEditMode();

      this.editingTitleShape = shape;
      shape.titleGroup.classList.add("is-editing");
      this._hideTooltip();
      this._renderTitleHandles(shape);

      var self = this;
      this._titleOutsideClickHandler = function(e) {
        // Clicks on a shape keep title-edit alive (the user might be
        // about to switch focus to that shape) — fall through to the
        // image-px hit-test below. Clicks on Etcher's internals or
        // any registered input-owner (modals, dialogs, ARIA dialogs)
        // also keep edit alive: the click belongs to that UI.
        if (e.target.closest(".etcher-shape")) return;
        if (isInputOwner(e.target, self.overlayWrapper)) return;
        // Shapes are `pointer-events: none`; fall back to image-px
        // hit-test so a click on a sibling shape doesn't tear down
        // title-edit mode before its own handler can react.
        try {
          var pt = self._toImage(e);
          if (self._shapeAt(pt)) return;
        } catch (_) {}
        self._exitTitleEditMode();
      };
      document.addEventListener("click", this._titleOutsideClickHandler, true);
    },

    _exitTitleEditMode: function() {
      if (!this.editingTitleShape) return;
      if (this.editingTitleShape.titleGroup) {
        this.editingTitleShape.titleGroup.classList.remove("is-editing");
      }
      this._removeTitleHandles();
      this.editingTitleShape = null;
      if (this._titleOutsideClickHandler) {
        document.removeEventListener("click", this._titleOutsideClickHandler, true);
        this._titleOutsideClickHandler = null;
      }
    },

    _renderTitleHandles: function(shape) {
      this._removeTitleHandles();
      var box =
        shape._renderedTitleImage ||
        this._shapeTitleBoxImage(shape, this._lastBboxTopImageFor(shape));
      if (!box) return;
      var self = this;
      var positions = [
        { x: box.x,           y: box.y           },  // 0: TL
        { x: box.x + box.w,   y: box.y           },  // 1: TR
        { x: box.x + box.w,   y: box.y + box.h   },  // 2: BR
        { x: box.x,           y: box.y + box.h   }   // 3: BL
      ];
      var handleColor = self._handleColor(shape);
      this.titleHandles = positions.map(function(pt, idx) {
        var h = svgEl("circle", { r: 5 });
        h.classList.add("etcher-handle", "etcher-title-handle");
        h.style.color = handleColor;
        h.dataset.index = idx;
        self.svg.appendChild(h);
        self._positionHandle(h, pt);
        h.addEventListener("pointerdown", function(e) {
          self._startTitleHandleDrag(shape, idx, h, e);
        });
        return h;
      });
    },

    _removeTitleHandles: function() {
      (this.titleHandles || []).forEach(function(h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      this.titleHandles = [];
    },

    _positionAllTitleHandles: function(shape) {
      if (!this.titleHandles || !this.titleHandles.length) return;
      var box =
        shape._renderedTitleImage ||
        this._shapeTitleBoxImage(shape, this._lastBboxTopImageFor(shape));
      if (!box) return;
      var positions = [
        { x: box.x,           y: box.y           },
        { x: box.x + box.w,   y: box.y           },
        { x: box.x + box.w,   y: box.y + box.h   },
        { x: box.x,           y: box.y + box.h   }
      ];
      var self = this;
      this.titleHandles.forEach(function(h, idx) {
        if (positions[idx]) self._positionHandle(h, positions[idx]);
      });
    },

    _startTitleHandleDrag: function(shape, idx, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      this._hideTooltip();

      var self = this;
      // Pre-resize snapshot for the undo stack.
      var historyBefore = self._snapshotShape(shape);
      // Snapshot the rendered (shrink-wrapped) bbox so the drag math
      // starts from what the user actually sees, not the (possibly
      // larger) stored title_box that hasn't yet had a chance to
      // re-fit to the text.
      var startBox = JSON.parse(JSON.stringify(
        shape._renderedTitleImage ||
        this._shapeTitleBoxImage(shape, this._lastBboxTopImageFor(shape))
      ));
      var dragged = false;

      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          // 3px screen-space dead zone — distinguishes "drag to
          // resize" from "I'm just clicking on a handle". Without
          // this, a bare click on a handle would fall through to
          // onUp and fire `etcher:updated`, round-tripping through
          // the LiveView and writing back possibly-normalized
          // title_box values that visibly drift the title's size
          // each click. Same gating the body-drag and title-drag
          // handlers already use.
          var aC = self._imageToContainer(startBox);
          var bC = self._imageToContainer(pt);
          if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
          dragged = true;
        }
        var right = startBox.x + startBox.w;
        var bottom = startBox.y + startBox.h;
        var nx, ny, nw, nh;
        switch (idx) {
          case 0: nx = pt.x;        ny = pt.y;        nw = right - pt.x;        nh = bottom - pt.y;        break;
          case 1: nx = startBox.x;  ny = pt.y;        nw = pt.x - startBox.x;   nh = bottom - pt.y;        break;
          case 2: nx = startBox.x;  ny = startBox.y;  nw = pt.x - startBox.x;   nh = pt.y - startBox.y;    break;
          case 3: nx = pt.x;        ny = startBox.y;  nw = right - pt.x;        nh = pt.y - startBox.y;    break;
          default: return;
        }
        if (nw < 0) { nx += nw; nw = -nw; }
        if (nh < 0) { ny += nh; nh = -nh; }
        shape.metadata = Object.assign({}, shape.metadata || {}, {
          title_box: { x: nx, y: ny, w: nw, h: nh }
        });
        self._renderShape(shape);
        self._positionAllTitleHandles(shape);
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (!dragged) return;
        // Snap stored title_box to the rendered bbox so the
        // persisted dimensions match what's on screen. Now a no-op
        // since `_renderTitleSibling` keeps the rect at user-set
        // dims and `_renderedTitleImage` mirrors title_box, but
        // kept as a safety net in case future render changes
        // reintroduce a divergence.
        if (shape._renderedTitleImage) {
          shape.metadata = Object.assign({}, shape.metadata || {}, {
            title_box: {
              x: shape._renderedTitleImage.x,
              y: shape._renderedTitleImage.y,
              w: shape._renderedTitleImage.w,
              h: shape._renderedTitleImage.h
            }
          });
        }
        if (shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Drag the title group to a new position. Translates the
    // image-px `metadata.title_box` by the pointer delta and persists
    // on release via `etcher:updated { metadata }`.
    _startTitleDrag: function(shape, e) {
      e.preventDefault();
      e.stopPropagation();
      var self = this;
      var tg = shape.titleGroup;
      if (!tg) return;

      try { tg.setPointerCapture(e.pointerId); } catch (_) {}
      tg.classList.add("is-dragging");

      var startPt = this._toImage(e);
      // Pre-drag snapshot for the undo stack.
      var historyBefore = self._snapshotShape(shape);
      // Snapshot the starting bbox; prefer the rendered shrink-fit
      // box so the drag matches the visible rect.
      var bboxTopImage = this._lastBboxTopImageFor(shape);
      var startBox =
        shape._renderedTitleImage ||
        this._shapeTitleBoxImage(shape, bboxTopImage);
      if (!startBox) return;
      var dragged = false;

      function onMove(ev) {
        var pt = self._toImage(ev);
        var dxI = pt.x - startPt.x;
        var dyI = pt.y - startPt.y;
        if (!dragged) {
          // Pixel-space dead-zone so a stationary click doesn't
          // commit a no-op title_box update.
          var aC = self._imageToContainer(startPt);
          var bC = self._imageToContainer(pt);
          if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
          dragged = true;
        }
        var newBox = {
          x: startBox.x + dxI,
          y: startBox.y + dyI,
          w: startBox.w,
          h: startBox.h
        };
        shape.metadata = Object.assign({}, shape.metadata || {}, { title_box: newBox });
        self._renderShape(shape);
        // Title handles (if in title-edit-mode) sit on the bbox
        // corners, so they need to track the moving bbox in lockstep.
        if (self.editingTitleShape === shape) {
          self._positionAllTitleHandles(shape);
        }
      }
      function onUp(ev) {
        tg.classList.remove("is-dragging");
        try { tg.releasePointerCapture(ev.pointerId); } catch (_) {}
        tg.removeEventListener("pointermove", onMove);
        tg.removeEventListener("pointerup", onUp);
        tg.removeEventListener("pointercancel", onUp);
        if (dragged) {
          // Snap to the shrunk-to-text bbox on release — same
          // rationale as the handle-drag path: keep storage aligned
          // with what's drawn. Safe because the width-fit font cap
          // prevents the multi-line growth this used to amplify.
          if (shape._renderedTitleImage) {
            shape.metadata = Object.assign({}, shape.metadata || {}, {
              title_box: {
                x: shape._renderedTitleImage.x,
                y: shape._renderedTitleImage.y,
                w: shape._renderedTitleImage.w,
                h: shape._renderedTitleImage.h
              }
            });
          }
          if (shape.uuid) {
            self._emitChanged();
            self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
          }
        }
      }
      tg.addEventListener("pointermove", onMove);
      tg.addEventListener("pointerup", onUp);
      tg.addEventListener("pointercancel", onUp);
    },

    // The title's default bbox needs the parent's bbox-top-center in
    // IMAGE coords. _renderShape computes this every render; cache
    // the last value on the shape so drag handlers can grab it
    // without re-running the geometry math.
    _lastBboxTopImageFor: function(shape) {
      return shape && shape.bboxTopImage ? shape.bboxTopImage : null;
    },

    // Fill a <text> node with word-wrapped <tspan> lines that fit a
    // pixel-width budget. Returns `{width, height}` of the rendered
    // text in container px so callers can shrink-wrap their bbox to
    // it. Uses a canvas 2D context for measurement instead of SVG's
    // `getComputedTextLength` — canvas runs synchronously and doesn't
    // depend on the SVG element having been laid out yet, so the
    // shrink path is reliable on first render.
    _fillTextWithWrappedTspans: function(textEl, content, maxWidth, fontSize) {
      while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
      if (!content) return { width: 0, height: 0 };

      var words = String(content).split(/\s+/).filter(Boolean);
      if (words.length === 0) return { width: 0, height: 0 };

      var fontFamily = textEl.getAttribute("font-family") ||
        "ui-sans-serif, system-ui, -apple-system, sans-serif";
      var fontWeight = textEl.getAttribute("font-weight") || "500";

      if (!this._measureCanvas) {
        this._measureCanvas = document.createElement("canvas");
      }
      var ctx = this._measureCanvas.getContext("2d");
      ctx.font = fontWeight + " " + fontSize + "px " + fontFamily;

      function measure(s) {
        try { return ctx.measureText(s).width; } catch (_) { return s.length * fontSize * 0.55; }
      }

      var lines = [];
      var current = "";
      var maxLine = 0;
      for (var i = 0; i < words.length; i++) {
        var attempt = current ? current + " " + words[i] : words[i];
        if (measure(attempt) <= maxWidth || !current) {
          current = attempt;
        } else {
          lines.push(current);
          current = words[i];
        }
      }
      if (current) lines.push(current);

      for (var k = 0; k < lines.length; k++) {
        var w = measure(lines[k]);
        if (w > maxLine) maxLine = w;
      }

      var x = textEl.getAttribute("x");
      // Each line is a <tspan> with dy=1.1em after the first. Fill is
      // inherited from the parent <text> via the .etcher-text-content
      // CSS rule, which targets both the text and its tspans so the
      // visible color cascades reliably across browsers (some skip
      // tspan inheritance of presentation attributes).
      lines.forEach(function(line, idx) {
        var tspan = svgEl("tspan", { x: x, dy: idx === 0 ? "1em" : "1.1em" });
        tspan.textContent = line;
        textEl.appendChild(tspan);
      });

      var height = fontSize + Math.max(0, lines.length - 1) * fontSize * 1.1;
      return { width: maxLine, height: height };
    },

    _renderAll: function() {
      var self = this;
      this.shapes.forEach(function(s) { self._renderShape(s); });
      if (this.draftState && this.draftState.kind !== "polygon") {
        this._renderShape(this.draftState);
      }
      if (this.draftPolygon) {
        this._renderPolygonPreview(this._lastHover);
      }
      // Keep handles glued to whichever shape currently "owns" them —
      // edit-mode target if any, otherwise the active draft.
      if (this.editingShape) {
        this._positionAllHandles(this.editingShape);
      } else {
        var d = this._draftActive();
        if (d) this._positionAllHandles(d);
      }
      // Title-edit handles track the title bbox separately from shape
      // edit handles — both can technically be active in parallel only
      // for distinct shapes; we coexist with them rather than gating.
      if (this.editingTitleShape) {
        this._positionAllTitleHandles(this.editingTitleShape);
      }
      // Keep an open tooltip glued to its anchor shape. `_renderAll`
      // runs on every pan/zoom animation frame (after the shapes above
      // have moved), so re-anchoring here makes the tooltip track the
      // shape instead of floating where it first appeared.
      if (this._tooltipShape && this.tooltipEl &&
          this.tooltipEl.style.display !== "none") {
        this._positionTooltip(this._tooltipShape);
      }
    },

    // -------------------------------------------------------------------------
    // Drawing handlers — dispatch to per-tool state machines
    // -------------------------------------------------------------------------

    _onPointerDown: function(e) {
      if (!this.annotationMode || !this.activeTool) return;
      if (e.button !== 0) return;
      var pt = this._toImage(e);

      switch (this.activeTool) {
        case "rectangle": this._startRectangle(pt, e); break;
        case "circle":    this._startCircle(pt, e); break;
        case "polygon":   this._polygonClick(pt); break;
        case "freehand":  this._startFreehand(pt, e); break;
        case "callout":   this._calloutClick(pt); break;
        case "text":      this._startText(pt, e); break;
        case "dimension": this._startDimension(pt, e); break;
        case "line":      this._startLine(pt, e); break;
        case "eraser":    this._startErase(pt, e); break;
      }
    },

    _onPointerMove: function(e) {
      if (!this.draftState) {
        if (this.activeTool === "polygon" && this.draftPolygon) {
          this._polygonHover(this._toImage(e));
        } else if (this.activeTool === "callout" && this.draftCallout) {
          this._calloutHover(this._toImage(e));
        } else if (this.activeTool === "eraser" && this._erasingActive) {
          this._eraserMove(this._toImage(e));
        } else if (this.activeTool === "eraser") {
          // Idle hover — preview the single shape under the cursor.
          this._eraserHover(this._toImage(e));
        }
        // While editing a polygon or rectangle, only the midpoint
        // closest to the cursor is shown. Polygons → "add vertex"
        // dots; rectangles → "drag this edge" dots. Same machinery,
        // different drag semantics.
        if (this.editingShape &&
            (this.editingShape.kind === "polygon" ||
             this.editingShape.kind === "rectangle") &&
            this.midpointHandles && this.midpointHandles.length) {
          this._updateClosestMidpoint(this._toImage(e));
        }
        return;
      }
      var pt = this._toImage(e);
      switch (this.draftState.kind) {
        case "rectangle": this._updateRectangle(pt); break;
        case "circle":    this._updateCircle(pt); break;
        case "freehand":  this._appendFreehand(pt); break;
        case "text":      this._updateText(pt); break;
        case "dimension": this._updateDimension(pt); break;
        case "line":      this._updateDimension(pt); break;
      }
    },

    _onPointerUp: function(e) {
      // Eraser commits independently of the draftState flow since it
      // doesn't build a shape — it grays hits during a press-and-drag
      // and flushes them on release.
      if (this.activeTool === "eraser" && this._erasingActive) {
        this._commitErase();
        return;
      }
      if (!this.draftState) return;
      var pt = this._toImage(e);
      switch (this.draftState.kind) {
        case "rectangle": this._commitRectangle(pt); break;
        case "circle":    this._commitCircle(pt); break;
        case "freehand":  this._commitFreehand(pt); break;
        case "text":      this._commitText(pt); break;
        case "dimension": this._commitDimension(pt); break;
        case "line":      this._commitDimension(pt); break;
      }
    },

    _onDoubleClick: function(e) {
      if (this.activeTool === "polygon" && this.draftPolygon) {
        e.preventDefault();
        e.stopPropagation();
        this._commitPolygon();
      }
    },

    // Attach hover + click handlers to a single shape's SVG element.
    // Tooltip + selection work in any state except an active drawing
    // tool (CSS turns shape pointer-events off in that mode anyway, so
    // these handlers won't fire — the safety check is just defensive).
    _attachShapeInteractions: function(shape) {
      var self = this;
      var el = shape.el;
      if (!el || el._etcherWired) return;
      el._etcherWired = true;

      el.addEventListener("mouseenter", function() {
        if (self.annotationMode && self.activeTool != null) return;
        // Visual hover state (dashed outline, .is-hovered class) is
        // always applied so users can see which shape the cursor is
        // over — even when a different shape's tooltip is pinned.
        el.classList.add("is-hovered");
        // The tooltip, however, defers to the pin: a pinned tooltip
        // stays put until the user clicks elsewhere (or clicks the
        // same shape to unpin). Hovering another shape doesn't yank
        // the pin away.
        if (self.tooltipPinned) return;
        self._showTooltipFor(shape);
      });
      el.addEventListener("mouseleave", function() {
        // Always drop the hover styling so a pinned shape doesn't keep
        // a sticky dashed/selected outline after the cursor leaves.
        // The pin is for tooltip lifecycle, not visual hover state.
        el.classList.remove("is-hovered");
        // Leaving the shape no longer closes the tooltip — the dwell
        // timer (armed on show) owns closing, so it stays for its full
        // window whether the cursor lingers, leaves, or moves to the
        // tooltip itself.
      });
      el.addEventListener("click", function(e) {
        // Direct DOM clicks on shapes are mostly historical now —
        // `.etcher-shape` is `pointer-events: none` so this rarely
        // fires. The doc-level tap handler in
        // `_wireGlobalShapeListeners` drives the common path. Kept
        // as a fallback in case a future caller temporarily flips
        // shape pointer events back on.
        if (self.annotationMode && self.activeTool != null) return;
        // Stop propagation so OSD's canvas (which lives next to us
        // in the container) doesn't also receive the click and
        // trigger a click-to-zoom.
        e.stopPropagation();
        e.preventDefault();
        self._onShapeTap(shape);
      });

      // Double-click on a text or callout (in annotation mode, cursor
      // tool) jumps into inline-edit mode. Matches Figma/Miro muscle
      // memory and lets users tweak the callout's label without
      // re-opening the composer.
      el.addEventListener("dblclick", function(e) {
        if (shape.kind !== "text" && shape.kind !== "callout" && shape.kind !== "dimension") {
          return;
        }
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        e.stopPropagation();
        e.preventDefault();
        self._enterEditMode(shape);
        self._startTextEdit(shape);
      });

      // In annotation cursor mode, the shape body is a grab-handle —
      // a pointerdown anywhere on the shape starts a drag-to-move
      // gesture without requiring a prior tap to enter edit mode. The
      // dead-zone inside `_startShapeMove` keeps stationary clicks
      // from emitting a no-op edit; on pointerup-without-drag, the
      // onUp falls back to `_onShapeTap` so single-click still
      // selects (enters edit mode + shows handles).
      el.addEventListener("pointerdown", function(e) {
        if (e.button !== 0) return;
        if (!self.annotationMode) return;
        if (self.activeTool != null) return;
        e.stopPropagation();
        self._startShapeMove(shape, e);
      });

      // Dimension label is independently draggable along the shaft
      // (writes `metadata.title_offset`). Wires its own pointerdown
      // so the slide gesture starts on label click rather than
      // entering shape-move mode.
      if (shape.kind === "dimension") {
        this._attachDimensionLabelDrag(shape);
      }
    },

    // Drag the dimension label along the shaft. Projects the pointer
    // onto the line and persists the projection scalar (clamped to
    // [0, 1]) as `metadata.title_offset`. Call once per shape — the
    // label element is reused across re-renders so the listener
    // doesn't need to re-bind.
    _attachDimensionLabelDrag: function(shape) {
      var self = this;
      var labelEl = shape.el && shape.el.querySelector(".etcher-dim-label");
      if (!labelEl || labelEl._etcherWired) return;
      labelEl._etcherWired = true;
      labelEl.style.cursor = "grab";

      labelEl.addEventListener("pointerdown", function(e) {
        if (e.button !== 0) return;
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        e.preventDefault();
        e.stopPropagation();

        try { labelEl.setPointerCapture(e.pointerId); } catch (_) {}
        labelEl.style.cursor = "grabbing";
        var historyBefore = self._snapshotShape(shape);
        var startPt = self._toImage(e);
        var dragged = false;

        function onMove(ev) {
          var pt = self._toImage(ev);
          if (!dragged) {
            var aC = self._imageToContainer(startPt);
            var bC = self._imageToContainer(pt);
            if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
            dragged = true;
          }
          var gg = shape.geometry;
          var dxL = gg.b[0] - gg.a[0];
          var dyL = gg.b[1] - gg.a[1];
          var lenSqL = dxL * dxL + dyL * dyL;
          if (lenSqL <= 0.0001) return;
          var tProj = ((pt.x - gg.a[0]) * dxL + (pt.y - gg.a[1]) * dyL) / lenSqL;
          tProj = Math.max(0, Math.min(1, tProj));
          shape.metadata = Object.assign({}, shape.metadata || {}, { title_offset: tProj });
          self._renderShape(shape);
        }

        function onUp(ev) {
          labelEl.removeEventListener("pointermove", onMove);
          labelEl.removeEventListener("pointerup", onUp);
          labelEl.removeEventListener("pointercancel", onUp);
          try { labelEl.releasePointerCapture(ev.pointerId); } catch (_) {}
          labelEl.style.cursor = "grab";
          if (!dragged) return;
          if (shape.uuid) {
            self._emitChanged();
            self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
          }
        }

        labelEl.addEventListener("pointermove", onMove);
        labelEl.addEventListener("pointerup", onUp);
        labelEl.addEventListener("pointercancel", onUp);
      });
    },

    // Shape "tap" — fired either from a direct DOM click on the
    // shape (rare, fallback) or from the doc-level tap detector
    // when the user clicked without dragging. Selects/edits the
    // shape per current mode.
    _onShapeTap: function(shape) {
      if (!shape) return;
      var id = shape.uuid;
      if (this.annotationMode) {
        // Edit handles only appear in annotation mode + cursor tool.
        this._enterEditMode(shape);
      } else {
        // Outside annotation mode: pin the tooltip so the user can
        // dwell on the comment preview without it timing out.
        // Clicking the same shape again unpins; clicking another
        // shape switches the pin.
        if (this.tooltipPinned && this._tooltipShape === shape) {
          this._unpinTooltip();
        } else {
          this._pinTooltipFor(shape);
        }
      }
      // Selection is local UI state in 0.3.x — no server event. (0.2.x's
      // `etcher:selected` event is dropped; consumers who tracked the
      // selected uuid for sidebar UI should drive that off a JS
      // CustomEvent or a future explicit hook if they need it back.)
    },

    // -------------------------------------------------------------------------
    // Global shape listeners — let pan/zoom pass through shapes by
    // making `.etcher-shape` `pointer-events: none` and re-detecting
    // hover + tap at the document level via image-px hit-testing.
    //
    // Without this, OSD's MouseTracker on the canvas sibling never
    // sees the wheel/pointerdown when the cursor is over a shape
    // (events bubble UP the DOM, not sideways), so scroll-zoom and
    // drag-pan stop working over annotations.
    // -------------------------------------------------------------------------

    _wireGlobalShapeListeners: function() {
      var self = this;
      if (self._globalShapeListenersWired) return;
      self._globalShapeListenersWired = true;

      // Gate every handler on "cursor is over the viewer's container."
      // Cheap to compute, keeps us off the hot path of unrelated
      // document mousemoves.
      function overContainer(e) {
        if (!self.handle || !self.handle.container) return false;
        var r = self.handle.container.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right &&
               e.clientY >= r.top && e.clientY <= r.bottom;
      }

      self._docMouseMove = function(e) {
        if (!overContainer(e)) {
          if (self._hoveredShape) self._setHoveredShape(null, false);
          return;
        }
        // Cursor sitting over a modal / dialog shouldn't light up the
        // shape behind it — that's a confusing affordance (the shape
        // looks tappable but it isn't, since the modal owns the click).
        if (isInputOwner(e.target, self.overlayWrapper)) {
          if (self._hoveredShape) self._setHoveredShape(null, false);
          return;
        }
        var pt;
        try { pt = self._toImage(e); } catch (_) { return; }
        var hit = self._shapeAt(pt);
        // If the cursor is on a shape's title satellite (the
        // movable label group), the user is most likely about to
        // grab/drag/edit the title — suppress the tooltip so it
        // doesn't cover the very thing they're trying to grab.
        // Hover styling on the parent stays applied either way.
        var onTitle = !!hit && self._pointOnTitleOf(hit, pt);
        if (hit !== self._hoveredShape || onTitle !== self._hoveredOnTitle) {
          self._setHoveredShape(hit, onTitle);
        }
      };

      // Tap-vs-drag tracker for shape clicks. Records pointerdown
      // over a shape; if the pointer doesn't move past the dead-zone
      // before pointerup, treat it as a tap and fire `_onShapeTap`.
      // If the pointer moves further (a pan-drag), the gesture
      // converts to a drag and we don't fire the tap. OSD owns the
      // actual pan since shapes are `pointer-events: none`.
      self._docPointerDown = function(e) {
        if (e.button !== 0) return;
        if (!overContainer(e)) return;
        // A handle/title/toolbar/modal element under the cursor
        // handles its own event; don't shadow it with a shape tap.
        if (isInputOwner(e.target, self.overlayWrapper)) return;
        // Touch: `_hoveredShape` is unreliable. iOS synthesizes a
        // mousemove at the touchend point after every gesture, which
        // fires `_docMouseMove` and leaves the cache pinned to the
        // last-touched shape regardless of where the next finger
        // actually lands. Always hit-test fresh on touch — the next
        // tap on a different shape (or empty space) needs the real
        // coordinate, not the stale hover cache.
        //
        // Mouse / pen: `mousemove` keeps `_hoveredShape` in sync as
        // the cursor moves, so the cache is accurate. The empty-
        // cache branch is only reached on devices without hover at
        // all (rare for non-touch pointers); fall back to a fresh
        // hit-test there too.
        var hit;
        var ptDirect;
        if (e.pointerType === "touch") {
          try { ptDirect = self._toImage(e); } catch (_) { return; }
          hit = self._shapeAt(ptDirect);
        } else {
          hit = self._hoveredShape;
          if (!hit) {
            try { ptDirect = self._toImage(e); } catch (_) { return; }
            hit = self._shapeAt(ptDirect);
          }
        }
        if (!hit) {
          // Empty click in annotation cursor mode (no modifier)
          // clears any active multi-selection — same affordance
          // most graphics apps use for \"click outside to deselect\".
          if (self.annotationMode && self.activeTool == null && !e.shiftKey &&
              self.selectedShapes && self.selectedShapes.length > 0) {
            self._clearSelection();
          }
          return;
        }

        // Multi-select (Shift+click). Toggles the clicked shape in/
        // out of `selectedShapes` and skips the move/edit flow — the
        // user is grouping shapes for a batch action, not interacting
        // with one. Only meaningful in annotation cursor mode; in
        // browse mode or with a draw tool active, shift+click falls
        // through to the existing behavior.
        if (self.annotationMode && self.activeTool == null && e.shiftKey) {
          self._exitEditMode();
          self._toggleInSelection(hit);
          e.preventDefault();
          return;
        }

        // Click on a shape that's part of a multi-selection (no
        // modifier) drags the whole group together. Anything else
        // exits multi-selection and falls through to single-shape
        // behavior.
        if (self.annotationMode && self.activeTool == null &&
            self.selectedShapes && self.selectedShapes.length > 0) {
          if (self._isInSelection(hit)) {
            self._startMultiShapeMove(hit, e);
            return;
          }
          self._clearSelection();
        }

        // In annotation cursor mode, immediately enter shape-move so the
        // user can drag without first tapping to enter edit mode. Only
        // callouts and text shapes naturally bubble pointerdown to the
        // per-shape listener (their inner rect is pointer-events:all);
        // every other kind has `.etcher-shape { pointer-events: none }`
        // and only reaches us here at the doc level. _startShapeMove's
        // onUp falls back to _onShapeTap when no drag happens, so
        // click-to-select keeps working uniformly.
        if (self.annotationMode && self.activeTool == null) {
          self._startShapeMove(hit, e);
          return;
        }

        // Browse mode (or a draw tool is active): track for click-to-pin
        // only. _pendingTap survives until _docPointerUp; if the pointer
        // didn't move past the dead-zone, _onShapeTap fires.
        self._pendingTap = {
          shape: hit,
          startX: e.clientX,
          startY: e.clientY,
          startedAt: Date.now()
        };
      };
      self._docPointerMove = function(e) {
        if (!self._pendingTap) return;
        var dx = e.clientX - self._pendingTap.startX;
        var dy = e.clientY - self._pendingTap.startY;
        if (dx * dx + dy * dy > 25) self._pendingTap = null; // 5px dead-zone
      };
      self._docPointerUp = function(e) {
        var tap = self._pendingTap;
        self._pendingTap = null;
        if (!tap) return;
        if (Date.now() - tap.startedAt > 500) return;
        // Re-verify the cursor is still over the same shape — guards
        // against the user dragging just under the dead-zone then
        // releasing far from the original shape.
        var pt;
        try { pt = self._toImage(e); } catch (_) { return; }
        if (self._shapeAt(pt) !== tap.shape) return;
        self._onShapeTap(tap.shape);
      };

      // Double-click on text/callout in annotation mode → inline edit.
      // Same container gate + hit-test pattern as the tap handler.
      self._docDblClick = function(e) {
        if (!self.annotationMode || self.activeTool != null) return;
        if (!overContainer(e)) return;
        // Skip if the double-click landed inside a modal or other
        // input-owner — clicking in a comment composer that happens
        // to sit over a text shape shouldn't open the shape's editor.
        if (isInputOwner(e.target, self.overlayWrapper)) return;
        var pt;
        try { pt = self._toImage(e); } catch (_) { return; }
        var hit = self._shapeAt(pt);
        if (!hit) return;
        if (hit.kind !== "text" && hit.kind !== "callout" && hit.kind !== "dimension") {
          return;
        }
        self._enterEditMode(hit);
        self._startTextEdit(hit);
      };

      document.addEventListener("pointermove", self._docMouseMove);
      document.addEventListener("pointerdown", self._docPointerDown);
      document.addEventListener("pointermove", self._docPointerMove);
      document.addEventListener("pointerup", self._docPointerUp);
      document.addEventListener("dblclick", self._docDblClick);
    },

    _unwireGlobalShapeListeners: function() {
      if (!this._globalShapeListenersWired) return;
      this._globalShapeListenersWired = false;
      if (this._docMouseMove)
        document.removeEventListener("pointermove", this._docMouseMove);
      if (this._docPointerDown)
        document.removeEventListener("pointerdown", this._docPointerDown);
      if (this._docPointerMove)
        document.removeEventListener("pointermove", this._docPointerMove);
      if (this._docPointerUp)
        document.removeEventListener("pointerup", this._docPointerUp);
      if (this._docDblClick)
        document.removeEventListener("dblclick", this._docDblClick);
      this._docMouseMove = this._docPointerDown = null;
      this._docPointerMove = this._docPointerUp = this._docDblClick = null;
      this._pendingTap = null;
      this._setHoveredShape(null, false);
    },

    // Diff the currently-hovered shape against the new one. Fires
    // mouseenter/leave-style transitions: removes `.is-hovered` +
    // schedules tooltip hide on the previous shape; adds
    // `.is-hovered` + shows tooltip on the new one. Pinned tooltips
    // are left alone.
    //
    // `onTitle` (bool) means the cursor is specifically over the
    // shape's title satellite. Hover styling on the parent shape
    // still applies, but the tooltip is suppressed so it doesn't
    // sit on top of the very label the user is trying to grab.
    _setHoveredShape: function(next, onTitle) {
      onTitle = !!onTitle;
      var prev = this._hoveredShape;
      var prevOnTitle = this._hoveredOnTitle === true;

      // Hide the tooltip when we just moved ONTO the title (suppress
      // per the rule above so the tooltip doesn't cover the label).
      // Moving off a shape entirely no longer hides — the dwell timer
      // owns closing now, so the tooltip stays for its full window
      // regardless of where the cursor wanders.
      var hideTooltip = next && onTitle && !prevOnTitle;
      // Show the tooltip when:
      // 1. We just moved onto a NEW shape's body.
      // 2. We moved off the title back onto the body of the same shape.
      var showTooltip =
        next && !onTitle &&
        (next !== prev || (next === prev && prevOnTitle));

      if (prev !== next && prev && prev.el) {
        prev.el.classList.remove("is-hovered");
      }
      if (prev !== next && next && next.el) {
        next.el.classList.add("is-hovered");
      }
      if (hideTooltip && !this.tooltipPinned) this._scheduleHideTooltip();
      if (showTooltip && !this.tooltipPinned) this._showTooltipFor(next);

      this._hoveredShape = next;
      this._hoveredOnTitle = onTitle;
      if (this.overlayWrapper) {
        this.overlayWrapper.classList.toggle("is-shape-hovered", !!next);
      }
    },

    // True iff `pt` (image-px) lies inside `shape`'s title satellite
    // (only present for rect/circle/polygon/freehand with a non-blank
    // `metadata.title`). Used to suppress the tooltip while the user
    // is interacting with the movable title label.
    _pointOnTitleOf: function(shape, pt) {
      var box = shape && shape.titleGroup && shape._renderedTitleImage;
      if (!box) return false;
      return pt.x >= box.x && pt.x <= box.x + box.w &&
             pt.y >= box.y && pt.y <= box.y + box.h;
    },

    _showTooltipFor: function(shape) {
      var tip = this.tooltipEl;
      if (!tip) return;

      this._cancelHideTooltip();
      this._tooltipShape = shape;

      // Delegate the three content regions to slot functions. Consumer
      // overrides win over defaults; a slot returning null/undefined
      // omits its row entirely.
      var headerHtml = resolveSlot("header", shape);
      var bodyHtml = resolveSlot("body", shape);
      var footerHtml = resolveSlot("footer", shape);

      var html = '<div class="etcher-tooltip-header">';
      html += '<span class="etcher-tooltip-kind">' + (headerHtml || "") + '</span>';
      // Trash button stays Etcher-controlled — delete is a core UX,
      // consumers shouldn't have to reimplement it. Only shown for
      // persisted shapes (temp drafts have no server-side uuid yet).
      if (shape.uuid) {
        html += '<button type="button" class="etcher-tooltip-delete"' +
                ' data-etcher-action="delete" title="Delete annotation"' +
                ' aria-label="Delete annotation">' + ICONS.trash + '</button>';
      }
      html += '</div>';

      if (footerHtml) {
        html += '<div class="etcher-tooltip-meta">' + footerHtml + '</div>';
      }
      // Body slot HTML is injected as-is. Consumers can wrap it in
      // any layout they want; Etcher exposes `.etcher-tooltip-body`,
      // `.etcher-tooltip-thumb`, `.etcher-tooltip-text`, and
      // `.etcher-tooltip-quote` as opt-in styling primitives.
      if (bodyHtml) {
        html += bodyHtml;
      }

      tip.innerHTML = html;

      // If the thumbnail image is broken (variant URL 404'd, blocked by
      // CSP, etc.), swap it for the paperclip placeholder rather than
      // leaving the user-agent's broken-image icon. Wired up after
      // innerHTML so the JS we attach isn't inlined and HTML-escaped.
      var thumbImg = tip.querySelector("img.etcher-tooltip-thumb");
      if (thumbImg) {
        thumbImg.addEventListener("error", function() {
          var span = document.createElement("span");
          span.className = "etcher-tooltip-thumb etcher-tooltip-thumb-icon";
          span.innerHTML = ICONS.paperclip;
          if (thumbImg.parentNode) thumbImg.parentNode.replaceChild(span, thumbImg);
        });
      }

      // Anchor it to the shape. Split out so the render loop can re-run
      // just the positioning math on every pan/zoom frame (the tooltip
      // tracks the shape) without rebuilding content or restarting the
      // dwell timer.
      this._positionTooltip(shape);

      // Grace window after show: the next ~250 ms ignores
      // `_scheduleHideTooltip` calls. Defeats the iOS-synthesized
      // mousemove-on-just-shown-tooltip race that fires
      // `_setHoveredShape(null)` → `_scheduleHideTooltip` before
      // the tooltip's own `mouseenter` (which would cancel the
      // hide) gets a chance to run. Without this, the first
      // hover often shows-then-hides in the same frame.
      this._tooltipShowGraceUntil = Date.now() + 250;

      // Auto-close after the dwell window. Pinning cancels this (see
      // `_pinTooltipFor`); so does hovering the tooltip itself.
      this._startTooltipAutoClose();

      this._dispatch("etcher:tooltip-show", {
        uuid: shape.uuid || null,
        anchor: { x: parseFloat(tip.style.left) || 0, y: parseFloat(tip.style.top) || 0 }
      });
    },

    // Place the (already-populated, already-visible) tooltip element
    // above its anchor shape, flipping below + clamping horizontally to
    // stay inside the container. Pure positioning — no content rebuild,
    // no timer changes — so it's cheap enough to call every animation
    // frame from `_renderAll`, which is what keeps the tooltip glued to
    // the shape during pan/zoom instead of floating in stale space.
    _positionTooltip: function(shape) {
      var tip = this.tooltipEl;
      if (!tip || !shape || !shape.el) return;

      // Anchor the tooltip just above the shape's bounding rect, in
      // container px. `getBoundingClientRect` reflects the current
      // post-animation position so the tooltip sits where the shape is
      // *now*, not where it started.
      //
      // The tooltip is `position: absolute` inside the (relatively-
      // positioned) container, so `style.top` is interpreted in
      // CONTENT space — not viewport space. For strip mode, where
      // the container itself scrolls, we add `scrollTop` /
      // `scrollLeft` so the tooltip lands at the right CONTENT
      // coords. Canvas-mode containers pan via CSS transform and
      // never accumulate scroll, so adding zero is a safe no-op
      // — no per-mode branching needed.
      var shapeRect = shape.el.getBoundingClientRect();
      var containerRect = this.handle.container.getBoundingClientRect();
      var sx = this.handle.container.scrollLeft || 0;
      var sy = this.handle.container.scrollTop  || 0;
      var x = shapeRect.left + shapeRect.width / 2 - containerRect.left + sx;
      var aboveY = shapeRect.top - containerRect.top - 8 + sy;
      tip.style.left = x + "px";
      tip.style.top = aboveY + "px";
      tip.style.transform = "translate(-50%, -100%)";
      tip.style.display = "block";

      // If the tooltip extends past the container's top edge (shape is
      // near the top), flip it to sit below the shape instead. Measure
      // after the display:block above so offsetHeight is accurate; if
      // the flip is needed, swap the y-translate too so `top` lands at
      // the shape's bottom edge rather than at its top minus tip
      // height. 4px breathing room either way.
      var tipRect = tip.getBoundingClientRect();
      if (tipRect.top < containerRect.top + 4) {
        var belowY = shapeRect.bottom - containerRect.top + 8 + sy;
        tip.style.top = belowY + "px";
        tip.style.transform = "translate(-50%, 0)";
        tipRect = tip.getBoundingClientRect();
      }

      // Horizontal clamp — keep the tooltip's visible bbox inside the
      // container. `transform: translate(-50%, …)` centers on `left`,
      // so the safe range for `x` is [halfW+4, containerWidth-halfW-4].
      var halfW = tipRect.width / 2;
      var minX = halfW + 4;
      var maxX = containerRect.width - halfW - 4;
      if (maxX < minX) {
        // Tooltip wider than the container — pin to the left edge with
        // a buffer; the right side will overflow gracefully.
        x = minX;
      } else {
        if (x < minX) x = minX;
        else if (x > maxX) x = maxX;
      }
      tip.style.left = x + "px";
    },

    _scheduleHideTooltip: function() {
      // Pinned tooltips never auto-close — only an explicit click action
      // (same shape again, another shape, or outside) closes them.
      if (this.tooltipPinned) return;
      // Grace window from the most recent `_showTooltipFor` — no-op
      // for hides scheduled within ~250 ms of show (see comment in
      // `_showTooltipFor` for the iOS race this prevents).
      if (this._tooltipShowGraceUntil && Date.now() < this._tooltipShowGraceUntil) return;
      var self = this;
      self._cancelHideTooltip();
      // 180ms is long enough for a Fitts'-friendly diagonal move from
      // a small shape edge up to the tooltip without feeling laggy when
      // intentionally moving away.
      self._tooltipTimer = setTimeout(function() {
        self._tooltipTimer = null;
        self._hideTooltip();
      }, 180);
    },

    _cancelHideTooltip: function() {
      if (this._tooltipTimer) {
        clearTimeout(this._tooltipTimer);
        this._tooltipTimer = null;
      }
    },

    // Fixed-dwell auto-close for hover-shown tooltips. Starts on show
    // and fires `TOOLTIP_DWELL_MS` later regardless of cursor position
    // — this is what makes a tooltip "stay for 5 seconds, then close"
    // rather than vanishing the moment the cursor leaves the shape.
    // Restarting (each new show, or leaving the tooltip) resets the
    // window from scratch.
    _startTooltipAutoClose: function() {
      this._cancelTooltipAutoClose();
      var self = this;
      this._tooltipAutoCloseTimer = setTimeout(function() {
        self._tooltipAutoCloseTimer = null;
        self._hideTooltip();
      }, TOOLTIP_DWELL_MS);
    },

    _cancelTooltipAutoClose: function() {
      if (this._tooltipAutoCloseTimer) {
        clearTimeout(this._tooltipAutoCloseTimer);
        this._tooltipAutoCloseTimer = null;
      }
    },

    _hideTooltip: function() {
      var wasVisible = this.tooltipEl && this.tooltipEl.style.display !== "none";
      var hidShape = this._tooltipShape;
      this._cancelHideTooltip();
      this._cancelTooltipAutoClose();
      // _hideTooltip is the universal teardown; make sure pin state is
      // also reset so the next click-to-pin starts clean.
      this.tooltipPinned = false;
      this._removeTooltipOutsideClickHandler();
      this._tooltipShape = null;
      if (this.tooltipEl) this.tooltipEl.style.display = "none";

      if (wasVisible) {
        this._dispatch("etcher:tooltip-hide", {
          uuid: (hidShape && hidShape.uuid) || null
        });
      }
    },

    // Pin / unpin — click-to-stick UX. Pinned tooltips ignore hover
    // events and only close on (a) clicking the same shape again,
    // (b) clicking another shape (which switches the pin), or
    // (c) clicking anywhere else on the page.
    _pinTooltipFor: function(shape) {
      // Switching the pin from one shape to another — drop the
      // previous shape's selected styling so only one shape ever
      // reads as "currently pinned".
      var prev = this._tooltipShape;
      if (prev && prev !== shape && prev.el) {
        prev.el.classList.remove("is-selected");
      }
      this._showTooltipFor(shape);
      this.tooltipPinned = true;
      // `_showTooltipFor` armed the dwell auto-close; a pinned tooltip
      // must dwell until an explicit click, so disarm it.
      this._cancelTooltipAutoClose();
      // Mark the pinned shape visually so its dashed outline persists
      // when the cursor leaves it — without this the shape would
      // appear deselected even though its tooltip is dwelling.
      if (shape && shape.el) shape.el.classList.add("is-selected");
      this._installTooltipOutsideClickHandler();
      this._highlightCommentsFor(shape.uuid);
      this._dispatch("etcher:tooltip-pin", { uuid: shape.uuid || null });
    },

    // Multi-image canvas: hit-test a shape's centroid against every
    // image rect on the canvas and return the matching image id, or
    // `null` when the shape sits in empty canvas space (e.g., a
    // freeform note between two pages). Used at draw time to tag
    // each new shape so the `image-visibility-change` listener can
    // hide its DOM when the host toggles that image off.
    //
    // No-op for single-image canvases — the `length > 1` gate keeps
    // every existing one-image consumer free of `image_id` tagging.
    _resolveCanvasImageId: function(kind, geometry) {
      if (this.handleKind !== "canvas") return null;
      if (!this.handle || typeof this.handle.getImages !== "function") return null;
      var images = this.handle.getImages();
      if (!images || images.length < 2) return null;
      var bbox = this._shapeBBoxImagePx({ kind: kind, geometry: geometry });
      if (!bbox) return null;
      var cx = bbox.x + bbox.w / 2;
      var cy = bbox.y + bbox.h / 2;
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        if (!img || !img.id) continue;
        if (cx >= img.x && cx <= img.x + img.width &&
            cy >= img.y && cy <= img.y + img.height) {
          return img.id;
        }
      }
      return null;
    },

    // Apply `_hiddenImageIds` across every shape: any shape whose
    // `image_id` is in the hidden set gets `display: none` on its
    // SVG element + title group (the satellite that hosts the
    // movable label). Currently-edited shapes drop out of edit
    // mode and any pinned tooltip on a hidden shape unpins — those
    // states would orphan with no visible anchor otherwise.
    //
    // Fast path: when nothing is hidden, just unset display on every
    // shape (covers the case where the host re-shows everything).
    _applyImageVisibility: function() {
      if (this.handleKind !== "canvas") return;
      var hidden = this._hiddenImageIds || null;
      var shapes = this.shapes || [];
      if (!hidden || hidden.size === 0) {
        shapes.forEach(function(s) {
          if (s.el) s.el.style.display = "";
          if (s.titleGroup) s.titleGroup.style.display = "";
        });
        return;
      }
      var self = this;
      shapes.forEach(function(s) {
        var shouldHide = !!(s.image_id && hidden.has(s.image_id));
        if (s.el) s.el.style.display = shouldHide ? "none" : "";
        if (s.titleGroup) s.titleGroup.style.display = shouldHide ? "none" : "";
        if (shouldHide && self.editingShape === s) self._exitEditMode();
        if (shouldHide && self._tooltipShape === s) self._hideTooltip();
      });
    },

    // Compute a shape's bounding box in image-natural pixels. Returns
    // `null` if geometry is malformed (e.g., an empty polygon). Used
    // by `_revealShape`; not called per-frame so it's fine to recompute
    // here rather than caching.
    // Public-facing snapshot of a shape returned by `getShape` /
    // `getShapes`. Includes the host-image identifier that matches
    // the active handle mode: `image_idx` for strip-mode shapes,
    // `image_id` for canvas-mode shapes on multi-image hosts.
    // Either field is present iff that mode is in use; both omitted
    // for single-image canvas. Consumer code routing UI to a shape
    // (deep-links, comment threads, mini-maps) reads these instead
    // of scraping `data-image-idx` / `data-image-id` off the DOM.
    _shapeDescriptor: function(s) {
      var d = {
        uuid: s.uuid,
        kind: s.kind,
        geometry: s.geometry,
        style: s.style || null,
        metadata: s.metadata || null
      };
      if (typeof s.image_idx === "number") d.image_idx = s.image_idx;
      if (typeof s.image_id === "string") d.image_id = s.image_id;
      return d;
    },

    _shapeBBoxImagePx: function(shape) {
      var g = shape && shape.geometry;
      if (!g) return null;
      function fromPoints(pts) {
        if (!pts || pts.length === 0) return null;
        var minX = pts[0].x, minY = pts[0].y, maxX = minX, maxY = minY;
        for (var i = 1; i < pts.length; i++) {
          var p = pts[i];
          if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
      switch (shape.kind) {
        case "rectangle":
        case "text":
          return { x: g.x, y: g.y, w: g.w, h: g.h };
        case "circle":
          return { x: g.cx - g.r, y: g.cy - g.r, w: 2 * g.r, h: 2 * g.r };
        case "polygon":
          return fromPoints(g.points);
        case "freehand": {
          if (g.nodes) {
            var flat = this._freehandFlatten(g);
            if (!flat.length) return null;
            var aMinX = flat[0][0], aMinY = flat[0][1], aMaxX = aMinX, aMaxY = aMinY;
            for (var fi = 1; fi < flat.length; fi++) {
              var fp = flat[fi];
              if (fp[0] < aMinX) aMinX = fp[0]; else if (fp[0] > aMaxX) aMaxX = fp[0];
              if (fp[1] < aMinY) aMinY = fp[1]; else if (fp[1] > aMaxY) aMaxY = fp[1];
            }
            return { x: aMinX, y: aMinY, w: aMaxX - aMinX, h: aMaxY - aMinY };
          }
          return fromPoints(g.points);
        }
        case "line":
        case "dimension": {
          var ax = g.a[0], ay = g.a[1], bx = g.b[0], by = g.b[1];
          return {
            x: Math.min(ax, bx),
            y: Math.min(ay, by),
            w: Math.abs(bx - ax),
            h: Math.abs(by - ay)
          };
        }
        case "callout": {
          var box = g.text_box;
          var anchorX = g.anchor ? g.anchor[0] : 0;
          var anchorY = g.anchor ? g.anchor[1] : 0;
          if (!box) return { x: anchorX - 1, y: anchorY - 1, w: 2, h: 2 };
          var x1 = Math.min(box.x, anchorX);
          var y1 = Math.min(box.y, anchorY);
          var x2 = Math.max(box.x + box.w, anchorX);
          var y2 = Math.max(box.y + box.h, anchorY);
          return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
      }
      return null;
    },

    // Bring a shape into the viewport. Strip mode scrolls the strip
    // so the shape's bbox sits at the chosen alignment (default
    // center, clamped at the top edge); canvas mode delegates to
    // `handle.fitBounds`. Polls for late-mounted shapes for up to
    // `opts.timeout` ms (default 10s) — chapters that hydrate on
    // scroll, async backfill of an annotation set.
    //
    // Returns a Promise resolving with
    //   { uuid, image_idx?, image_id?, scrollTop?, cameraBounds? }
    // once the reveal call has been issued. Rejects with a
    // `{ reason }` object on timeout / missing geometry / handle
    // failure. Also dispatches an `etcher:shape-revealed` bubbling
    // CustomEvent on the layer host carrying the same payload.
    _revealShape: function(uuid, opts) {
      var self = this;
      opts = opts || {};
      var behavior = opts.behavior === "instant" ? "instant" : "smooth";
      var align = (opts.align === "top" || opts.align === "bottom") ?
        opts.align : "center";
      var pulse = !!opts.pulse;
      var pulseDuration = typeof opts.pulseDuration === "number" ?
        opts.pulseDuration : 1500;
      var timeout = typeof opts.timeout === "number" ? opts.timeout : 10000;
      var pad = typeof opts.padding === "number" ? opts.padding : 0;

      return new Promise(function(resolve, reject) {
        var startedAt = Date.now();

        function attempt() {
          var shape = (self.shapes || [])
            .find(function(s) { return s.uuid === uuid; });
          if (!shape) {
            if (Date.now() - startedAt >= timeout) {
              return reject({ reason: "timeout" });
            }
            return setTimeout(attempt, 120);
          }

          var bbox = self._shapeBBoxImagePx(shape);
          if (!bbox) return reject({ reason: "no_geometry" });

          var payload = { uuid: shape.uuid };
          if (typeof shape.image_idx === "number") {
            payload.image_idx = shape.image_idx;
          }
          if (typeof shape.image_id === "string") {
            payload.image_id = shape.image_id;
          }

          if (self.handleKind === "strip") {
            if (typeof shape.image_idx !== "number") {
              return reject({ reason: "no_image_idx" });
            }
            var page = (self.pages || [])[shape.image_idx];
            if (!page) {
              if (Date.now() - startedAt >= timeout) {
                return reject({ reason: "timeout" });
              }
              return setTimeout(attempt, 120);
            }
            // page.height is rendered px, page.naturalHeight is image px.
            var scale = page.naturalHeight > 0 ?
              page.height / page.naturalHeight : 1;
            var renderedTop = bbox.y * scale;
            var renderedH = bbox.h * scale;
            var viewportH = (self.handle.container &&
              self.handle.container.clientHeight) || 0;
            var yOffset;
            if (align === "top") {
              yOffset = renderedTop;
            } else if (align === "bottom") {
              yOffset = renderedTop + renderedH - viewportH;
            } else {
              yOffset = renderedTop + renderedH / 2 - viewportH / 2;
            }
            yOffset = Math.max(0, yOffset);
            payload.scrollTop = yOffset;
            try {
              self.handle.scrollTo({
                imageIdx: shape.image_idx,
                y: yOffset,
                behavior: behavior
              });
            } catch (e) {
              return reject({ reason: "scroll_failed", error: e });
            }
          } else if (self.handleKind === "canvas") {
            if (typeof self.handle.fitBounds !== "function") {
              return reject({ reason: "fitBounds_failed" });
            }
            var bounds = {
              x: bbox.x - pad,
              y: bbox.y - pad,
              w: bbox.w + pad * 2,
              h: bbox.h + pad * 2
            };
            payload.cameraBounds = bounds;
            try {
              self.handle.fitBounds(
                bounds,
                { animate: behavior !== "instant" }
              );
            } catch (e) {
              return reject({ reason: "fitBounds_failed", error: e });
            }
          } else {
            return reject({ reason: "unsupported_handleKind" });
          }

          if (pulse && shape.el) {
            // Smooth scroll needs a beat to settle before the flash
            // is visible. Instant scroll starts on the next frame.
            var delay = behavior === "instant" ? 16 : 350;
            setTimeout(function() {
              var el = shape.el;
              if (!el) return;
              el.classList.add("etcher-shape--pulse");
              setTimeout(function() {
                if (el && el.classList) {
                  el.classList.remove("etcher-shape--pulse");
                }
              }, pulseDuration);
            }, delay);
          }

          self._dispatch("etcher:shape-revealed", payload);
          resolve(payload);
        }

        attempt();
      });
    },

    _unpinTooltip: function() {
      var pinned = this._tooltipShape;
      this.tooltipPinned = false;
      this._removeTooltipOutsideClickHandler();
      this._clearCommentHighlights();
      // Clear hover + selected styling — the pinned-state mouseenter
      // guard skipped re-adding `is-hovered`, but the click that
      // originally pinned added it before the pin was set; and
      // `is-selected` is our pin-visual marker that should drop now.
      if (pinned && pinned.el) {
        pinned.el.classList.remove("is-hovered");
        pinned.el.classList.remove("is-selected");
      }
      this._hideTooltip();
      this._dispatch("etcher:tooltip-unpin", {
        uuid: (pinned && pinned.uuid) || null
      });
    },

    // Look up every element in the document that carries
    // `data-annotation-uuid="<uuid>"` (typically a comment row stamped
    // by the consumer's discussion thread, but the contract is purely
    // the data attribute) and highlight them. Scroll the first match
    // into view so the user doesn't have to hunt for the thread.
    _highlightCommentsFor: function(annotationUuid) {
      this._clearCommentHighlights();
      if (!annotationUuid) return;
      var matches = document.querySelectorAll(
        '[data-annotation-uuid="' + annotationUuid + '"]'
      );
      if (matches.length === 0) return;
      matches.forEach(function(el) { el.classList.add("etcher-comment-highlight"); });
      try {
        matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {}
    },

    _clearCommentHighlights: function() {
      document.querySelectorAll(".etcher-comment-highlight").forEach(function(el) {
        el.classList.remove("etcher-comment-highlight");
      });
    },

    _installTooltipOutsideClickHandler: function() {
      if (this._tooltipOutsideClick) return;
      var self = this;
      this._tooltipOutsideClick = function(e) {
        // Clicks on a shape, on the tooltip itself, on an edit-mode
        // handle, or inside any registered input-owner (modals, etc.)
        // keep the pin alive. Anything else unpins. Shapes are
        // `pointer-events: none`, so a click on a shape lands on the
        // canvas/container at the DOM level — fall back to image-px
        // hit-test.
        if (e.target.closest(".etcher-shape")) return;
        if (isInputOwner(e.target, self.overlayWrapper)) return;
        try {
          var pt = self._toImage(e);
          if (self._shapeAt(pt)) return;
        } catch (_) {}
        self._unpinTooltip();
      };
      // Capture phase so we run before any inner stopPropagation can
      // swallow the click.
      document.addEventListener("click", this._tooltipOutsideClick, true);
    },

    _removeTooltipOutsideClickHandler: function() {
      if (this._tooltipOutsideClick) {
        document.removeEventListener("click", this._tooltipOutsideClick, true);
        this._tooltipOutsideClick = null;
      }
    },

    // ---- Multi-selection (shift-click) -----------------------------------
    //
    // A second selection mode independent of `editingShape`. Shift-
    // clicking a shape toggles it in/out of `selectedShapes`; the
    // group can then be dragged together or deleted with a single
    // Backspace / Delete keystroke. Clearing happens on:
    //   - clicking empty canvas (no modifier)
    //   - selecting any drawing tool (entering draw mode)
    //   - exiting annotation mode
    //   - completing a delete on the group

    _addToSelection: function(shape) {
      if (!shape || !shape.el) return;
      this.selectedShapes = this.selectedShapes || [];
      if (this.selectedShapes.indexOf(shape) !== -1) return;
      this.selectedShapes.push(shape);
      shape.el.classList.add("is-multi-selected");
    },

    _removeFromSelection: function(shape) {
      var list = this.selectedShapes || [];
      var idx = list.indexOf(shape);
      if (idx === -1) return;
      list.splice(idx, 1);
      if (shape.el) shape.el.classList.remove("is-multi-selected");
    },

    _toggleInSelection: function(shape) {
      var list = this.selectedShapes || [];
      if (list.indexOf(shape) === -1) this._addToSelection(shape);
      else this._removeFromSelection(shape);
    },

    _clearSelection: function() {
      var list = this.selectedShapes || [];
      list.forEach(function(s) {
        if (s && s.el) s.el.classList.remove("is-multi-selected");
      });
      this.selectedShapes = [];
    },

    _isInSelection: function(shape) {
      return !!(this.selectedShapes &&
                this.selectedShapes.indexOf(shape) !== -1);
    },

    // Drag every multi-selected shape together. `anchorShape` is the
    // one the user grabbed; the gesture's image-space delta is applied
    // uniformly to every shape's geometry, so relative positions are
    // preserved. Title boxes (when present) translate alongside.
    _startMultiShapeMove: function(anchorShape, e) {
      var self = this;
      var startPt = self._toImage(e);
      // Snapshot geometry + title box for every selected shape.
      var snapshots = self.selectedShapes.map(function(s) {
        return {
          shape: s,
          geometry: JSON.parse(JSON.stringify(s.geometry)),
          titleBox: (s.metadata && s.metadata.title_box)
            ? Object.assign({}, s.metadata.title_box)
            : null,
          history: self._snapshotShape(s)
        };
      });

      var dragged = false;
      try { anchorShape.el.setPointerCapture(e.pointerId); } catch (_) {}
      self._hideTooltip();

      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          var a = self._imageToContainer(startPt);
          var b = self._imageToContainer(pt);
          var sdx = b.x - a.x, sdy = b.y - a.y;
          // Same 3-px dead zone as `_startShapeMove` — a stationary
          // click on a multi-selected shape shouldn't fire a network
          // round-trip.
          if (sdx * sdx + sdy * sdy < 9) return;
          dragged = true;
          snapshots.forEach(function(snap) {
            if (snap.shape.el) snap.shape.el.classList.add("is-moving");
          });
        }
        var dxI = pt.x - startPt.x;
        var dyI = pt.y - startPt.y;
        snapshots.forEach(function(snap) {
          snap.shape.geometry = self._translateGeometry(
            snap.shape.kind, snap.geometry, dxI, dyI
          );
          if (snap.titleBox) {
            snap.shape.metadata = Object.assign({}, snap.shape.metadata || {}, {
              title_box: {
                x: snap.titleBox.x + dxI,
                y: snap.titleBox.y + dyI,
                w: snap.titleBox.w,
                h: snap.titleBox.h
              }
            });
          }
          self._renderShape(snap.shape);
        });
      }

      function onUp(ev) {
        anchorShape.el.removeEventListener("pointermove", onMove);
        anchorShape.el.removeEventListener("pointerup", onUp);
        anchorShape.el.removeEventListener("pointercancel", onUp);
        try { anchorShape.el.releasePointerCapture(ev.pointerId); } catch (_) {}
        snapshots.forEach(function(snap) {
          if (snap.shape.el) snap.shape.el.classList.remove("is-moving");
        });
        if (!dragged) return;
        // One undo entry per shape — keeps the existing per-shape
        // restore logic; the user will need to ⌘Z N times to walk
        // the entire group back. (Undoing the whole-group move with
        // one keystroke would require a new bulk_move undo entry
        // type; out of scope here.)
        snapshots.forEach(function(snap) {
          if (snap.shape.uuid) {
            self._pushUndo(snap.shape.uuid, snap.history, self._snapshotShape(snap.shape));
          }
        });
        self._emitChanged();
      }

      anchorShape.el.addEventListener("pointermove", onMove);
      anchorShape.el.addEventListener("pointerup", onUp);
      anchorShape.el.addEventListener("pointercancel", onUp);
    },

    // Batch-delete every multi-selected shape under a single
    // `bulk_delete` undo entry. One `etcher:annotations-changed` emit
    // covers the whole group so the consumer LV doesn't see a flurry
    // of full-array replays.
    _deleteSelectedShapes: function() {
      var self = this;
      var list = (self.selectedShapes || []).slice();
      if (list.length === 0) return;
      var withUuids = list.filter(function(s) { return s && s.uuid; });
      if (withUuids.length) self._pushUndoBulkDelete(withUuids);
      list.forEach(function(shape) {
        if (self.editingShape === shape) self._exitEditMode();
        var idx = self.shapes.indexOf(shape);
        if (idx === -1) return;
        if (shape.el && shape.el.parentNode) {
          shape.el.parentNode.removeChild(shape.el);
        }
        if (shape.titleGroup && shape.titleGroup.parentNode) {
          shape.titleGroup.parentNode.removeChild(shape.titleGroup);
        }
        self.shapes.splice(idx, 1);
      });
      self.selectedShapes = [];
      self._hideTooltip();
      self._emitChanged();
    },

    _deleteShape: function(shape) {
      if (!shape) return;
      // Capture for undo BEFORE we tear the shape down — the snapshot
      // is what `_recreateFromSnapshot` will use to rebuild the row.
      // Single deletes ride the same bulk path as the eraser so they
      // get matching undo + redo support out of the box.
      if (shape.uuid) this._pushUndoBulkDelete([shape]);
      var uuid = shape.uuid;
      if (this.editingShape === shape) this._exitEditMode();
      // Optimistic local removal so the UI feels instant. Server still
      // gets the etcher:deleted event below to persist the change.
      var idx = this.shapes.indexOf(shape);
      if (idx !== -1) {
        if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
        if (shape.titleGroup && shape.titleGroup.parentNode) {
          shape.titleGroup.parentNode.removeChild(shape.titleGroup);
        }
        this.shapes.splice(idx, 1);
      }
      this._hideTooltip();
      this._emitChanged();
    },

    // -------------------------------------------------------------------------
    // Rectangle
    // -------------------------------------------------------------------------

    _startRectangle: function(pt, e) {
      var rect = svgEl("rect", { "stroke-width": "2" });
      rect.classList.add("etcher-shape", "is-draft");
      this._applyShapeColor(rect, this.activeColor);
      this.svg.appendChild(rect);
      var geom = { x: pt.x, y: pt.y, w: 0, h: 0 };
      this.draftState = { kind: "rectangle", anchor: pt, geometry: geom, el: rect };
      this._renderShape(this.draftState);
      this._syncDraftHandles();
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateRectangle: function(pt) {
      var a = this.draftState.anchor;
      this.draftState.geometry = {
        x: Math.min(a.x, pt.x), y: Math.min(a.y, pt.y),
        w: Math.abs(pt.x - a.x), h: Math.abs(pt.y - a.y)
      };
      this._renderShape(this.draftState);
      this._positionAllHandles(this.draftState);
    },

    _commitRectangle: function(pt) {
      var a = this.draftState.anchor;
      var geom = {
        x: Math.min(a.x, pt.x),
        y: Math.min(a.y, pt.y),
        w: Math.abs(pt.x - a.x),
        h: Math.abs(pt.y - a.y)
      };
      if (geom.w < 2 || geom.h < 2) {
        this._cancelDraft();
        return;
      }
      var el = this.draftState.el;
      el.classList.remove("is-draft");
      this._finalizeShape("rectangle", geom, el);
    },

    // -------------------------------------------------------------------------
    // Circle
    // -------------------------------------------------------------------------

    _startCircle: function(pt, e) {
      var circle = svgEl("circle", { "stroke-width": "2" });
      circle.classList.add("etcher-shape", "is-draft");
      this._applyShapeColor(circle, this.activeColor);
      this.svg.appendChild(circle);
      var geom = { cx: pt.x, cy: pt.y, r: 0 };
      this.draftState = { kind: "circle", center: pt, geometry: geom, el: circle };
      this._renderShape(this.draftState);
      this._syncDraftHandles();
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateCircle: function(pt) {
      var c = this.draftState.center;
      var dx = pt.x - c.x, dy = pt.y - c.y;
      this.draftState.geometry = { cx: c.x, cy: c.y, r: Math.sqrt(dx * dx + dy * dy) };
      this._renderShape(this.draftState);
      this._positionAllHandles(this.draftState);
    },

    _commitCircle: function(pt) {
      var c = this.draftState.center;
      var dx = pt.x - c.x, dy = pt.y - c.y;
      var r = Math.sqrt(dx * dx + dy * dy);
      if (r < 2) {
        this._cancelDraft();
        return;
      }
      var geom = { cx: c.x, cy: c.y, r: r };
      var el = this.draftState.el;
      el.classList.remove("is-draft");
      this._finalizeShape("circle", geom, el);
    },

    // -------------------------------------------------------------------------
    // Polygon — multi-click; double-click closes; escape cancels.
    // -------------------------------------------------------------------------

    _polygonClick: function(pt) {
      if (!this.draftPolygon) {
        var poly = svgEl("polyline", { "stroke-width": "2", fill: "none" });
        poly.classList.add("etcher-shape", "is-draft");
        // Polyline preview has fill: none; color only affects stroke,
        // but use the same helper for consistency.
        this._applyShapeColor(poly, this.activeColor);
        this.svg.appendChild(poly);
        this.draftPolygon = { points: [[pt.x, pt.y]], el: poly };
        this._lastHover = null;
        this._renderPolygonPreview(null);
        this._syncDraftHandles();
        return;
      }

      var pts = this.draftPolygon.points;
      var here = this._imageToContainer(pt);

      // Click on (or very near) the first vertex closes the polygon —
      // standard vector-tool UX. Requires at least 3 vertices already so
      // we close into a real triangle, not a degenerate line.
      if (pts.length >= 3) {
        var first = this._imageToContainer({ x: pts[0][0], y: pts[0][1] });
        var fdx = here.x - first.x, fdy = here.y - first.y;
        if (fdx * fdx + fdy * fdy < 144) { // 12px radius around the start dot
          this._commitPolygon();
          return;
        }
      }

      // Ignore a click that lands on top of the last vertex — covers both
      // the second click of a double-click and a jittery hand. Otherwise
      // we'd stack two dots at the same point and the user would have to
      // notice and back out.
      var last = pts[pts.length - 1];
      var lastScreen = this._imageToContainer({ x: last[0], y: last[1] });
      var ldx = here.x - lastScreen.x, ldy = here.y - lastScreen.y;
      if (ldx * ldx + ldy * ldy < 9) return; // 3px duplicate threshold

      pts.push([pt.x, pt.y]);
      this._renderPolygonPreview(null);
      // Vertex count grew — recreate handles so the new one shows up.
      this._syncDraftHandles();
    },

    _polygonHover: function(pt) {
      this._lastHover = pt;
      this._renderPolygonPreview(pt);
      this._updatePolygonCloseHint(pt);
    },

    // Toggle the close-target class on the first vertex's handle when
    // the cursor is within the same 12px radius the click handler uses
    // for the close action. Matches the threshold so the visual hint
    // and the actual click target line up exactly.
    _updatePolygonCloseHint: function(pt) {
      if (!this.handles || this.handles.length === 0) return;
      var firstHandle = this.handles[0];
      if (!this.draftPolygon || this.draftPolygon.points.length < 3) {
        firstHandle.classList.remove("is-close-target");
        return;
      }
      var pts = this.draftPolygon.points;
      var first = this._imageToContainer({ x: pts[0][0], y: pts[0][1] });
      var here = this._imageToContainer(pt);
      var dx = here.x - first.x, dy = here.y - first.y;
      firstHandle.classList.toggle("is-close-target", dx * dx + dy * dy < 144);
    },

    _renderPolygonPreview: function(hover) {
      if (!this.draftPolygon) return;
      var self = this;
      var pts = this.draftPolygon.points.slice();
      if (hover) pts.push([hover.x, hover.y]);
      var screen = pts.map(function(p) {
        var s = self._imageToContainer({ x: p[0], y: p[1] });
        return s.x + "," + s.y;
      }).join(" ");
      this.draftPolygon.el.setAttribute("points", screen);
    },

    _commitPolygon: function() {
      var pts = this.draftPolygon.points;
      if (pts.length < 3) {
        this._cancelDraft();
        return;
      }
      var el = this.draftPolygon.el;
      // Convert polyline preview into a closed polygon element so it
      // fills properly. Carry the active color over (the polyline only
      // showed stroke; the polygon now also fills).
      var polygon = svgEl("polygon", { "stroke-width": "2" });
      polygon.classList.add("etcher-shape");
      this._applyShapeColor(polygon, this.activeColor);
      this.svg.replaceChild(polygon, el);
      this.draftPolygon = null;
      this._lastHover = null;
      this._finalizeShape("polygon", { points: pts }, polygon);
      this._renderShape({ kind: "polygon", geometry: { points: pts }, el: polygon });
    },

    // -------------------------------------------------------------------------
    // Callout — leader line + resizable text bbox. Two-click input:
    // anchor first (what's being pointed at), text-bbox top-left second
    // (where the label sits). Between clicks, the line rubber-bands to
    // the cursor with a default-sized bbox preview. Once committed, the
    // text bbox behaves like a text shape: scale via 4 corner handles,
    // inline-edit on double-click. `metadata.title` holds the content.
    // -------------------------------------------------------------------------

    _calloutClick: function(pt) {
      if (!this.draftCallout) {
        var g = svgEl("g");
        g.classList.add("etcher-shape", "etcher-callout", "etcher-text", "is-draft");

        var line = svgEl("line", {
          "stroke-width": "2",
          stroke: "currentColor",
          fill: "none"
        });
        var underline = svgEl("line", {
          "stroke-width": "2",
          stroke: "currentColor",
          fill: "none"
        });
        underline.classList.add("etcher-callout-underline");
        var rect = svgEl("rect", {
          fill: "transparent",
          stroke: "currentColor",
          "stroke-width": "2"
        });
        rect.classList.add("etcher-text-rect");
        var text = svgEl("text", {
          "text-anchor": "start",
          "dominant-baseline": "hanging",
          fill: "currentColor",
          stroke: "none"
        });
        text.classList.add("etcher-text-content");
        var dot = svgEl("circle", {
          r: "3",
          fill: "currentColor",
          stroke: "none"
        });

        g.appendChild(line);
        g.appendChild(underline);
        g.appendChild(rect);
        g.appendChild(text);
        g.appendChild(dot);

        this._applyShapeColor(g, this.activeColor);
        this.svg.appendChild(g);

        // Default-sized text bbox a short hop from the anchor — the
        // user will refine size + position via the second click and
        // post-commit handle drags.
        var basePx = this._textDefaultBoxImagePx();
        var defaultBox = {
          x: pt.x + basePx * 2,
          y: pt.y - basePx * 1.5,
          w: basePx * 6,
          h: basePx * 1.4
        };

        this.draftCallout = {
          kind: "callout",
          geometry: { anchor: [pt.x, pt.y], text_box: defaultBox },
          metadata: {},
          el: g
        };
        this._renderShape(this.draftCallout);
        this._syncDraftHandles();
        return;
      }

      // Second click — commit at the new text-bbox top-left. The title
      // is collected by the host's annotation composer (opened in
      // response to the `annotations-changed` event) and arrives back
      // here via `patchShape` once posted. No inline-edit auto-open —
      // the composer is the single edit surface for callouts; opening
      // both stacks UI on top of each other and confuses the user
      // about where to type.
      var anchor = this.draftCallout.geometry.anchor;
      var box = this.draftCallout.geometry.text_box;
      var geom = {
        anchor: anchor,
        text_box: { x: pt.x, y: pt.y - box.h / 2, w: box.w, h: box.h }
      };
      var el = this.draftCallout.el;
      el.classList.remove("is-draft");
      this.draftCallout = null;
      this._finalizeShape("callout", geom, el);
    },

    _calloutHover: function(pt) {
      if (!this.draftCallout) return;
      var box = this.draftCallout.geometry.text_box;
      // Rubber-band the text bbox so its center tracks the cursor —
      // gives the user a live preview of where the label will land.
      this.draftCallout.geometry = {
        anchor: this.draftCallout.geometry.anchor,
        text_box: { x: pt.x, y: pt.y - box.h / 2, w: box.w, h: box.h }
      };
      this._renderShape(this.draftCallout);
      this._positionAllHandles(this.draftCallout);
    },

    // -------------------------------------------------------------------------
    // Dimension — line with arrows at both ends + a slidable black label.
    // Drawn click-drag (rectangle pattern). `geometry = { a: [x,y], b: [x,y] }`
    // for the two endpoints; `metadata.title` carries the label text and
    // `metadata.title_offset` (0–1) is the label's position along the line
    // (default 0.5 = midpoint). The label fill is always black with a
    // white halo regardless of the shape's stroke color, so the user can
    // pick any arrow color and the label stays readable.
    // -------------------------------------------------------------------------

    _startDimension: function(pt, e) {
      // Click-rubberband mode: a previous pointerdown released without
      // a drag, so the draft is sitting in two-click mode waiting for
      // the second click. This pointerdown IS that second click —
      // commit with the current point and clear the draft.
      if (this.draftState && this.draftState.kind === "dimension" &&
          this.draftState.pendingClickEnd) {
        this._commitDimensionAt(pt);
        return;
      }

      var g = svgEl("g");
      g.classList.add("etcher-shape", "etcher-dimension", "is-draft");

      var shaft = svgEl("line", {
        "stroke-width": "2",
        stroke: "currentColor",
        fill: "none"
      });
      shaft.classList.add("etcher-dim-shaft");

      var arrowA = svgEl("polyline", {
        "stroke-width": "2",
        stroke: "currentColor",
        fill: "none",
        "stroke-linejoin": "round",
        "stroke-linecap": "round"
      });
      arrowA.classList.add("etcher-dim-arrow");

      var arrowB = svgEl("polyline", {
        "stroke-width": "2",
        stroke: "currentColor",
        fill: "none",
        "stroke-linejoin": "round",
        "stroke-linecap": "round"
      });
      arrowB.classList.add("etcher-dim-arrow");

      // Black label with white halo — independent of the dimension's
      // stroke color so it stays readable on any arrow color.
      // `pointer-events: all` makes the label's bounding box hittable
      // (instead of just the painted glyphs) so the slide-along-line
      // gesture is forgiving even on short labels like "548".
      var label = svgEl("text", {
        "text-anchor": "middle",
        "dominant-baseline": "alphabetic",
        fill: "#000",
        stroke: "rgba(255, 255, 255, 0.95)",
        "stroke-width": "3",
        "stroke-linejoin": "round",
        "paint-order": "stroke fill",
        "pointer-events": "all"
      });
      // `etcher-text-content` lets _endTextEdit's lookup hide the
      // label while the inline editor is open, same as text + callout.
      label.classList.add("etcher-dim-label", "etcher-text-content");

      g.appendChild(shaft);
      g.appendChild(arrowA);
      g.appendChild(arrowB);
      g.appendChild(label);

      this._applyShapeColor(g, this.activeColor);
      this.svg.appendChild(g);

      this.draftState = {
        kind: "dimension",
        anchor: pt,
        geometry: { a: [pt.x, pt.y], b: [pt.x, pt.y] },
        el: g,
        dragged: false,
        pendingClickEnd: false
      };
      this._renderShape(this.draftState);
      this._syncDraftHandles();
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateDimension: function(pt) {
      var a = this.draftState.anchor;
      this.draftState.geometry = {
        a: [a.x, a.y],
        b: [pt.x, pt.y]
      };
      // Track drag for the click-vs-drag mode-switch on pointerup.
      // Once dragged is set, the next pointerup commits; otherwise
      // pointerup transitions to two-click rubberband mode and waits
      // for the next pointerdown to commit. 3-px screen-space dead
      // zone matches the body-drag and title-drag detectors.
      if (!this.draftState.dragged && !this.draftState.pendingClickEnd) {
        var aC = this._imageToContainer({ x: a.x, y: a.y });
        var bC = this._imageToContainer({ x: pt.x, y: pt.y });
        var sdx = bC.x - aC.x, sdy = bC.y - aC.y;
        if (sdx * sdx + sdy * sdy >= 9) {
          this.draftState.dragged = true;
        }
      }
      this._renderShape(this.draftState);
      this._positionAllHandles(this.draftState);
    },

    _commitDimension: function(pt) {
      if (this.draftState.dragged) {
        // Drag mode — pointerup commits at the release point.
        this._commitDimensionAt(pt);
      } else {
        // Click mode — first pointerup with no drag arms two-click
        // rubberband. The next pointermove keeps updating endpoint B
        // (preview), and the next pointerdown commits via the gate
        // at the top of _startDimension.
        this.draftState.pendingClickEnd = true;
      }
    },

    _commitDimensionAt: function(pt) {
      var a = this.draftState.anchor;
      var dx = pt.x - a.x;
      var dy = pt.y - a.y;
      // Minimum 4-image-px length so a stationary click doesn't commit
      // a degenerate zero-length shape.
      if (dx * dx + dy * dy < 16) {
        this._cancelDraft();
        return;
      }
      var geom = { a: [a.x, a.y], b: [pt.x, pt.y] };
      var el = this.draftState.el;
      var kind = this.draftState.kind;
      el.classList.remove("is-draft");
      // No afterCreate — consumers that open their own composer popup
      // on `etcher:shape-drawn` (taking the title via a composer field
      // and creating a linked comment in one flow) need a clean slate
      // here. Re-editing the title later still works via double-click
      // (dimension) or composer reopen (line) per shape kind.
      this._finalizeShape(kind, geom, el);
    },

    // -------------------------------------------------------------------------
    // Line — two-endpoint stroke with no arrows and no inline label.
    // Shares geometry (`{ a: [x,y], b: [x,y] }`) and draft-state
    // machinery with dimension; title rides the standard sibling-
    // above-shape path (rendered by `_renderTitleSibling`, same as
    // rectangle/circle/polygon). Comment is collected by the host's
    // annotation composer via the `etcher:shape-drawn` event.
    // -------------------------------------------------------------------------

    _startLine: function(pt, e) {
      // Two-click rubberband re-entry (mirrors _startDimension).
      if (this.draftState && this.draftState.kind === "line" &&
          this.draftState.pendingClickEnd) {
        this._commitDimensionAt(pt);
        return;
      }

      var g = svgEl("g");
      g.classList.add("etcher-shape", "etcher-line", "is-draft");

      var shaft = svgEl("line", {
        "stroke-width": "2",
        stroke: "currentColor",
        fill: "none"
      });
      shaft.classList.add("etcher-line-shaft");

      g.appendChild(shaft);

      this._applyShapeColor(g, this.activeColor);
      this.svg.appendChild(g);

      this.draftState = {
        kind: "line",
        anchor: pt,
        geometry: { a: [pt.x, pt.y], b: [pt.x, pt.y] },
        el: g,
        dragged: false,
        pendingClickEnd: false
      };
      this._renderShape(this.draftState);
      this._syncDraftHandles();
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    // -------------------------------------------------------------------------
    // Freehand
    //
    // A freehand stroke is captured as a raw polyline while the pointer is
    // down (every ~2px sample), then on release it is *simplified and fitted*
    // into a sparse run of cubic-bezier nodes. The committed geometry is
    // `{ nodes: [{ p:[x,y], hIn:[dx,dy]|null, hOut:[dx,dy]|null, type }] }` in
    // image px — `p` is the anchor, `hIn`/`hOut` are control handles stored as
    // offsets from the anchor (null = no handle on that side, i.e. a straight
    // join or a stroke endpoint), `type` is "smooth" (handles colinear, drag
    // one and the other mirrors) or "corner" (handles move independently).
    // Rendered as an SVG <path>. Legacy strokes saved in the old
    // `{ points: [...] }` form still render as a <polyline> and are read via
    // `_freehandFlatten`, so old canvases keep working untouched.
    // -------------------------------------------------------------------------

    // Target error for the curve fit, expressed in IMAGE px but derived from a
    // fixed on-screen target so the simplification feels the same at every
    // zoom level. (1 container px ≈ `imgPerCont` image px at the current
    // zoom; strip mode is identity so this collapses to the raw target.)
    _freehandFitTolerance: function() {
      var ca = this._imageToContainer({ x: 0,   y: 0 });
      var cb = this._imageToContainer({ x: 100, y: 0 });
      var dx = cb.x - ca.x, dy = cb.y - ca.y;
      var contPer100 = Math.sqrt(dx * dx + dy * dy) || 100;
      var imgPerCont = 100 / contPer100;
      // Higher = looser fit = fewer anchors/handles. ~8px on screen keeps
      // the curve faithful while collapsing a hand-drawn stroke to a
      // handful of nodes.
      var TARGET_SCREEN_PX = 8;
      return Math.max(0.5, TARGET_SCREEN_PX * imgPerCont);
    },

    // Ramer–Douglas–Peucker: drop points that lie within `epsilon` (image px)
    // of the chord between their kept neighbours. A cheap denoise pass before
    // the bezier fit so pointer jitter doesn't seed spurious control points.
    _rdpSimplify: function(points, epsilon) {
      if (points.length < 3) return points.slice();
      var sqEps = epsilon * epsilon;
      function sqSegDist(p, a, b) {
        var x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
        if (dx !== 0 || dy !== 0) {
          var t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
          if (t > 1) { x = b[0]; y = b[1]; }
          else if (t > 0) { x += dx * t; y += dy * t; }
        }
        dx = p[0] - x; dy = p[1] - y;
        return dx * dx + dy * dy;
      }
      function simplify(pts, first, last, out) {
        var maxSq = sqEps, index = -1;
        for (var i = first + 1; i < last; i++) {
          var sq = sqSegDist(pts[i], pts[first], pts[last]);
          if (sq > maxSq) { index = i; maxSq = sq; }
        }
        if (index !== -1) {
          if (index - first > 1) simplify(pts, first, index, out);
          out.push(pts[index]);
          if (last - index > 1) simplify(pts, index, last, out);
        }
      }
      var out = [points[0]];
      simplify(points, 0, points.length - 1, out);
      out.push(points[points.length - 1]);
      return out;
    },

    // Schneider's "Algorithm for Automatically Fitting Digitized Curves"
    // (Graphics Gems, 1990) — the same fit Paper.js's path.simplify() uses.
    // Input: a polyline (array of [x,y]) + a max error in image px. Output: an
    // array of cubic beziers [[p0,c1,c2,p3], ...] sharing endpoints, each a
    // [x,y] tuple. Recursively fits one cubic to the whole span, reparameter-
    // izing with Newton–Raphson; if it can't hit the tolerance it splits at
    // the worst point and fits each half. Self-contained — all vector math is
    // local so it doesn't bloat the hook's method table.
    _fitCurve: function(points, maxError) {
      function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
      function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
      function mul(a, s) { return [a[0] * s, a[1] * s]; }
      function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
      function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1]); }
      function normalize(a) { var m = len(a) || 1; return [a[0] / m, a[1] / m]; }

      var pts = [];
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (!pts.length ||
            p[0] !== pts[pts.length - 1][0] || p[1] !== pts[pts.length - 1][1]) {
          pts.push([p[0], p[1]]);
        }
      }
      if (pts.length < 2) return [];

      function q(ctrl, t) {
        var mt = 1 - t;
        var a = mul(ctrl[0], mt * mt * mt);
        var b = mul(ctrl[1], 3 * mt * mt * t);
        var c = mul(ctrl[2], 3 * mt * t * t);
        var d = mul(ctrl[3], t * t * t);
        return [a[0] + b[0] + c[0] + d[0], a[1] + b[1] + c[1] + d[1]];
      }
      function qprime(ctrl, t) {
        var mt = 1 - t;
        var a = mul(sub(ctrl[1], ctrl[0]), 3 * mt * mt);
        var b = mul(sub(ctrl[2], ctrl[1]), 6 * mt * t);
        var c = mul(sub(ctrl[3], ctrl[2]), 3 * t * t);
        return [a[0] + b[0] + c[0], a[1] + b[1] + c[1]];
      }
      function qprimeprime(ctrl, t) {
        var a = mul(add(sub(ctrl[2], mul(ctrl[1], 2)), ctrl[0]), 6 * (1 - t));
        var b = mul(add(sub(ctrl[3], mul(ctrl[2], 2)), ctrl[1]), 6 * t);
        return [a[0] + b[0], a[1] + b[1]];
      }
      function chordLengthParameterize(d) {
        var u = [0];
        for (var i = 1; i < d.length; i++) u[i] = u[i - 1] + len(sub(d[i], d[i - 1]));
        var last = u[u.length - 1] || 1;
        for (var j = 0; j < u.length; j++) u[j] /= last;
        return u;
      }
      function generateBezier(d, u, t1, t2) {
        var first = d[0], last = d[d.length - 1];
        var bez = [first, null, null, last];
        var nPts = d.length;
        var A = [];
        for (var i = 0; i < nPts; i++) {
          var ui = u[i], mt = 1 - ui;
          A.push([mul(t1, 3 * mt * mt * ui), mul(t2, 3 * mt * ui * ui)]);
        }
        var C = [[0, 0], [0, 0]], X = [0, 0];
        for (var k = 0; k < nPts; k++) {
          var a = A[k];
          C[0][0] += dot(a[0], a[0]);
          C[0][1] += dot(a[0], a[1]);
          C[1][0] += dot(a[0], a[1]);
          C[1][1] += dot(a[1], a[1]);
          var tmp = sub(d[k], q([first, first, last, last], u[k]));
          X[0] += dot(a[0], tmp);
          X[1] += dot(a[1], tmp);
        }
        var det_C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
        var det_C0_X  = C[0][0] * X[1]    - C[1][0] * X[0];
        var det_X_C1  = X[0]    * C[1][1] - X[1]    * C[0][1];
        var alpha_l = det_C0_C1 === 0 ? 0 : det_X_C1 / det_C0_C1;
        var alpha_r = det_C0_C1 === 0 ? 0 : det_C0_X / det_C0_C1;
        var segLength = len(sub(last, first));
        var epsilon = 1e-6 * segLength;
        if (alpha_l < epsilon || alpha_r < epsilon) {
          var dist = segLength / 3;
          bez[1] = add(first, mul(t1, dist));
          bez[2] = add(last,  mul(t2, dist));
        } else {
          bez[1] = add(first, mul(t1, alpha_l));
          bez[2] = add(last,  mul(t2, alpha_r));
        }
        return bez;
      }
      function computeMaxError(d, u, bez) {
        var maxDist = 0, splitPoint = Math.floor(d.length / 2);
        for (var i = 1; i < d.length - 1; i++) {
          var v = sub(q(bez, u[i]), d[i]);
          var dist = v[0] * v[0] + v[1] * v[1];
          if (dist > maxDist) { maxDist = dist; splitPoint = i; }
        }
        return [maxDist, splitPoint];
      }
      function reparameterize(bez, d, u) {
        return u.map(function(uu, i) {
          var dd = sub(q(bez, uu), d[i]);
          var qp = qprime(bez, uu);
          var num = dot(dd, qp);
          var den = dot(qp, qp) + dot(dd, qprimeprime(bez, uu));
          return den === 0 ? uu : uu - num / den;
        });
      }

      var MaxErrorSq = maxError * maxError;
      function fitCubic(d, t1, t2) {
        if (d.length === 2) {
          var dist = len(sub(d[1], d[0])) / 3;
          return [[d[0], add(d[0], mul(t1, dist)), add(d[1], mul(t2, dist)), d[1]]];
        }
        var u = chordLengthParameterize(d);
        var bez = generateBezier(d, u, t1, t2);
        var res = computeMaxError(d, u, bez);
        var maxDist = res[0], splitPoint = res[1];
        if (maxDist < MaxErrorSq) return [bez];
        if (maxDist < MaxErrorSq * 4) {
          for (var i = 0; i < 20; i++) {
            var uPrime = reparameterize(bez, d, u);
            bez = generateBezier(d, uPrime, t1, t2);
            res = computeMaxError(d, uPrime, bez);
            maxDist = res[0]; splitPoint = res[1];
            if (maxDist < MaxErrorSq) return [bez];
            u = uPrime;
          }
        }
        var centerTangent = normalize(sub(d[splitPoint - 1], d[splitPoint + 1]));
        var left  = fitCubic(d.slice(0, splitPoint + 1), t1, centerTangent);
        var right = fitCubic(d.slice(splitPoint), mul(centerTangent, -1), t2);
        return left.concat(right);
      }

      if (pts.length === 2) {
        var t = normalize(sub(pts[1], pts[0]));
        var dd = len(sub(pts[1], pts[0])) / 3;
        return [[pts[0], add(pts[0], mul(t, dd)), sub(pts[1], mul(t, dd)), pts[1]]];
      }
      var leftTangent  = normalize(sub(pts[1], pts[0]));
      var rightTangent = normalize(sub(pts[pts.length - 2], pts[pts.length - 1]));
      return fitCubic(pts, leftTangent, rightTangent);
    },

    // Convert the fitter's bezier list into the stored node format. Adjacent
    // beziers share an anchor, so node[k] carries the incoming handle from
    // bez[k-1] and the outgoing handle into bez[k]. Interior nodes are
    // "smooth" (the fit makes their handles colinear at the join); the two
    // endpoints are "corner" with a single handle each.
    _beziersToNodes: function(beziers) {
      if (!beziers.length) return [];
      function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
      var first = beziers[0];
      var nodes = [
        { p: [first[0][0], first[0][1]], hIn: null, hOut: sub(first[1], first[0]), type: "corner" }
      ];
      for (var k = 0; k < beziers.length; k++) {
        var b = beziers[k];
        var p3 = b[3];
        var hIn = sub(b[2], p3);
        if (k < beziers.length - 1) {
          nodes.push({ p: [p3[0], p3[1]], hIn: hIn, hOut: sub(beziers[k + 1][1], p3), type: "smooth" });
        } else {
          nodes.push({ p: [p3[0], p3[1]], hIn: hIn, hOut: null, type: "corner" });
        }
      }
      return nodes;
    },

    // Sample a node run (or a legacy points array) into a dense polyline of
    // image-px [x,y] points. Used everywhere the curve needs to be treated as
    // a polygon: hit-testing, nearest-point for leader lines, and bbox.
    _freehandFlatten: function(g, steps) {
      if (!g) return [];
      if (g.points) return g.points;
      var nodes = g.nodes || [];
      if (nodes.length === 0) return [];
      if (nodes.length === 1) return [nodes[0].p.slice()];
      steps = steps || 16;
      function add(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
      function cubicAt(p0, p1, p2, p3, t) {
        var mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
        return [
          a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
          a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]
        ];
      }
      var out = [nodes[0].p.slice()];
      for (var i = 1; i < nodes.length; i++) {
        var prev = nodes[i - 1], cur = nodes[i];
        var p0 = prev.p, p3 = cur.p;
        var p1 = prev.hOut ? add(prev.p, prev.hOut) : prev.p;
        var p2 = cur.hIn ? add(cur.p, cur.hIn) : cur.p;
        for (var s = 1; s <= steps; s++) out.push(cubicAt(p0, p1, p2, p3, s / steps));
      }
      return out;
    },

    // Build an SVG path `d` from nodes, projecting each anchor + handle through
    // `mapPt` (image→container). A null handle collapses that side's control
    // point onto the anchor, turning the segment into a straight line.
    _freehandPathD: function(nodes, mapPt) {
      if (!nodes || !nodes.length) return "";
      function addv(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
      var d = "";
      for (var i = 0; i < nodes.length; i++) {
        var c = mapPt(nodes[i].p);
        if (i === 0) { d = "M " + c.x + " " + c.y; continue; }
        var prev = nodes[i - 1], cur = nodes[i];
        var c1 = mapPt(prev.hOut ? addv(prev.p, prev.hOut) : prev.p);
        var c2 = mapPt(cur.hIn ? addv(cur.p, cur.hIn) : cur.p);
        d += " C " + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + c.x + " " + c.y;
      }
      return d;
    },

    _startFreehand: function(pt, e) {
      var path = svgEl("polyline", { "stroke-width": "2", fill: "none" });
      path.classList.add("etcher-shape", "is-draft");
      this._applyShapeColor(path, this.activeColor);
      this.svg.appendChild(path);
      var geom = { points: [[pt.x, pt.y]] };
      this.draftState = { kind: "freehand", geometry: geom, el: path };
      this._renderShape(this.draftState);
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _appendFreehand: function(pt) {
      var pts = this.draftState.geometry.points;
      var last = pts[pts.length - 1];
      var dx = pt.x - last[0], dy = pt.y - last[1];
      if (dx * dx + dy * dy < 4) return; // throttle: skip sub-2px moves in image px
      pts.push([pt.x, pt.y]);
      this._renderShape(this.draftState);
    },

    _commitFreehand: function(_pt) {
      var pts = this.draftState.geometry.points;
      if (pts.length < 2) {
        this._cancelDraft();
        return;
      }
      var oldEl = this.draftState.el;
      // Simplify + fit the raw samples into bezier nodes. RDP runs a touch
      // tighter than the fit tolerance so it only strips genuine jitter and
      // leaves real curvature for the fitter to model.
      var tol = this._freehandFitTolerance();
      var simplified = this._rdpSimplify(pts, tol * 0.6);
      var beziers = this._fitCurve(simplified, tol);
      // Degenerate fit (e.g. a single dot) — keep the raw polyline so the
      // stroke is never lost; it stays in the legacy {points} format.
      if (!beziers || !beziers.length) {
        oldEl.classList.remove("is-draft");
        this._finalizeShape("freehand", { points: pts }, oldEl);
        return;
      }
      var nodes = this._beziersToNodes(beziers);
      var path = svgEl("path", { "stroke-width": "2", fill: "none" });
      path.classList.add("etcher-shape");
      this._applyShapeColor(path, this.activeColor);
      this.svg.appendChild(path);
      oldEl.remove();
      this.draftState.el = path;
      this.draftState.geometry = { nodes: nodes };
      this._finalizeShape("freehand", { nodes: nodes }, path);
    },

    // -------------------------------------------------------------------------
    // Text — freestanding text-label shape. Click-drag a bounding box,
    // release to commit and enter inline edit mode (HTML <input> hosted
    // in a <foreignObject> over the bbox). The text content is stored
    // in the annotation's `title` field — the same column an inline
    // title on other shapes uses, so a text shape is essentially "just
    // a title with a custom bbox."
    // -------------------------------------------------------------------------

    _startText: function(pt, e) {
      var g = svgEl("g");
      g.classList.add("etcher-shape", "etcher-text", "is-draft");
      // Hit-zone rect — invisible by default, dashed border while
      // dragging the draft so the user can see what they're sizing.
      var rect = svgEl("rect", {
        fill: "transparent",
        stroke: "currentColor",
        "stroke-width": "2"
      });
      rect.classList.add("etcher-text-rect");
      var text = svgEl("text", {
        "text-anchor": "start",
        "dominant-baseline": "hanging",
        fill: "currentColor",
        stroke: "none"
      });
      text.classList.add("etcher-text-content");
      g.appendChild(rect);
      g.appendChild(text);
      this._applyShapeColor(g, this.activeColor);
      this.svg.appendChild(g);

      var geom = { x: pt.x, y: pt.y, w: 0, h: 0 };
      this.draftState = { kind: "text", anchor: pt, geometry: geom, el: g };
      this._renderShape(this.draftState);
      this._syncDraftHandles();
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateText: function(pt) {
      var a = this.draftState.anchor;
      this.draftState.geometry = {
        x: Math.min(a.x, pt.x), y: Math.min(a.y, pt.y),
        w: Math.abs(pt.x - a.x), h: Math.abs(pt.y - a.y)
      };
      this._renderShape(this.draftState);
      this._positionAllHandles(this.draftState);
    },

    _commitText: function(pt) {
      var a = this.draftState.anchor;
      var geom = {
        x: Math.min(a.x, pt.x),
        y: Math.min(a.y, pt.y),
        w: Math.abs(pt.x - a.x),
        h: Math.abs(pt.y - a.y)
      };
      // Tiny boxes from accidental clicks default to a sensible minimum
      // size in image px so the user gets a usable text bbox even on a
      // single click. The minimum is computed from the current zoom so
      // it looks roughly the same on screen across zoom levels.
      var minImagePx = this._textDefaultBoxImagePx();
      if (geom.w < minImagePx) geom.w = minImagePx * 4;
      if (geom.h < minImagePx) geom.h = minImagePx * 1.2;

      var el = this.draftState.el;
      el.classList.remove("is-draft");
      var self = this;
      this._finalizeShape("text", geom, el, function(shape) {
        // Drop straight into inline-edit mode so the user can type
        // immediately. `_startTextEdit` waits for the server-assigned
        // uuid (via `etcher:annotation-saved`) before flushing the
        // first `etcher:updated` so we don't try to PATCH an uncommitted
        // shape.
        self._startTextEdit(shape);
      });
    },

    // -------------------------------------------------------------------------
    // Eraser — press-and-drag to gray out shapes the cursor crosses,
    // release to bulk-delete them. Hit-tests against image-px geometry
    // (not DOM pointer-events, which are off for shapes while a tool
    // is active). All shapes erased in one stroke become a single
    // undo op so ⌘Z brings the whole sweep back at once.
    // -------------------------------------------------------------------------

    _startErase: function(pt, e) {
      this._erasingActive = true;
      this._erasingHits = [];
      this._erasingHitSet = new Set();
      // Adopt the hover-preview shape into the active sweep so the
      // user doesn't have to "re-hit" it on press.
      if (this._eraserHovered) {
        this._erasingHitSet.add(this._eraserHovered);
        this._erasingHits.push(this._eraserHovered);
        this._eraserHovered = null;
      }
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
      this._hideTooltip();
      this._eraserMove(pt);
    },

    // Mouseover preview while the eraser is idle (no button held).
    // Grays out the single shape under the cursor so the user sees
    // what would be erased on click. Limited to one shape at a time;
    // sweep mode (press-and-drag) accumulates multiple.
    _eraserHover: function(pt) {
      var hit = null;
      for (var i = 0; i < this.shapes.length; i++) {
        var s = this.shapes[i];
        if (!s.uuid) continue;
        if (this._eraserHit(s, pt)) { hit = s; break; }
      }
      if (this._eraserHovered === hit) return;
      this._clearEraserHover();
      if (hit) {
        if (hit.el) hit.el.classList.add("is-erasing");
        if (hit.titleGroup) hit.titleGroup.classList.add("is-erasing");
        this._eraserHovered = hit;
      }
    },

    _clearEraserHover: function() {
      var prev = this._eraserHovered;
      if (!prev) return;
      if (prev.el) prev.el.classList.remove("is-erasing");
      if (prev.titleGroup) prev.titleGroup.classList.remove("is-erasing");
      this._eraserHovered = null;
    },

    _onPointerLeave: function() {
      this._clearEraserHover();
      this._clearClosestMidpoint();
    },

    _eraserMove: function(pt) {
      if (!this._erasingActive) return;
      var self = this;
      this.shapes.forEach(function(shape) {
        if (self._erasingHitSet.has(shape)) return;
        if (!shape.uuid) return;
        if (self._eraserHit(shape, pt)) {
          self._erasingHitSet.add(shape);
          self._erasingHits.push(shape);
          if (shape.el) shape.el.classList.add("is-erasing");
          if (shape.titleGroup) shape.titleGroup.classList.add("is-erasing");
        }
      });
    },

    _commitErase: function() {
      if (!this._erasingActive) return;
      this._erasingActive = false;
      var hits = this._erasingHits || [];
      this._erasingHits = null;
      this._erasingHitSet = null;
      if (hits.length === 0) return;

      // Push a single compound undo op covering every shape in the
      // stroke so ⌘Z brings them all back together.
      this._pushUndoBulkDelete(hits);

      var self = this;
      hits.forEach(function(shape) {
        var uuid = shape.uuid;
        if (self.editingShape === shape) self._exitEditMode();
        if (self.editingTitleShape === shape) self._exitTitleEditMode();
        var idx = self.shapes.indexOf(shape);
        if (idx !== -1) {
          if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
          if (shape.titleGroup && shape.titleGroup.parentNode) {
            shape.titleGroup.parentNode.removeChild(shape.titleGroup);
          }
          self.shapes.splice(idx, 1);
        }
      });
      self._hideTooltip();
      self._emitChanged();
    },

    // Hit-test in image px against each shape's geometry (or the
    // shape's title group, if it has one). Permissive — covers the
    // full visible footprint so users don't have to nick the exact
    // glyph or vertex to erase.
    _eraserHit: function(shape, pt) {
      // Eraser delegates to the shared per-kind point-in-shape test.
      // Kept as a thin alias so the eraser's call sites stay readable
      // ("hit one shape during a sweep") even though the underlying
      // logic now also drives the doc-level hover hit-test.
      return this._shapeContainsPoint(shape, pt);
    },

    // Returns the topmost persisted shape whose footprint contains
    // the image-px point, or `null`. Walks `self.shapes` in reverse
    // so visually-on-top shapes win when footprints overlap. Skips
    // shapes without a uuid (drafts, mid-create, recently-deleted).
    _shapeAt: function(pt) {
      if (!this.shapes) return null;
      // Strip mode: only test shapes that live on the same image as
      // `pt`. screenToImage on a strip handle returns `{imageIdx, x, y}`,
      // and shape coords are stored in per-image natural pixels, so
      // mixing pages would produce false positives.
      var stripMode = this.handleKind === "strip";
      var ptImageIdx = stripMode && typeof pt.imageIdx === "number" ? pt.imageIdx : null;
      for (var i = this.shapes.length - 1; i >= 0; i--) {
        var s = this.shapes[i];
        if (!s.uuid) continue;
        if (stripMode && s.image_idx !== ptImageIdx) continue;
        if (this._shapeContainsPoint(s, pt)) return s;
      }
      return null;
    },

    // Per-kind hit-test for "does this image-px point land on the
    // shape?". Used by the eraser sweep, the polygon midpoint
    // hover gate, and (now) the doc-level hover + click detection
    // that lets pan/zoom pass through shapes. Permissive — covers
    // the full visible footprint plus a title group when present,
    // so users don't have to nick the exact glyph or vertex.
    _shapeContainsPoint: function(shape, pt) {
      function inRect(box) {
        if (!box) return false;
        return pt.x >= box.x && pt.x <= box.x + box.w &&
               pt.y >= box.y && pt.y <= box.y + box.h;
      }
      // Title group (when present) is its own hit zone.
      if (shape.titleGroup && shape._renderedTitleImage &&
          inRect(shape._renderedTitleImage)) {
        return true;
      }
      var g = shape.geometry;
      switch (shape.kind) {
        case "rectangle":
          return inRect(g);
        case "text":
          return inRect(shape._renderedBox || g);
        case "circle": {
          var dx = pt.x - g.cx, dy = pt.y - g.cy;
          return dx * dx + dy * dy <= g.r * g.r;
        }
        case "polygon":
        case "freehand":
          return this._shapeContainsImagePoint(shape, pt);
        case "callout": {
          var box = shape._renderedBox || this._calloutTextBoxImage(g);
          if (inRect(box)) return true;
          var ax = g.anchor[0], ay = g.anchor[1];
          var dax = pt.x - ax, day = pt.y - ay;
          // Small radius around the anchor dot so the user can erase
          // by clicking the leader endpoint as well as the label.
          var r = this._textDefaultBoxImagePx() * 0.6;
          return dax * dax + day * day <= r * r;
        }
        case "line":
        case "dimension": {
          // Hit if the point is within ~tolerance image px of the
          // line segment from a to b. Tolerance scales with viewport
          // so the hit target stays comfortable at any zoom. Shared
          // between dimension + line since both store
          // `geometry = { a: [x,y], b: [x,y] }`.
          var dax2 = g.b[0] - g.a[0];
          var day2 = g.b[1] - g.a[1];
          var lenSq = dax2 * dax2 + day2 * day2;
          if (lenSq <= 0.0001) return false;
          var t = ((pt.x - g.a[0]) * dax2 + (pt.y - g.a[1]) * day2) / lenSq;
          t = Math.max(0, Math.min(1, t));
          var nearestX = g.a[0] + t * dax2;
          var nearestY = g.a[1] + t * day2;
          var ddx2 = pt.x - nearestX;
          var ddy2 = pt.y - nearestY;
          var tol = this._textDefaultBoxImagePx() * 0.6;
          return ddx2 * ddx2 + ddy2 * ddy2 <= tol * tol;
        }
        default:
          return false;
      }
    },

    // Convert ~40 container px (a comfortable single-line text box at
    // 12px font) into image px at the current zoom. Falls back to a
    // safe constant if the viewport isn't initialized yet.
    _textDefaultBoxImagePx: function() {
      try {
        var a = this._imageToContainer({ x: 0, y: 0 });
        var b = this._imageToContainer({ x: 0, y: 1 });
        var perImagePx = Math.abs(b.y - a.y) || 1;
        return 16 / perImagePx;
      } catch (e) {
        return 16;
      }
    },

    // Resolve a callout's text bbox in IMAGE coords. New callouts ship
    // `geometry.text_box = {x, y, w, h}`; legacy rows (pre-v118) carry
    // `geometry.text_at = [x, y]` instead — derive a sensible default
    // bbox at that point so they render without a migration.
    _calloutTextBoxImage: function(geometry) {
      if (geometry && geometry.text_box) return geometry.text_box;
      var basePx = this._textDefaultBoxImagePx();
      var w = basePx * 6;
      var h = basePx * 1.4;
      var p = (geometry && geometry.text_at) || [0, 0];
      // Center the bbox slightly above the legacy text-baseline point
      // so it looks roughly where the old single-line label sat.
      return { x: p[0], y: p[1] - h * 0.85, w: w, h: h };
    },

    // Pick the midpoint of the rect edge closest to a point (all in
    // container coords). Used to anchor a callout's leader line on
    // the side of the text bbox facing the anchor.
    _nearestRectEdgeMidpoint: function(rect, point) {
      var cx = rect.x + rect.w / 2;
      var cy = rect.y + rect.h / 2;
      var dx = point.x - cx;
      var dy = point.y - cy;
      // Compare absolute deltas scaled by the rect's aspect ratio so
      // wide bboxes prefer top/bottom edges and tall ones prefer
      // left/right — keeps the line short and natural-looking.
      var ax = Math.abs(dx) / (rect.w || 1);
      var ay = Math.abs(dy) / (rect.h || 1);
      if (ax > ay) {
        // left or right edge
        return dx >= 0
          ? { x: rect.x + rect.w, y: cy }
          : { x: rect.x,          y: cy };
      } else {
        // top or bottom edge
        return dy >= 0
          ? { x: cx, y: rect.y + rect.h }
          : { x: cx, y: rect.y          };
      }
    },

    // -------------------------------------------------------------------------
    // Inline text editor — a <foreignObject> overlay with an <input>
    // positioned exactly over the text shape's bbox. Pressing Enter (or
    // clicking outside) commits the title via `etcher:updated`; Esc
    // cancels and, if the shape has no title yet, deletes it (a freshly
    // drawn text shape with no content is just noise).
    // -------------------------------------------------------------------------

    _startTextEdit: function(shape) {
      if (!shape) return;
      // text + callout + dimension edit their own bbox; rect/circle/
      // poly/freehand edit a title that lives in `metadata.title_box`
      // on the parent.
      var alwaysEditable =
        shape.kind === "text" ||
        shape.kind === "callout" ||
        shape.kind === "dimension";
      var hasTitle =
        !alwaysEditable &&
        shape.metadata && shape.metadata.title != null;
      if (!alwaysEditable && !hasTitle) return;
      this._endTextEdit();

      var self = this;
      var g;
      if (shape.kind === "text") {
        g = shape.geometry;
      } else if (shape.kind === "callout") {
        g = this._calloutTextBoxImage(shape.geometry);
      } else if (shape.kind === "dimension") {
        // Small box centered on the label's lerp position along the
        // shaft so the inline editor pops up exactly where the text
        // will land. Sized off `_textDefaultBoxImagePx` so it scales
        // with the current zoom.
        var dimA = shape.geometry.a;
        var dimB = shape.geometry.b;
        var dimT = (shape.metadata && typeof shape.metadata.title_offset === "number")
          ? shape.metadata.title_offset : 0.5;
        var lblX = dimA[0] + (dimB[0] - dimA[0]) * dimT;
        var lblY = dimA[1] + (dimB[1] - dimA[1]) * dimT;
        var basePx = this._textDefaultBoxImagePx();
        var dlw = basePx * 6;
        var dlh = basePx * 1.4;
        g = { x: lblX - dlw / 2, y: lblY - dlh / 2, w: dlw, h: dlh };
      } else {
        g = this._shapeTitleBoxImage(shape, this._lastBboxTopImageFor(shape));
      }
      if (!g) return;
      var tl = this._imageToContainer({ x: g.x, y: g.y });
      var br = this._imageToContainer({ x: g.x + g.w, y: g.y + g.h });
      var w = Math.max(20, Math.abs(br.x - tl.x));
      var h = Math.max(16, Math.abs(br.y - tl.y));

      var fo = svgEl("foreignObject", {
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        width: w,
        height: h
      });
      fo.classList.add("etcher-text-editor");
      var input = document.createElement("input");
      input.type = "text";
      input.maxLength = 200;
      input.placeholder = "Type your label…";
      input.value = (shape.metadata && shape.metadata.title) || "";
      input.style.width = "100%";
      input.style.height = "100%";
      input.style.boxSizing = "border-box";
      input.style.border = "2px dashed currentColor";
      input.style.background = "rgba(255, 255, 255, 0.9)";
      // Hard-pin black so the typed text is readable on the white-ish
      // input background regardless of the shape's stroke color (light
      // pastels like yellow / pink were nearly invisible when the input
      // inherited the shape's color).
      input.style.color = "#000";
      input.style.padding = "2px 4px";
      input.style.font = "500 14px ui-sans-serif, system-ui, -apple-system, sans-serif";
      input.style.outline = "none";

      fo.appendChild(input);
      this.svg.appendChild(fo);
      this._textEditor = { fo: fo, input: input, shape: shape };
      // Hide the visible <text> while editing — the input shows the
      // current content live, and overlapping them blurs the readout.
      // For title edits, the visible text lives on the title group
      // (not the parent shape's element).
      var hostEl = this._textEditHost(shape);
      var existing = hostEl && hostEl.querySelector(".etcher-text-content");
      if (existing) existing.setAttribute("visibility", "hidden");

      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          self._commitTextEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          self._cancelTextEdit();
        }
      });
      // Blur path (click outside the input but inside the overlay,
      // viewport edge, etc.) commits as well — matches the muscle
      // memory from inline text editors elsewhere.
      input.addEventListener("blur", function() {
        // Defer so synchronous Enter/Esc handling above wins.
        setTimeout(function() {
          if (self._textEditor && self._textEditor.input === input) {
            self._commitTextEdit();
          }
        }, 0);
      });
      // Focus on next frame so the foreignObject is attached before
      // we yank the cursor in.
      setTimeout(function() { try { input.focus(); input.select(); } catch (_) {} }, 0);
    },

    _commitTextEdit: function() {
      var ed = this._textEditor;
      if (!ed) return;
      var shape = ed.shape;
      // Snapshot the *pre-edit* state for undo before we overwrite
      // metadata.title locally. Captured here (not inside the
      // metadata-mutation block below) so the snapshot still reflects
      // the previous title even on no-op commits we early-return on.
      var historyBefore = this._snapshotShape(shape);
      var newTitle = ed.input.value.trim();
      var prevTitle = (shape.metadata && shape.metadata.title) || "";

      // Mirror the new title locally so the <text> renders with it
      // immediately, before the server round-trip.
      shape.metadata = Object.assign({}, shape.metadata || {}, { title: newTitle });
      this._endTextEdit();
      this._renderShape(shape);

      if (newTitle === "" && !prevTitle) {
        // Brand-new text shape with no content typed — clean up. UUIDs
        // are local in 0.3.x so the delete is immediate, no tmp_id
        // round-trip / pending-title bookkeeping needed.
        this._discardEmptyTextShape(shape);
        return;
      }

      if (newTitle === prevTitle) return;

      this._emitChanged();
      this._pushUndo(shape.uuid, historyBefore, this._snapshotShape(shape));
    },

    _cancelTextEdit: function() {
      var ed = this._textEditor;
      if (!ed) return;
      var shape = ed.shape;
      this._endTextEdit();

      var hasContent = shape.metadata && shape.metadata.title;
      if (!hasContent) {
        this._discardEmptyTextShape(shape);
        return;
      }
      this._renderShape(shape);
    },

    _endTextEdit: function() {
      var ed = this._textEditor;
      if (!ed) return;
      if (ed.fo && ed.fo.parentNode) ed.fo.parentNode.removeChild(ed.fo);
      var hostEl = ed.shape && this._textEditHost(ed.shape);
      var existing = hostEl && hostEl.querySelector(".etcher-text-content");
      if (existing) existing.removeAttribute("visibility");
      this._textEditor = null;
    },

    // Which DOM element hosts the visible <text class="etcher-text-content">?
    // text + callout + dimension: the shape's own `<g>`.
    // rect/circle/poly/freehand with a title: the title group.
    _textEditHost: function(shape) {
      if (!shape) return null;
      if (shape.kind === "text" || shape.kind === "callout" || shape.kind === "dimension") {
        return shape.el;
      }
      return shape.titleGroup || null;
    },

    // Strip a text shape that was abandoned mid-creation (no title ever
    // typed). Every shape has a local uuid from the moment it was
    // drawn, so deletion is immediate — no tmp_id round-trip needed.
    _discardEmptyTextShape: function(shape) {
      if (!shape) return;
      this._removeShape(shape.uuid);
    },

    // -------------------------------------------------------------------------
    // Shared finalize + cancel
    // -------------------------------------------------------------------------

    _finalizeShape: function(kind, geometry, el, afterCreate) {
      var uuid = genUuidV7();
      el.setAttribute("data-uuid", uuid);
      // Suppress Fresco's `tap` event when the user later taps this
      // shape — Fresco probes for this attribute under the tap point
      // via `document.elementsFromPoint`. Shape `<g>` / `<rect>` /
      // etc. elements all carry `pointer-events: none` (so
      // pan/zoom passes through), which would hide them from any
      // hit-test that relied on the topmost-element heuristic; the
      // data attr is the explicit-opt-in path.
      el.setAttribute("data-fresco-suppress-tap", "");
      var style = this.activeColor ? { color: this.activeColor } : null;
      var shape = {
        uuid: uuid,
        kind: kind,
        geometry: geometry,
        style: style,
        el: el
      };
      // Strip mode: tag the shape with the image it was drawn on so the
      // pushed `etcher:annotations-changed` payload carries `image_idx`,
      // and so subsequent hit-tests / handle renders / interactions can
      // route to the correct per-image overlay.
      if (this.handleKind === "strip" && this._stripActiveDraw) {
        shape.image_idx = this._stripActiveDraw.imageIdx;
        el.setAttribute("data-image-idx", String(shape.image_idx));
      }
      // Multi-image canvas: tag the shape with its host image id so
      // visibility toggling can hide it when the host display:nones
      // that image. Single-image canvases skip this (no `image_id`
      // returned), keeping the on-the-wire payload backwards-compat.
      if (this.handleKind === "canvas") {
        var imageId = this._resolveCanvasImageId(kind, geometry);
        if (imageId) {
          shape.image_id = imageId;
          el.setAttribute("data-image-id", imageId);
        }
      }
      this.shapes.push(shape);
      this._renderShape(shape);
      this._attachShapeInteractions(shape);

      this._emitChanged();

      // Swallow Fresco's next `tap` (Fresco >= 0.5.9). The OS-
      // synthesized mousedown/mouseup that follows a drag's
      // touchend triggers a `tap` emit on Fresco, which races
      // etcher's mode-flip and can fire a consumer's tap-zone
      // navigation immediately after the user committed a shape
      // (a paged reader would page-turn the just-drawn annotation
      // off-screen). Older Fresco versions don't expose the method
      // — guard with typeof and no-op there.
      if (this.handle && typeof this.handle.suppressNextTap === "function") {
        this.handle.suppressNextTap(250);
      }

      // Dedicated user-draw event. `annotations-changed` fires on every
      // mutation (including undo/redo, drags, color picks) and is the
      // right channel for persistence sync. But "open the composer for
      // this shape" is about user intent, not state diff — undo of a
      // delete restores a shape via _emitChanged too, and that should
      // NOT re-open the composer. So consumers wanting to react to "user
      // just drew a brand-new shape" subscribe to this event instead.
      if (this.pushEventTo) {
        this.pushEventTo(this.el, "etcher:shape-drawn", {
          uuid: shape.uuid,
          kind: shape.kind
        });
      }

      this.draftState = null;
      this._syncDraftHandles();

      // Per-kind post-create hook (e.g. text → inline edit). Runs on
      // the just-pushed shape so callers can capture it without
      // re-finding by uuid.
      if (typeof afterCreate === "function") {
        try { afterCreate(shape); } catch (_) {}
      }

      // Drop back to cursor mode after every successful create so the
      // next click selects rather than starting another shape. `null`
      // is the cursor; passing it does NOT exit any inline edit mode
      // the afterCreate hook may have entered (text / callout), since
      // `_selectTool` only calls `_exitEditMode` when toolKey != null.
      this._selectTool(null);
    },

    // Returns the shape's bottom-left corner in container px (the
    // coordinate space the host LV's overlay div uses). Falls back to
    // the viewer center if the shape's bounding rect isn't available
    // yet for some reason.
    _shapeAnchorBottomLeft: function(shape) {
      try {
        var sr = shape.el.getBoundingClientRect();
        var cr = this.handle.container.getBoundingClientRect();
        return { x: sr.left - cr.left, y: sr.bottom - cr.top + 8 };
      } catch (_) {
        var cr2 = this.handle.container.getBoundingClientRect();
        return { x: cr2.width / 2 - 160, y: cr2.height / 2 };
      }
    },

    _cancelDraft: function() {
      if (this.draftState && this.draftState.el && this.draftState.el.parentNode) {
        this.draftState.el.parentNode.removeChild(this.draftState.el);
      }
      this.draftState = null;
      if (this.draftPolygon && this.draftPolygon.el && this.draftPolygon.el.parentNode) {
        this.draftPolygon.el.parentNode.removeChild(this.draftPolygon.el);
      }
      this.draftPolygon = null;
      if (this.draftCallout && this.draftCallout.el && this.draftCallout.el.parentNode) {
        this.draftCallout.el.parentNode.removeChild(this.draftCallout.el);
      }
      this.draftCallout = null;
      this._syncDraftHandles();
    },

    // -------------------------------------------------------------------------
    // Initial render + helpers
    // -------------------------------------------------------------------------

    _renderInitial: function() {
      var self = this;
      // Hydrate from `extensions.etcher` set by the consumer via
      // Fresco.Canvas.put_extension/3 (or the matching scroll_strip
      // `extensions={}` attr). Replaces 0.2.x's server-rendered
      // `data-initial-annotations` attribute.
      var ext = (self.handle && typeof self.handle.getExtension === "function")
        ? self.handle.getExtension("etcher")
        : null;
      var annotations = (ext && Array.isArray(ext.annotations)) ? ext.annotations : [];
      var stripMode = self.handleKind === "strip";
      annotations.forEach(function(ann) {
        // Strip annotations are stored in per-image natural-pixel space.
        // Switch the active overlay before each render so `self.svg`
        // appendChild sites (in `_renderAnnotation` / `_renderShape`)
        // attach into the matching page. Annotations missing a valid
        // `image_idx` are skipped with a console hint — they almost
        // certainly came from a canvas-mode export.
        if (stripMode) {
          var idx = typeof ann.image_idx === "number" ? ann.image_idx : -1;
          if (!self.pageOverlays || !self.pageOverlays[idx]) {
            console.warn(
              "[Etcher] Skipping annotation with missing/unknown image_idx:",
              ann.uuid, "image_idx:", ann.image_idx
            );
            return;
          }
          self._activateOverlayForImage(idx);
        }
        self._renderAnnotation(ann);
      });

      // If any pre-0.4.7 canvas shapes got their `image_id`
      // backfilled during the loop above, push one bulk emit so the
      // consumer persists the new ids. The next mount sees them in
      // `ann.image_id` and skips this branch entirely.
      if (self._backfilledImageId) {
        self._backfilledImageId = false;
        self._emitChanged();
      }

      // Ensure the color palette is seeded even for headless layers
      // (toolbar disabled) so `getColors()` is populated. The toolbar
      // build already seeds when present; this only fills an empty
      // palette and never clobbers a user edit.
      if (!self._colorSlots || !self._colorSlots.length) self._seedColorSlots();
    },

    _renderAnnotation: function(ann) {
      if (!ann || !ann.kind || !ann.geometry) return;
      var el;

      switch (ann.kind) {
        case "rectangle": el = svgEl("rect");                       break;
        case "circle":    el = svgEl("circle");                     break;
        case "polygon":   el = svgEl("polygon");                    break;
        case "freehand":
          el = (ann.geometry && ann.geometry.nodes)
            ? svgEl("path", { fill: "none" })
            : svgEl("polyline", { fill: "none" });
          break;
        case "text": {
          // <g> wrapping a hit-zone <rect> and a content <text>. The
          // group bind to `currentColor` so _applyShapeColor can recolor
          // the rect border and text fill in one stroke.
          el = svgEl("g");
          el.classList.add("etcher-text");
          var trect = svgEl("rect", {
            fill: "transparent",
            stroke: "currentColor",
            "stroke-width": "2"
          });
          trect.classList.add("etcher-text-rect");
          var ttext = svgEl("text", {
            "text-anchor": "start",
            "dominant-baseline": "hanging",
            fill: "currentColor",
            stroke: "none"
          });
          ttext.classList.add("etcher-text-content");
          el.appendChild(trect);
          el.appendChild(ttext);
          break;
        }
        case "callout": {
          // Blueprint-style callout: a horizontal underline spanning
          // the full bottom of the text bbox + a leader line from the
          // anchor up to the bottom corner of the bbox that sits
          // closer to the anchor. Both lines, the bbox rect, the
          // content text, and the anchor dot live inside the same <g>
          // so _applyShapeColor recolors the whole composition via
          // `style.color`. Lines render first so the rect/text/dot
          // overlay them.
          el = svgEl("g");
          el.classList.add("etcher-callout", "etcher-text");
          el.appendChild(svgEl("line", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none"
          }));
          var coUnderline = svgEl("line", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none"
          });
          coUnderline.classList.add("etcher-callout-underline");
          el.appendChild(coUnderline);
          var coRect = svgEl("rect", {
            fill: "transparent",
            stroke: "currentColor",
            "stroke-width": "2"
          });
          coRect.classList.add("etcher-text-rect");
          el.appendChild(coRect);
          var coText = svgEl("text", {
            "text-anchor": "start",
            "dominant-baseline": "hanging",
            fill: "currentColor",
            stroke: "none"
          });
          coText.classList.add("etcher-text-content");
          el.appendChild(coText);
          el.appendChild(svgEl("circle", {
            r: "3",
            fill: "currentColor",
            stroke: "none"
          }));
          break;
        }
        case "dimension": {
          // Same composition as `_startDimension` so persisted
          // dimensions re-hydrate identically. Shaft + 2 V-arrows in
          // currentColor; label is hard-pinned black with white halo
          // and `pointer-events: all` so the slide-along-line gesture
          // (wired in `_attachDimensionLabelDrag`) has a forgiving
          // hit area on the bbox of even short labels.
          el = svgEl("g");
          el.classList.add("etcher-dimension");
          var dimShaft = svgEl("line", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none"
          });
          dimShaft.classList.add("etcher-dim-shaft");
          el.appendChild(dimShaft);
          var dimArrowA = svgEl("polyline", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none",
            "stroke-linejoin": "round",
            "stroke-linecap": "round"
          });
          dimArrowA.classList.add("etcher-dim-arrow");
          el.appendChild(dimArrowA);
          var dimArrowB = svgEl("polyline", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none",
            "stroke-linejoin": "round",
            "stroke-linecap": "round"
          });
          dimArrowB.classList.add("etcher-dim-arrow");
          el.appendChild(dimArrowB);
          var dimLabel = svgEl("text", {
            "text-anchor": "middle",
            "dominant-baseline": "alphabetic",
            fill: "#000",
            stroke: "rgba(255, 255, 255, 0.95)",
            "stroke-width": "3",
            "stroke-linejoin": "round",
            "paint-order": "stroke fill",
            "pointer-events": "all"
          });
          dimLabel.classList.add("etcher-dim-label", "etcher-text-content");
          el.appendChild(dimLabel);
          break;
        }
        case "line": {
          // <g> wrapping a single stroked <line>. No arrows, no inline
          // label — title (if any) rides the sibling-above-shape path.
          el = svgEl("g");
          el.classList.add("etcher-line");
          var lnShaft = svgEl("line", {
            "stroke-width": "2",
            stroke: "currentColor",
            fill: "none"
          });
          lnShaft.classList.add("etcher-line-shaft");
          el.appendChild(lnShaft);
          break;
        }
        default: return;
      }

      // Non-group shapes get a uniform stroke-width on the root.
      // Callout / text / dimension / line are <g> wrappers — their
      // visible strokes live on the inner children, so leaving the
      // group unstroked avoids painting a bogus border on the wrapper.
      if (ann.kind !== "callout" && ann.kind !== "text" && ann.kind !== "dimension" && ann.kind !== "line") {
        el.setAttribute("stroke-width", "2");
      }
      el.classList.add("etcher-shape");
      if (ann.uuid) el.setAttribute("data-uuid", ann.uuid);
      // Mirror `_finalizeShape`'s Fresco-tap-suppress opt-in so
      // hydrated annotations behave identically to freshly-drawn
      // ones — see the comment in `_finalizeShape`.
      el.setAttribute("data-fresco-suppress-tap", "");
      this.svg.appendChild(el);

      var shape = {
        uuid: ann.uuid,
        kind: ann.kind,
        geometry: ann.geometry,
        metadata: ann.metadata || null,
        label: ann.label || null,
        style: ann.style || null,
        el: el
      };
      // Strip mode: keep `image_idx` on the shape so future emits round-
      // trip cleanly and so `_shapeAt` can filter hit-tests by page.
      if (this.handleKind === "strip" && typeof ann.image_idx === "number") {
        shape.image_idx = ann.image_idx;
        el.setAttribute("data-image-idx", String(shape.image_idx));
      }
      // Canvas multi-image: hydrate `image_id` so the visibility
      // toggle path knows which image owns this shape. Falls through
      // for canvas annotations that don't carry one (single-image
      // canvases, or shapes that landed in empty canvas space).
      if (this.handleKind === "canvas" && typeof ann.image_id === "string") {
        shape.image_id = ann.image_id;
        el.setAttribute("data-image-id", shape.image_id);
      }
      // Backfill `image_id` for pre-0.4.7 shapes on a multi-image
      // canvas. Without this, annotations persisted before this
      // version stay untagged after hydration and the visibility
      // filter can't hide them when their host page is `display:
      // none` — they ghost into adjacent viewport bands. The
      // `_resolveCanvasImageId` lookup is gated on
      // `getImages().length > 1`, so single-image consumers and
      // shapes that already carry an id skip this branch.
      // `_backfilledImageId` accumulates the work; `_renderInitial`
      // emits one `etcher:annotations-changed` after the full pass
      // so the consumer persists the new ids once, not N times.
      if (this.handleKind === "canvas" && !shape.image_id) {
        var resolvedImageId = this._resolveCanvasImageId(shape.kind, shape.geometry);
        if (resolvedImageId) {
          shape.image_id = resolvedImageId;
          el.setAttribute("data-image-id", resolvedImageId);
          this._backfilledImageId = true;
        }
      }
      this.shapes.push(shape);
      this._renderShape(shape);
      // Apply persisted color (if any) — the `style` field carries
      // `%{color: "#fca5a5"}` for shapes that were drawn with a swatch
      // selected. Shapes without a style fall back to the CSS default.
      if (shape.style && shape.style.color) {
        this._applyShapeColor(el, shape.style.color);
      }
      this._attachShapeInteractions(shape);
    },

    _selectShape: function(uuid) {
      this.svg.querySelectorAll(".etcher-shape.is-selected").forEach(function(s) {
        s.classList.remove("is-selected");
      });
      var hit = this.svg.querySelector('.etcher-shape[data-uuid="' + uuid + '"]');
      if (hit) hit.classList.add("is-selected");
    },

    // -------------------------------------------------------------------------
    // Edit mode — click a shape to show vertex handles; drag a handle to
    // reshape; release to commit. Only one shape edits at a time.
    // -------------------------------------------------------------------------

    _enterEditMode: function(shape) {
      // Only persisted shapes are editable — temp shapes haven't been
      // ack'd by the server yet so an `etcher:updated` event for them
      // would point at a non-existent uuid.
      if (!shape || !shape.uuid) return;
      if (this.editingShape === shape) return;
      this._exitEditMode();
      this._exitTitleEditMode();

      this.editingShape = shape;
      shape.el.classList.add("is-editing");
      this._hideTooltip();
      // Fitted freehand curves get the dedicated pen editor (anchors +
      // bezier handles); every other kind — and legacy {points} freehand —
      // uses the generic vertex handles.
      if (shape.kind === "freehand" && shape.geometry && shape.geometry.nodes) {
        this._renderFreehandEditor(shape);
      } else {
        this._renderHandles(shape);
      }

      // Polygons + rectangles use midpoint handles that follow the
      // cursor's nearest edge. The wrapper has pointer-events: none
      // in cursor mode, so pointermove there doesn't fire when the
      // user is outside the shape's filled body — listen on document
      // instead so the highlight tracks the cursor everywhere.
      if (shape.kind === "polygon" || shape.kind === "rectangle") {
        this._wireMidpointTracker();
      }

      // Dismiss on any click outside the shape, its handles, the
      // tooltip, or the toolbar. Capture phase so we run before stop-
      // propagation handlers on inner elements. Shapes are
      // `pointer-events: none`, so a click on a shape lands on OSD's
      // canvas at the DOM level — fall back to an image-px hit-test
      // against the currently-edited shape (and the shape we'd
      // re-enter edit mode on next) so the user can click a NEW
      // shape without the handler tearing down edit mode in between.
      var self = this;
      this._outsideClickHandler = function(e) {
        // Click on a shape keeps edit mode alive (the user might be
        // switching focus to a sibling). Click inside Etcher's own
        // chrome or any registered input-owner (modals, dialogs)
        // also keeps edit mode alive — the gesture belongs to that UI.
        if (e.target.closest(".etcher-shape")) return;
        // A click on any edit handle (vertex, bezier control, anchor) is
        // part of editing — never let it tear down edit mode. Bezier
        // handles in particular sit out in empty space off the curve.
        if (e.target.closest(".etcher-handle")) return;
        if (isInputOwner(e.target, self.overlayWrapper)) return;
        try {
          var pt = self._toImage(e);
          if (self._shapeAt(pt)) return;
        } catch (_) {}
        self._exitEditMode();
      };
      document.addEventListener("click", this._outsideClickHandler, true);
    },

    _exitEditMode: function() {
      if (!this.editingShape) return;
      this.editingShape.el.classList.remove("is-editing");
      this._clearVertexSelection();
      this._removeHandles();
      this._removeFreehandEditor();
      this._unwireMidpointTracker();
      this.editingShape = null;
      if (this._outsideClickHandler) {
        document.removeEventListener("click", this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }
    },

    // Mark polygon vertices as the Backspace / Delete target. Plain
    // click resets the selection to just `idx`; shift-click toggles
    // `idx` in/out of the existing set so the user can pick multiple
    // points to delete in one keystroke. Stored as a Set of indices
    // against the live `editingShape` so subsequent re-renders can
    // re-apply `.is-selected` to the same dots.
    _selectVertex: function(shape, idx, additive) {
      if (!shape || shape.kind !== "polygon") return;
      if (this.editingShape !== shape) return;
      if (!this.selectedVertexIndices) this.selectedVertexIndices = new Set();
      if (additive) {
        if (this.selectedVertexIndices.has(idx)) {
          this.selectedVertexIndices.delete(idx);
        } else {
          this.selectedVertexIndices.add(idx);
        }
      } else {
        this.selectedVertexIndices.clear();
        this.selectedVertexIndices.add(idx);
      }
      this._refreshVertexSelectionClass();
    },

    _clearVertexSelection: function() {
      if (!this.selectedVertexIndices || this.selectedVertexIndices.size === 0) {
        return;
      }
      this.selectedVertexIndices.clear();
      this._refreshVertexSelectionClass();
    },

    _refreshVertexSelectionClass: function() {
      var handles = this.handles || [];
      var sel = this.selectedVertexIndices;
      for (var i = 0; i < handles.length; i++) {
        handles[i].classList.toggle(
          "is-selected",
          !!(sel && sel.has(i))
        );
      }
    },

    // Splice the currently-selected vertices out of the editing polygon.
    // Refuses to drop below 3 points (a polygon needs at least 3
    // vertices to still be a polygon; the regular shape-delete
    // keystroke covers full-shape removal). Splices from the highest
    // index down so earlier indices stay valid mid-loop. Single undo
    // entry for the whole batch.
    _deleteSelectedVertex: function() {
      var shape = this.editingShape;
      var sel = this.selectedVertexIndices;
      if (!shape || shape.kind !== "polygon" || !sel || sel.size === 0) {
        return false;
      }
      var pts = (shape.geometry && shape.geometry.points) || [];
      if (pts.length - sel.size < 3) return false;
      var historyBefore = this._snapshotShape(shape);
      var idxList = Array.from(sel).sort(function(a, b) { return b - a; });
      var nextPts = pts.slice();
      for (var i = 0; i < idxList.length; i++) {
        nextPts.splice(idxList[i], 1);
      }
      shape.geometry = { points: nextPts };
      this.selectedVertexIndices.clear();
      this._renderShape(shape);
      this._renderHandles(shape);
      if (shape.uuid) {
        this._emitChanged();
        this._pushUndo(shape.uuid, historyBefore, this._snapshotShape(shape));
      }
      return true;
    },

    _wireMidpointTracker: function() {
      var self = this;
      if (self._midpointTracker) return;
      self._midpointTracker = function(e) {
        if (!self.editingShape) return;
        var k = self.editingShape.kind;
        if (k !== "polygon" && k !== "rectangle") return;
        if (!self.midpointHandles || !self.midpointHandles.length) return;
        try { self._updateClosestMidpoint(self._toImage(e)); } catch (_) {}
      };
      document.addEventListener("pointermove", self._midpointTracker);
    },

    _unwireMidpointTracker: function() {
      if (this._midpointTracker) {
        document.removeEventListener("pointermove", this._midpointTracker);
        this._midpointTracker = null;
      }
      this._clearClosestMidpoint();
    },

    _renderHandles: function(shape, opts) {
      opts = opts || { interactive: true };
      this._removeHandles();
      var self = this;
      // Strip mode: handles must land in the same per-image overlay as
      // the shape they decorate. `self.svg` may still be pointing at
      // a different page from the last interaction.
      this._activateOverlayForShape(shape);
      var positions = this._handlePositions(shape);
      var handleColor = self._handleColor(shape);

      this.handles = positions.map(function(pt, idx) {
        var h = svgEl("circle", { r: 5 });
        h.classList.add("etcher-handle");
        h.style.color = handleColor;
        h.dataset.index = idx;
        self.svg.appendChild(h);
        self._positionHandle(h, pt);
        if (opts.interactive) {
          h.addEventListener("pointerdown", function(e) {
            self._startHandleDrag(shape, idx, h, e);
          });
        }
        return h;
      });

      // Per-kind edge midpoint helpers — rendered as a single shared
      // set of "midpoint" handles that follow the same closest-only
      // highlight behavior driven by `_updateClosestMidpoint`.
      // Polygons get insert-new-vertex semantics; rectangles get
      // resize-one-edge semantics. Drafts skip both (the shape is
      // still being built).
      if (opts.interactive) {
        if (shape.kind === "polygon") {
          self._renderMidpointHandles(shape);
        } else if (shape.kind === "rectangle") {
          self._renderRectEdgeHandles(shape);
        }
      }
    },

    // Render a ghost handle on each edge midpoint of a polygon. The
    // dots are invisible until hovered (the user sees their shape's
    // color "appear" along the edge), and pointer-events: all keeps
    // them hit-targetable even while invisible. Drag one → it becomes
    // a real vertex via `_startMidpointDrag`.
    _renderMidpointHandles: function(shape) {
      this._removeMidpointHandles();
      if (!shape || shape.kind !== "polygon") return;
      var pts = (shape.geometry && shape.geometry.points) || [];
      if (pts.length < 2) return;
      var self = this;
      var handleColor = self._handleColor(shape);
      this.midpointHandles = [];
      for (var i = 0; i < pts.length; i++) {
        var next = pts[(i + 1) % pts.length];
        var midImage = {
          x: (pts[i][0] + next[0]) / 2,
          y: (pts[i][1] + next[1]) / 2
        };
        var h = svgEl("circle", { r: 6 });
        h.classList.add("etcher-handle", "etcher-handle-midpoint");
        h.style.color = handleColor;
        h.dataset.edgeIndex = i;
        self.svg.appendChild(h);
        self._positionHandle(h, midImage);
        (function(edgeIdx, handleEl) {
          handleEl.addEventListener("pointerdown", function(e) {
            self._startMidpointDrag(shape, edgeIdx, handleEl, e);
          });
        })(i, h);
        this.midpointHandles.push(h);
      }
    },

    _removeMidpointHandles: function() {
      (this.midpointHandles || []).forEach(function(h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      this.midpointHandles = [];
    },

    // Edge-midpoint handles for a rectangle in edit mode: one dot at
    // the center of each of the four sides. Grabbing one slides that
    // edge — the two corners on that side travel with the drag while
    // the opposite edge stays anchored. Reuses the same shared
    // `midpointHandles` array so the closest-to-cursor highlight,
    // pan/zoom positioning, and `_updateClosestMidpoint` machinery
    // work without per-kind branching at the call sites.
    _renderRectEdgeHandles: function(shape) {
      this._removeMidpointHandles();
      if (!shape || shape.kind !== "rectangle") return;
      var g = shape.geometry;
      var positions = this._rectEdgeMidpoints(g);
      var self = this;
      var handleColor = self._handleColor(shape);
      this.midpointHandles = positions.map(function(pt, idx) {
        var horizontal = idx === 0 || idx === 2;
        var w = horizontal ? 18 : 6;
        var hgt = horizontal ? 6 : 18;
        var rect = svgEl("rect", { width: w, height: hgt, rx: 1.5, ry: 1.5 });
        rect.classList.add(
          "etcher-handle",
          "etcher-handle-edge",
          horizontal ? "etcher-handle-edge--h" : "etcher-handle-edge--v"
        );
        rect.style.color = handleColor;
        rect.dataset.edgeIndex = idx;
        self.svg.appendChild(rect);
        self._positionHandle(rect, pt);
        (function(edgeIdx, handleEl) {
          handleEl.addEventListener("pointerdown", function(e) {
            self._startRectEdgeDrag(shape, edgeIdx, handleEl, e);
          });
        })(idx, rect);
        return rect;
      });
    },

    // Image-px midpoints of a rect's 4 sides. Order: top, right,
    // bottom, left. Used both at handle-creation time and by the
    // closest-midpoint highlight + pan/zoom reposition.
    _rectEdgeMidpoints: function(g) {
      return [
        { x: g.x + g.w / 2, y: g.y           }, // 0: top
        { x: g.x + g.w,     y: g.y + g.h / 2 }, // 1: right
        { x: g.x + g.w / 2, y: g.y + g.h     }, // 2: bottom
        { x: g.x,           y: g.y + g.h / 2 }  // 3: left
      ];
    },

    // Drag a single rect edge. The opposite edge stays put; the two
    // corners on the grabbed edge slide along the perpendicular
    // axis. Normalizes negatives so a user dragging an edge past
    // its opposite still produces a sane rectangle.
    _startRectEdgeDrag: function(shape, edgeIdx, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      this._hideTooltip();

      var self = this;
      var historyBefore = self._snapshotShape(shape);
      var g0 = JSON.parse(JSON.stringify(shape.geometry));
      var startTitleBox =
        shape.metadata && shape.metadata.title_box
          ? Object.assign({}, shape.metadata.title_box)
          : null;

      function onMove(ev) {
        var pt = self._toImage(ev);
        var nx = g0.x, ny = g0.y, nw = g0.w, nh = g0.h;
        switch (edgeIdx) {
          case 0: ny = pt.y;        nh = (g0.y + g0.h) - pt.y; break; // top
          case 1: nw = pt.x - g0.x; break;                             // right
          case 2: nh = pt.y - g0.y; break;                             // bottom
          case 3: nx = pt.x;        nw = (g0.x + g0.w) - pt.x; break; // left
        }
        if (nw < 0) { nx += nw; nw = -nw; }
        if (nh < 0) { ny += nh; nh = -nh; }
        shape.geometry = { x: nx, y: ny, w: nw, h: nh };
        self._renderShape(shape);
        self._positionAllHandles(shape);
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
        self._showTooltipFor(shape);
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Mark the midpoint closest to the cursor as `.is-active` so its
    // CSS rule reveals it. Threshold gates the highlight: if the
    // cursor is far away from every midpoint the polygon's edges
    // stay clean. Hidden during a drag — the dragging handle already
    // has `.is-dragging` and tracks the pointer directly.
    _updateClosestMidpoint: function(pt) {
      if (!this.midpointHandles || !this.midpointHandles.length) return;
      var positions = this._midpointPositionsForShape(this.editingShape);
      if (!positions || !positions.length) return;
      var closestIdx = -1;
      var closestDist = Infinity;
      for (var i = 0; i < positions.length; i++) {
        var dx = pt.x - positions[i].x;
        var dy = pt.y - positions[i].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < closestDist) { closestDist = d2; closestIdx = i; }
      }
      var threshold = this._midpointActivationRadiusImagePx();
      if (closestDist > threshold * threshold) closestIdx = -1;

      this.midpointHandles.forEach(function(h, i) {
        h.classList.toggle("is-active", i === closestIdx);
      });
    },

    // Image-px positions of every midpoint a shape currently
    // exposes. Polygons → edge midpoints (one per edge). Rectangles
    // → four edge midpoints (top/right/bottom/left). Other kinds
    // return [].
    _midpointPositionsForShape: function(shape) {
      if (!shape) return [];
      if (shape.kind === "polygon") {
        var pts = (shape.geometry && shape.geometry.points) || [];
        var out = [];
        for (var i = 0; i < pts.length; i++) {
          var next = pts[(i + 1) % pts.length];
          out.push({ x: (pts[i][0] + next[0]) / 2, y: (pts[i][1] + next[1]) / 2 });
        }
        return out;
      }
      if (shape.kind === "rectangle") {
        return this._rectEdgeMidpoints(shape.geometry);
      }
      return [];
    },

    // Convert a generous container-px radius (~80px on screen) into
    // image px so the activation zone feels the same regardless of
    // zoom. Generous because the user only needs to be "near" an
    // edge, not directly on it.
    _midpointActivationRadiusImagePx: function() {
      try {
        var a = this._imageToContainer({ x: 0, y: 0 });
        var b = this._imageToContainer({ x: 0, y: 1 });
        var perImagePx = Math.abs(b.y - a.y) || 1;
        return 80 / perImagePx;
      } catch (e) {
        return 80;
      }
    },

    _clearClosestMidpoint: function() {
      (this.midpointHandles || []).forEach(function(h) {
        h.classList.remove("is-active");
      });
    },

    _positionAllMidpointHandles: function(shape) {
      if (!this.midpointHandles || !this.midpointHandles.length) return;
      var positions = this._midpointPositionsForShape(shape);
      var self = this;
      this.midpointHandles.forEach(function(h, i) {
        if (positions[i]) self._positionHandle(h, positions[i]);
      });
    },

    // Insert a new vertex at the midpoint of the polygon edge under
    // the ghost handle, then run a vertex-style drag so the user can
    // immediately place it. Pre-insert state goes onto the undo
    // stack so ⌘Z removes the inserted vertex entirely.
    _startMidpointDrag: function(shape, edgeIdx, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      this._hideTooltip();

      var self = this;
      // Inserting a new vertex shifts every index >= newIdx by one;
      // drop any prior vertex selection to avoid the highlight
      // landing on the wrong dot after the splice.
      self._clearVertexSelection();
      var historyBefore = self._snapshotShape(shape);

      var pts = shape.geometry.points.slice();
      var a = pts[edgeIdx];
      var b = pts[(edgeIdx + 1) % pts.length];
      var newIdx = edgeIdx + 1;
      pts.splice(newIdx, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      shape.geometry = { points: pts };
      self._renderShape(shape);
      // Reposition existing vertex handles to account for the new
      // index shift; midpoint handles stay where they are until the
      // gesture ends, when we re-render the full set.
      self._positionAllHandles(shape);

      function onMove(ev) {
        var pt = self._toImage(ev);
        var newPts = shape.geometry.points.slice();
        newPts[newIdx] = [pt.x, pt.y];
        shape.geometry = { points: newPts };
        self._renderShape(shape);
        self._positionAllHandles(shape);
        // Position the dragging dot itself (it's the same DOM element
        // the user grabbed, just tracking the new vertex now).
        self._positionHandle(handleEl, { x: pt.x, y: pt.y });
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
        // Refresh the full handle set so the new vertex picks up a
        // real vertex dot and the two new edges get their own
        // midpoint ghosts.
        if (self.editingShape === shape) self._renderHandles(shape);
        self._showTooltipFor(shape);
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Resolve the color that vector handles should paint themselves
    // with for `shape`. Picks the explicitly-styled color first,
    // falls back to the in-progress active swatch (for drafts) and
    // finally to the same default blue the shape stroke uses, so a
    // shape that's never had a custom color picked still has matching
    // handles instead of an unrelated orange.
    _handleColor: function(shape) {
      if (shape && shape.style && shape.style.color) return shape.style.color;
      if (this.activeColor) return this.activeColor;
      return "#3b82f6";
    },

    // Returns the currently-in-progress draft shape as a shape-like
    // object suitable for `_handlePositions` — unifying the rectangle/
    // circle/freehand draftState and the polygon draftPolygon code
    // paths so renderers can treat them the same way.
    _draftActive: function() {
      if (this.draftState) return this.draftState;
      if (this.draftPolygon) {
        return {
          kind: "polygon",
          geometry: { points: this.draftPolygon.points },
          el: this.draftPolygon.el
        };
      }
      if (this.draftCallout) return this.draftCallout;
      return null;
    },

    _syncDraftHandles: function() {
      var d = this._draftActive();
      if (!d) {
        if (!this.editingShape) this._removeHandles();
        return;
      }
      // Recreate (rather than reposition) because polygon clicks grow
      // the vertex count between calls. Cheap enough — drafts cap at a
      // few dozen vertices and `_renderAll`'s per-frame path uses
      // `_positionAllHandles` instead.
      this._renderHandles(d, { interactive: false });
    },

    _positionAllHandles: function(shape) {
      if (this.handles && this.handles.length) {
        var positions = this._handlePositions(shape);
        var self = this;
        this.handles.forEach(function(h, idx) {
          if (positions[idx]) self._positionHandle(h, positions[idx]);
        });
      }
      // Midpoints aren't part of `_handlePositions` (they aren't
      // editable vertices), so keep them in sync on pan/zoom via
      // a dedicated path.
      this._positionAllMidpointHandles(shape);
      // Freehand pen-editor anchors/handles live outside the generic
      // `handles` array — reposition them on the same pan/zoom tick.
      if (this.freehandEditor) this._positionFreehandEditor();
    },

    _positionHandle: function(h, imagePt) {
      var c = this._imageToContainer(imagePt);
      // Circles use cx/cy; rect-shaped edge handles position by their
      // top-left so we offset by half their dimensions to keep them
      // centered on the supplied image point.
      if (h.tagName && h.tagName.toLowerCase() === "rect") {
        var w = parseFloat(h.getAttribute("width")) || 0;
        var hgt = parseFloat(h.getAttribute("height")) || 0;
        h.setAttribute("x", c.x - w / 2);
        h.setAttribute("y", c.y - hgt / 2);
      } else {
        h.setAttribute("cx", c.x);
        h.setAttribute("cy", c.y);
      }
    },

    _removeHandles: function() {
      (this.handles || []).forEach(function(h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      this.handles = [];
      this._removeMidpointHandles();
    },

    // -----------------------------------------------------------------------
    // Freehand node editor — the pen-tool surface for a fitted vector curve.
    // Each node gets a draggable anchor plus (where present) its two bezier
    // control handles, drawn as small dots tethered to the anchor by a thin
    // line. Dragging an anchor slides the node and carries its handles along
    // (they're stored as offsets); dragging a control handle reshapes the
    // curve, mirroring the opposite handle when the node is "smooth".
    // Double-click an anchor toggles smooth/corner. Lives parallel to the
    // generic `handles` array because a bezier node has more than one
    // editable point, so the flat index-by-position model doesn't fit.
    // -----------------------------------------------------------------------

    _vLen: function(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1]); },

    _renderFreehandEditor: function(shape) {
      this._removeFreehandEditor();
      if (!shape || shape.kind !== "freehand" ||
          !shape.geometry || !shape.geometry.nodes) {
        return;
      }
      var self = this;
      this._activateOverlayForShape(shape);
      var nodes = shape.geometry.nodes;
      var color = this._handleColor(shape);
      var ed = { shape: shape, controls: [], lines: [] };

      nodes.forEach(function(node, i) {
        // Control handles (drawn first so the anchor dot sits on top).
        ["in", "out"].forEach(function(side) {
          if (!(side === "in" ? node.hIn : node.hOut)) return;
          var line = svgEl("line", {});
          line.classList.add("etcher-handle-line");
          line.style.color = color;
          self.svg.appendChild(line);
          ed.lines.push({ el: line, nodeIdx: i, side: side });

          var dot = svgEl("circle", { r: 4 });
          dot.classList.add("etcher-handle", "etcher-bezier-handle");
          dot.style.color = color;
          self.svg.appendChild(dot);
          ed.controls.push({ el: dot, type: side, nodeIdx: i });
          dot.addEventListener("pointerdown", function(e) {
            self._startBezierHandleDrag(shape, i, side, dot, e);
          });
        });

        var anchor = svgEl("circle", { r: 5 });
        anchor.classList.add("etcher-handle", "etcher-anchor-handle");
        if (node.type === "corner") anchor.classList.add("is-corner");
        anchor.style.color = color;
        self.svg.appendChild(anchor);
        ed.controls.push({ el: anchor, type: "anchor", nodeIdx: i });
        anchor.addEventListener("pointerdown", function(e) {
          self._startAnchorDrag(shape, i, anchor, e);
        });
        anchor.addEventListener("dblclick", function(e) {
          e.preventDefault();
          e.stopPropagation();
          self._toggleNodeType(shape, i);
        });
      });

      this.freehandEditor = ed;
      this._positionFreehandEditor();
    },

    _positionFreehandEditor: function() {
      var ed = this.freehandEditor;
      if (!ed) return;
      var self = this;
      var nodes = (ed.shape.geometry && ed.shape.geometry.nodes) || [];
      ed.lines.forEach(function(l) {
        var node = nodes[l.nodeIdx];
        var h = node && (l.side === "in" ? node.hIn : node.hOut);
        if (!h) { l.el.style.display = "none"; return; }
        l.el.style.display = "";
        var a = self._imageToContainer({ x: node.p[0], y: node.p[1] });
        var b = self._imageToContainer({ x: node.p[0] + h[0], y: node.p[1] + h[1] });
        l.el.setAttribute("x1", a.x); l.el.setAttribute("y1", a.y);
        l.el.setAttribute("x2", b.x); l.el.setAttribute("y2", b.y);
      });
      ed.controls.forEach(function(c) {
        var node = nodes[c.nodeIdx];
        if (!node) return;
        var h = c.type === "in" ? node.hIn : c.type === "out" ? node.hOut : null;
        if (c.type !== "anchor" && !h) { c.el.style.display = "none"; return; }
        c.el.style.display = "";
        var pt = c.type === "anchor"
          ? { x: node.p[0], y: node.p[1] }
          : { x: node.p[0] + h[0], y: node.p[1] + h[1] };
        self._positionHandle(c.el, pt);
      });
    },

    _removeFreehandEditor: function() {
      var ed = this.freehandEditor;
      if (!ed) return;
      ed.controls.forEach(function(c) { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
      ed.lines.forEach(function(l) { if (l.el.parentNode) l.el.parentNode.removeChild(l.el); });
      this.freehandEditor = null;
    },

    // Drag an anchor: translate the node by the pointer delta. Its handles
    // ride along automatically because they're stored relative to the anchor.
    _startAnchorDrag: function(shape, idx, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      this._hideTooltip();
      var self = this;
      var historyBefore = self._snapshotShape(shape);
      var startP = shape.geometry.nodes[idx].p.slice();
      var startPt = self._toImage(e);
      var dragged = false;
      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          var aC = self._imageToContainer(startPt), bC = self._imageToContainer(pt);
          if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
          dragged = true;
        }
        shape.geometry.nodes[idx].p = [
          startP[0] + (pt.x - startPt.x),
          startP[1] + (pt.y - startPt.y)
        ];
        self._renderShape(shape);
        self._positionFreehandEditor();
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (dragged && shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Drag a bezier control handle: set this side's offset to the cursor. If
    // the node is "smooth" and the opposite handle exists, swing it to stay
    // colinear while keeping its own length — the classic smooth-node feel.
    _startBezierHandleDrag: function(shape, idx, side, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      this._hideTooltip();
      var self = this;
      var historyBefore = self._snapshotShape(shape);
      var node = shape.geometry.nodes[idx];
      var thisSide = side === "in" ? "hIn" : "hOut";
      var oppSide = side === "in" ? "hOut" : "hIn";
      var startPt = self._toImage(e);
      var dragged = false;
      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          var aC = self._imageToContainer(startPt), bC = self._imageToContainer(pt);
          if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
          dragged = true;
        }
        var v = [pt.x - node.p[0], pt.y - node.p[1]];
        node[thisSide] = v;
        if (node.type === "smooth" && node[oppSide]) {
          var oppLen = self._vLen(node[oppSide]);
          var vLen = self._vLen(v) || 1;
          node[oppSide] = [-v[0] / vLen * oppLen, -v[1] / vLen * oppLen];
        }
        self._renderShape(shape);
        self._positionFreehandEditor();
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (dragged && shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Flip a node between smooth and corner. Going smooth re-colinearizes the
    // two existing handles around their averaged direction so the curve snaps
    // tangent-continuous; going corner just frees them to move independently.
    _toggleNodeType: function(shape, idx) {
      var node = shape.geometry.nodes[idx];
      if (!node) return;
      var historyBefore = this._snapshotShape(shape);
      if (node.type === "smooth") {
        node.type = "corner";
      } else {
        node.type = "smooth";
        if (node.hIn && node.hOut) {
          var inLen = this._vLen(node.hIn) || 1;
          var outLen = this._vLen(node.hOut) || 1;
          // Average the outgoing direction with the reversed incoming one.
          var ax = -node.hIn[0] / inLen + node.hOut[0] / outLen;
          var ay = -node.hIn[1] / inLen + node.hOut[1] / outLen;
          var aLen = Math.sqrt(ax * ax + ay * ay) || 1;
          ax /= aLen; ay /= aLen;
          node.hOut = [ax * outLen, ay * outLen];
          node.hIn = [-ax * inLen, -ay * inLen];
        }
      }
      this._renderShape(shape);
      this._renderFreehandEditor(shape);
      if (shape.uuid) {
        this._emitChanged();
        this._pushUndo(shape.uuid, historyBefore, this._snapshotShape(shape));
      }
    },

    // Returns image-px positions for each handle, in an order each kind's
    // drag handler can reference by index.
    _handlePositions: function(shape) {
      var g = shape.geometry;
      switch (shape.kind) {
        case "rectangle":
          return [
            { x: g.x,         y: g.y },          // 0: top-left
            { x: g.x + g.w,   y: g.y },          // 1: top-right
            { x: g.x + g.w,   y: g.y + g.h },    // 2: bottom-right
            { x: g.x,         y: g.y + g.h }     // 3: bottom-left
          ];
        case "text": {
          // Handles ride the shrunk-to-text bbox so users grab where
          // they see the box, not the (often wider) storage envelope.
          var tBox = shape._renderedBox || g;
          return [
            { x: tBox.x,           y: tBox.y           },
            { x: tBox.x + tBox.w,  y: tBox.y           },
            { x: tBox.x + tBox.w,  y: tBox.y + tBox.h  },
            { x: tBox.x,           y: tBox.y + tBox.h  }
          ];
        }
        case "circle":
          return [{ x: g.cx + g.r, y: g.cy }];   // 0: east, controls radius
        case "polygon":
          return (g.points || []).map(function(p) { return { x: p[0], y: p[1] }; });
        case "callout": {
          // Use the shrunk-to-text rendered bbox when available so the
          // 4 text-corner handles snap to what's drawn, not the wider
          // storage envelope.
          var cbox = shape._renderedBox || this._calloutTextBoxImage(g);
          return [
            { x: g.anchor[0],            y: g.anchor[1]            },  // 0: anchor
            { x: cbox.x,                 y: cbox.y                 },  // 1: text TL
            { x: cbox.x + cbox.w,        y: cbox.y                 },  // 2: text TR
            { x: cbox.x + cbox.w,        y: cbox.y + cbox.h        },  // 3: text BR
            { x: cbox.x,                 y: cbox.y + cbox.h        }   // 4: text BL
          ];
        }
        case "dimension":
        case "line":
          return [
            { x: g.a[0], y: g.a[1] },  // 0: endpoint A
            { x: g.b[0], y: g.b[1] }   // 1: endpoint B
          ];
        // Freehand (node format) is edited via the dedicated pen editor
        // (`_renderFreehandEditor`), not this flat vertex-handle list.
        // Legacy {points} freehand falls through here → delete and redraw.
        default:
          return [];
      }
    },

    _startHandleDrag: function(shape, idx, handleEl, e) {
      e.preventDefault();
      e.stopPropagation();
      try { handleEl.setPointerCapture(e.pointerId); } catch (_) {}
      handleEl.classList.add("is-dragging");
      // Drag starts under the cursor — the tooltip is now anchored to a
      // stale shape position, so hide it for the duration and bring it
      // back on release.
      this._hideTooltip();

      var shiftHeld = !!e.shiftKey;
      var self = this;
      // Full snapshot of the shape's pre-drag state for the undo stack
      // — captured before any mutation so the inverse op can restore
      // exactly what was on screen.
      var historyBefore = self._snapshotShape(shape);
      // Snapshot the starting geometry so corner drags derive from the
      // *original* opposite corner, not the live one that's moving.
      // Text shapes + callouts snap their handles to the shrunk-to-
      // text bbox (`_renderedBox`); the drag math has to start from
      // there too or the cursor and the bbox edge will diverge.
      // Callouts use FULL geometry (not _renderedBox) for drag math
      // so the corner-resize delta accumulates against the user-set
      // text_box rather than the shrunk visual. Without this, every
      // drag bakes the shrink-fit offset back into geometry and the
      // callout visibly shrinks on each interaction. _applyHandleDrag
      // gets startPt for callout text-corner drags and uses the
      // pointer DELTA against startGeom; visual continues to
      // shrink-fit independently. Text shapes still snap geometry to
      // the rendered box on release (existing 0.2.x behavior).
      var startGeom;
      if (shape.kind === "text" && shape._renderedBox) {
        startGeom = JSON.parse(JSON.stringify(shape._renderedBox));
      } else {
        startGeom = JSON.parse(JSON.stringify(shape.geometry));
      }
      var startPt = self._toImage(e);
      var dragged = false;

      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          // 3px screen-space dead zone — distinguishes "drag to
          // resize" from "I'm just clicking on a handle". Without
          // this, a bare click on a text-shape or callout handle
          // falls through to onUp and snaps geometry to the shrunk
          // `_renderedBox`, then round-trips through the LiveView.
          // Each click trims a little off the box, so the callout /
          // text shape visibly shrinks every time the user touches
          // a handle. Same gating the body-drag and title-drag
          // handlers already use.
          var aC = self._imageToContainer(startPt);
          var bC = self._imageToContainer(pt);
          if ((bC.x - aC.x) * (bC.x - aC.x) + (bC.y - aC.y) * (bC.y - aC.y) < 9) return;
          dragged = true;
        }
        self._applyHandleDrag(shape, idx, pt, startGeom, startPt);
        self._renderShape(shape);
        self._positionAllHandles(shape);
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (!dragged) {
          // Pure click on a vertex — select it so Backspace / Delete
          // can remove just that point instead of the whole shape.
          // Polygon-only for now (rectangles can't lose corners,
          // circle has no vertices, freehand has too many).
          // Shift-click toggles the vertex in the selection set so the
          // user can pick multiple points to delete in one keystroke.
          if (shape.kind === "polygon") {
            self._selectVertex(shape, idx, shiftHeld);
          }
          self._showTooltipFor(shape);
          return;
        }
        // Drag committed — any prior vertex selection is stale.
        self._clearVertexSelection();
        // Text shapes still persist the shrunk-to-text bbox so the
        // stored geometry matches what's drawn — they don't have
        // the callout's drag-math complexity (no anchor, geometry
        // IS the box). Callouts intentionally skip this snap: the
        // delta-based drag math in _applyHandleDrag already keeps
        // the user-set text_box intact, and snapping to _renderedBox
        // would re-introduce the shrink cascade across drags.
        if (shape.kind === "text" && shape._renderedBox) {
          shape.geometry = {
            x: shape._renderedBox.x,
            y: shape._renderedBox.y,
            w: shape._renderedBox.w,
            h: shape._renderedBox.h
          };
        }
        if (shape.uuid) {
          self._emitChanged();
          self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
        }
        self._showTooltipFor(shape);
      }
      handleEl.addEventListener("pointermove", onMove);
      handleEl.addEventListener("pointerup", onUp);
      handleEl.addEventListener("pointercancel", onUp);
    },

    // Translate the whole shape via a body grab. Mirrors the handle-drag
    // flow but applies a uniform offset to every geometry field. Uses a
    // small dead-zone so a stationary click on the shape body doesn't
    // emit a no-op `etcher:updated` event.
    _startShapeMove: function(shape, e) {
      var self = this;
      var el = shape.el;
      // Strip mode: make sure handle / drag-preview elements created
      // during the move land in the same per-image overlay as the
      // shape being dragged.
      self._activateOverlayForShape(shape);
      var startPt = self._toImage(e);
      var startGeom = JSON.parse(JSON.stringify(shape.geometry));
      // Full pre-move snapshot for the undo stack.
      var historyBefore = self._snapshotShape(shape);

      // Select on grab — `_onShapeTap` enters edit mode (annotation
      // cursor mode) or pins the tooltip (browse mode), idempotent if
      // we're already in edit mode for this shape. This used to fire
      // only from onUp's no-drag fallback, which meant dragging never
      // visually selected the shape until release. Calling here makes
      // the handles appear the instant the user grabs, so drag feels
      // like "select and move" rather than "move then select."
      self._onShapeTap(shape);
      // If the shape carries a title bbox, snapshot it too so we can
      // translate the title alongside the shape on body-grab.
      var startTitleBox =
        shape.metadata && shape.metadata.title_box
          ? Object.assign({}, shape.metadata.title_box)
          : null;
      var dragged = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}

      function onMove(ev) {
        var pt = self._toImage(ev);
        if (!dragged) {
          var a = self._imageToContainer(startPt);
          var b = self._imageToContainer(pt);
          var sdx = b.x - a.x, sdy = b.y - a.y;
          // 3px screen-space dead zone — distinguishes "drag to move"
          // from "I'm just hovering" so a stationary click on an
          // already-editing shape doesn't fire a network round-trip.
          if (sdx * sdx + sdy * sdy < 9) return;
          dragged = true;
          el.classList.add("is-moving");
          // The tooltip is anchored to the shape's old position — it
          // would float orphaned while the shape moves underneath.
          // Hide it for the duration; reshow on release.
          self._hideTooltip();
        }
        var dxI = pt.x - startPt.x;
        var dyI = pt.y - startPt.y;
        shape.geometry = self._translateGeometry(shape.kind, startGeom, dxI, dyI);
        if (startTitleBox) {
          shape.metadata = Object.assign({}, shape.metadata || {}, {
            title_box: {
              x: startTitleBox.x + dxI,
              y: startTitleBox.y + dyI,
              w: startTitleBox.w,
              h: startTitleBox.h
            }
          });
        }
        self._renderShape(shape);
        self._positionAllHandles(shape);
        // If the title moved along with the parent, the title-edit
        // handles (when title-edit-mode is active for this shape)
        // need to follow too.
        if (startTitleBox && self.editingTitleShape === shape) {
          self._positionAllTitleHandles(shape);
        }
      }
      function onUp(ev) {
        el.classList.remove("is-moving");
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (dragged) {
          // Sync stored title_box to the shrunk-to-text bbox after
          // the body translation, matching the handle/drag paths and
          // keeping storage aligned with what's drawn.
          if (startTitleBox && shape._renderedTitleImage) {
            shape.metadata = Object.assign({}, shape.metadata || {}, {
              title_box: {
                x: shape._renderedTitleImage.x,
                y: shape._renderedTitleImage.y,
                w: shape._renderedTitleImage.w,
                h: shape._renderedTitleImage.h
              }
            });
          }
          if (shape.uuid) {
            self._emitChanged();
            self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
          }
          // Cursor is still over the shape (we just released it there),
          // so the user expects the tooltip to come back.
          self._showTooltipFor(shape);
        }
        // No-drag case is a no-op here — `_onShapeTap` already fired
        // at the top of _startShapeMove, so the shape is already
        // selected / pinned by the time we hit pointerup.
      }
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    },

    _translateGeometry: function(kind, geom, dx, dy) {
      switch (kind) {
        case "rectangle":
        case "text":
          return { x: geom.x + dx, y: geom.y + dy, w: geom.w, h: geom.h };
        case "circle":
          return { cx: geom.cx + dx, cy: geom.cy + dy, r: geom.r };
        case "polygon":
        case "freehand":
          return {
            points: (geom.points || []).map(function(p) {
              return [p[0] + dx, p[1] + dy];
            })
          };
        case "callout": {
          var cbox = this._calloutTextBoxImage(geom);
          return {
            anchor:   [geom.anchor[0] + dx, geom.anchor[1] + dy],
            text_box: { x: cbox.x + dx, y: cbox.y + dy, w: cbox.w, h: cbox.h }
          };
        }
        case "dimension":
        case "line":
          return {
            a: [geom.a[0] + dx, geom.a[1] + dy],
            b: [geom.b[0] + dx, geom.b[1] + dy]
          };
        default:
          return geom;
      }
    },

    _applyHandleDrag: function(shape, idx, pt, startGeom, startPt) {
      switch (shape.kind) {
        case "rectangle":
        case "text": {
          var g = startGeom;
          var right = g.x + g.w, bottom = g.y + g.h;
          var nx, ny, nw, nh;
          switch (idx) {
            case 0: nx = pt.x;  ny = pt.y;  nw = right - pt.x;  nh = bottom - pt.y; break;
            case 1: nx = g.x;   ny = pt.y;  nw = pt.x - g.x;    nh = bottom - pt.y; break;
            case 2: nx = g.x;   ny = g.y;   nw = pt.x - g.x;    nh = pt.y - g.y;    break;
            case 3: nx = pt.x;  ny = g.y;   nw = right - pt.x;  nh = pt.y - g.y;    break;
            default: return;
          }
          // Normalize when the user drags a corner past its opposite.
          if (nw < 0) { nx += nw; nw = -nw; }
          if (nh < 0) { ny += nh; nh = -nh; }
          shape.geometry = { x: nx, y: ny, w: nw, h: nh };
          break;
        }
        case "circle": {
          var dx = pt.x - startGeom.cx, dy = pt.y - startGeom.cy;
          shape.geometry = {
            cx: startGeom.cx,
            cy: startGeom.cy,
            r: Math.max(1, Math.sqrt(dx * dx + dy * dy))
          };
          break;
        }
        case "polygon": {
          var pts = (startGeom.points || []).map(function(p) { return [p[0], p[1]]; });
          if (pts[idx]) pts[idx] = [pt.x, pt.y];
          shape.geometry = { points: pts };
          break;
        }
        case "dimension":
        case "line": {
          // idx 0 = endpoint A, 1 = endpoint B. Each handle moves
          // its own endpoint to the pointer; the other end stays
          // anchored. No shrink-fit envelope, so absolute pt is
          // safe (no need for the delta math callouts use). Shared
          // between dimension + line — same two-endpoint geometry.
          var dimGeom = startGeom;
          if (idx === 0) {
            shape.geometry = { a: [pt.x, pt.y], b: [dimGeom.b[0], dimGeom.b[1]] };
          } else if (idx === 1) {
            shape.geometry = { a: [dimGeom.a[0], dimGeom.a[1]], b: [pt.x, pt.y] };
          }
          break;
        }
        case "callout": {
          // idx 0 = anchor (what's pointed at); idx 1-4 = text-bbox
          // corners (TL, TR, BR, BL), mirroring rectangle's resize
          // handlers but writing back into `geometry.text_box`.
          //
          // Callout corner drags use DELTA math (pt - startPt against
          // startGeom.text_box) instead of absolute pt against the
          // visual box. The visual rect shrink-wraps to the text
          // (smaller than `geometry.text_box`), so the user is
          // grabbing a handle at the SHRUNK corner. Absolute-pt math
          // would compute new geometry as (visual + delta), shrinking
          // geometry every drag. Delta math against the full
          // geometry preserves the user's drag intent: new geometry
          // = old geometry + delta. Anchor (idx 0) still uses
          // absolute pt — the anchor is rendered at its actual
          // position, no visual/storage offset.
          var startBox = this._calloutTextBoxImage(startGeom);
          if (idx === 0) {
            shape.geometry = {
              anchor: [pt.x, pt.y],
              text_box: { x: startBox.x, y: startBox.y, w: startBox.w, h: startBox.h }
            };
          } else {
            var dxC = startPt ? pt.x - startPt.x : 0;
            var dyC = startPt ? pt.y - startPt.y : 0;
            var nx, ny, nw, nh;
            switch (idx) {
              case 1: nx = startBox.x + dxC; ny = startBox.y + dyC; nw = startBox.w - dxC; nh = startBox.h - dyC; break;
              case 2: nx = startBox.x;       ny = startBox.y + dyC; nw = startBox.w + dxC; nh = startBox.h - dyC; break;
              case 3: nx = startBox.x;       ny = startBox.y;       nw = startBox.w + dxC; nh = startBox.h + dyC; break;
              case 4: nx = startBox.x + dxC; ny = startBox.y;       nw = startBox.w - dxC; nh = startBox.h + dyC; break;
              default: return;
            }
            if (nw < 0) { nx += nw; nw = -nw; }
            if (nh < 0) { ny += nh; nh = -nh; }
            shape.geometry = {
              anchor: startGeom.anchor,
              text_box: { x: nx, y: ny, w: nw, h: nh }
            };
          }
          break;
        }
      }
    },

    _removeShape: function(uuid) {
      var idx = this.shapes.findIndex(function(s) { return s.uuid === uuid; });
      if (idx === -1) return;
      var shape = this.shapes[idx];
      if (this.editingShape === shape) this._exitEditMode();
      if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
      if (shape.titleGroup && shape.titleGroup.parentNode) {
        shape.titleGroup.parentNode.removeChild(shape.titleGroup);
      }
      this.shapes.splice(idx, 1);
      // Removed shape's element can no longer fire mouseleave, so close
      // any tooltip that was anchored to it.
      this._hideTooltip();
    },

    // -------------------------------------------------------------------------
    // Undo / Redo — client-side history stack for in-session mutations
    // (geometry, style, metadata incl. title text + bbox). Creates and
    // deletes are intentionally NOT tracked: rolling them back would
    // require either preserving the server-assigned uuid through a
    // delete+recreate dance or a true server-side restore, both out of
    // scope for v1. The user can still cmd-z their corner drags, color
    // picks, title edits, and label repositions — the 90% case.
    //
    // Stack cap is intentionally short (50) so memory stays bounded
    // even on long editing sessions; older ops drop off the bottom.
    // -------------------------------------------------------------------------

    _undoStackLimit: 50,

    _snapshotShape: function(shape) {
      function clone(v) {
        if (v == null) return v;
        try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
      }
      return {
        geometry: clone(shape.geometry),
        style: clone(shape.style),
        metadata: clone(shape.metadata)
      };
    },

    // Push a state-snapshot pair onto the undo stack. Called by each
    // mutation site after the change is applied. Clearing the redo
    // stack on every push is standard "linear history" semantics —
    // doing anything new after an undo invalidates the redo chain.
    _pushUndo: function(uuid, before, after) {
      if (!uuid || !before || !after) return;
      this._undoStack = this._undoStack || [];
      this._redoStack = this._redoStack || [];
      this._undoStack.push({ type: "update", uuid: uuid, before: before, after: after });
      if (this._undoStack.length > this._undoStackLimit) this._undoStack.shift();
      this._redoStack = [];
      this._refreshUndoButtons();
    },

    // Compound delete op: snapshot every shape removed in one gesture
    // (a manual delete from the tooltip trash button is treated as a
    // bulk of size 1; the eraser tool sweeps multiple shapes into one
    // op). Each item carries its pre-deletion uuid + a `liveUuid`
    // In 0.3.x every shape has its uuid from the moment it's drawn
    // (client-side UUIDv7), so undo/redo of a bulk-delete can track
    // shapes by their permanent uuid — no more `tmpId` / `liveUuid` /
    // `pendingTmpId` dance waiting for the server to assign ids.
    _pushUndoBulkDelete: function(shapes) {
      this._undoStack = this._undoStack || [];
      this._redoStack = this._redoStack || [];
      function clone(v) {
        if (v == null) return v;
        try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
      }
      var items = shapes.map(function(shape) {
        return {
          snapshot: {
            kind: shape.kind,
            geometry: clone(shape.geometry),
            style: clone(shape.style),
            metadata: clone(shape.metadata),
            originalUuid: shape.uuid
          },
          // Set when this item gets recreated by undo; cleared on redo.
          // Lets a second redo find the live shape to delete again.
          liveUuid: null
        };
      });
      this._undoStack.push({ type: "bulk_delete", items: items });
      if (this._undoStack.length > this._undoStackLimit) this._undoStack.shift();
      this._redoStack = [];
      this._refreshUndoButtons();
    },

    _undo: function() {
      this._undoStack = this._undoStack || [];
      this._redoStack = this._redoStack || [];
      var op = this._undoStack.pop();
      if (!op) return;
      if (op.type === "bulk_delete") {
        var self = this;
        op.items.forEach(function(item) {
          var uuid = self._recreateFromSnapshot(item.snapshot);
          item.liveUuid = uuid;
        });
        this._redoStack.push(op);
      } else if (op.type === "update") {
        this._redoStack.push(op);
        this._applyHistorySnapshot(op.uuid, op.before);
      }
      this._refreshUndoButtons();
    },

    _redo: function() {
      this._undoStack = this._undoStack || [];
      this._redoStack = this._redoStack || [];
      var op = this._redoStack.pop();
      if (!op) return;
      if (op.type === "bulk_delete") {
        var self = this;
        op.items.forEach(function(item) {
          var uuid = item.liveUuid;
          if (!uuid) return;
          var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
          if (!shape) return;
          if (self.editingShape === shape) self._exitEditMode();
          if (self.editingTitleShape === shape) self._exitTitleEditMode();
          var idx = self.shapes.indexOf(shape);
          if (idx !== -1) {
            if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
            if (shape.titleGroup && shape.titleGroup.parentNode) {
              shape.titleGroup.parentNode.removeChild(shape.titleGroup);
            }
            self.shapes.splice(idx, 1);
          }
          item.liveUuid = null;
        });
        self._emitChanged();
        this._undoStack.push(op);
      } else if (op.type === "update") {
        this._undoStack.push(op);
        this._applyHistorySnapshot(op.uuid, op.after);
      }
      this._refreshUndoButtons();
    },

    // Rebuild a freshly-deleted shape from its pre-deletion snapshot.
    // Returns the new uuid (so the undo's bulk_delete item can track it
    // for a subsequent redo). The original uuid is preserved in
    // `snap.originalUuid` — if a consumer wants to keep external state
    // tied to the same id across undo/redo, they can fish it out of the
    // emitted annotations list.
    _recreateFromSnapshot: function(snap) {
      if (!snap || !snap.kind || !snap.geometry) return null;
      var ann = {
        // Restore under the same uuid so re-deletes look like a no-op
        // from the consumer's perspective and tooltips don't get
        // re-keyed across an undo.
        uuid: snap.originalUuid || genUuidV7(),
        kind: snap.kind,
        geometry: snap.geometry,
        style: snap.style,
        metadata: snap.metadata
      };
      this._renderAnnotation(ann);
      this._emitChanged();
      return ann.uuid;
    },

    // Apply a snapshot to a shape: restore local state and push the
    // updated annotations array. Tolerates a missing local shape —
    // happens if the row was deleted by another session.
    _applyHistorySnapshot: function(uuid, snap) {
      var shape = this.shapes.find(function(s) { return s.uuid === uuid; });
      if (!shape) return;
      if (snap.geometry != null) shape.geometry = JSON.parse(JSON.stringify(snap.geometry));
      shape.style = snap.style == null ? null : JSON.parse(JSON.stringify(snap.style));
      shape.metadata = snap.metadata == null ? null : JSON.parse(JSON.stringify(snap.metadata));
      this._renderShape(shape);
      if (shape.style && shape.style.color) this._applyShapeColor(shape.el, shape.style.color);
      if (this.editingShape === shape) {
        // Rebuild rather than reposition: an undo/redo can change the node
        // count or a node's smooth/corner type, which the handle elements
        // need to reflect, not just their positions.
        if (this.freehandEditor) this._renderFreehandEditor(shape);
        else this._positionAllHandles(shape);
      }
      if (this.editingTitleShape === shape) this._positionAllTitleHandles(shape);

      this._emitChanged();
    },

    _refreshUndoButtons: function() {
      var u = (this._undoStack || []).length;
      var r = (this._redoStack || []).length;
      if (this.undoBtn) this.undoBtn.disabled = u === 0;
      if (this.redoBtn) this.redoBtn.disabled = r === 0;
      // Mirror onto the popup's history buttons so the overflow
      // copies disable in lockstep with the toolbar copies.
      if (this.popupUndoBtn) this.popupUndoBtn.disabled = u === 0;
      if (this.popupRedoBtn) this.popupRedoBtn.disabled = r === 0;
      // Fire a state-change event so consumers driving their own UI
      // off the public API can keep external undo/redo buttons in
      // sync without polling.
      this._dispatch("etcher:history-changed", { canUndo: u > 0, canRedo: r > 0 });
    }
  };
})();
