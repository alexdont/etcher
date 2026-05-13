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
  // set for a basic install to work — they're hooks for layered consumers
  // (PhoenixKit, future apps) to customize Etcher without forking.
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
  //     for unknown ids. Methods: exitDrawing(), setMode(bool),
  //     selectShape(uuid), getShapes(). See README "Programmatic control".
  //
  // Lifecycle CustomEvents are dispatched on the layer's host element
  // (the `<div phx-hook="EtcherLayer">`), bubbling up so consumers can
  // listen at any ancestor:
  //   etcher:tooltip-show / -hide / -pin / -unpin
  //   etcher:mode-changed   { detail: { annotationMode } }
  //   etcher:tool-changed   { detail: { tool } }
  //   etcher:color-changed  { detail: { color } }
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
    close:    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>'
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
      ".etcher-overlay {",
      "  position: absolute; inset: 0; pointer-events: none;",
      "}",
      ".etcher-overlay.is-drawing { cursor: crosshair; }",
      ".etcher-shape {",
      "  fill: rgba(59, 130, 246, 0.12); stroke: #3b82f6;",
      // Shapes catch hover + click independently of the wrapper, so
      // annotations remain interactive when annotation mode is off and
      // the wrapper is `pointer-events: none` (events pass through to
      // OSD). Setting `pointer-events: visiblePainted` on freehand
      // polylines means the user can hover the thin line itself.
      "  pointer-events: visiblePainted; cursor: pointer;",
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
      // While drafting a polygon the first vertex doubles as the close
      // button — highlight it when the cursor is near so the user knows
      // a click there finishes the shape. Same look as `:hover` for
      // consistency.
      ".etcher-handle.is-close-target {",
      "  transform: scale(1.6); stroke-width: 3;",
      "  fill: currentColor; fill-opacity: 0.4;",
      "}",
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
      // Cross-component highlight: when an annotation is pinned, the
      // comments that reference it (via `data-annotation-uuid` from
      // PhoenixKitComments) glow orange so the user can see the
      // discussion thread in the sidebar at the same time.
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

  function genTmpId() {
    return "tmp-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
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
      self.targetType = self.el.dataset.targetType;
      self.targetUuid = self.el.dataset.targetUuid;

      try {
        self.tools = JSON.parse(self.el.dataset.tools || "[]");
      } catch (_) { self.tools = ["rectangle", "circle", "polygon", "freehand"]; }

      try {
        self.initialAnnotations = JSON.parse(self.el.dataset.initialAnnotations || "[]");
      } catch (_) { self.initialAnnotations = []; }

      self.shapes = [];           // { uuid|tmpId, kind, geometry, el }
      self.activeTool = null;     // null = cursor mode
      self.annotationMode = false;
      // Default color comes from `window.Etcher.defaultColor` (else the
      // blue swatch in the active palette, else the first swatch) so
      // the picker has a non-empty selected state on first open and
      // consumers can override the starting color.
      self.activeColor = resolveDefaultColor();
      self.draftState = null;     // per-tool drawing state
      self.gestureBackup = null;  // OSD gesture flags to restore on exit

      if (!self.frescoId) {
        console.warn("[Etcher] Missing data-fresco-id on layer host", self.el);
        return;
      }

      if (!window.Fresco || !window.Fresco.onViewerReady) {
        console.warn("[Etcher] Fresco not loaded — load fresco.js before etcher.js");
        return;
      }

      window.Fresco.onViewerReady(self.frescoId, function(handle) {
        self.handle = handle;
        self._whenImageReady(function() { self._init(); });
      });

      // Server confirms a persisted uuid for a temp-id shape — adopt it.
      self.handleEvent("etcher:annotation-saved", function(payload) {
        if (!payload || !payload.tmp_id) return;
        var shape = self.shapes.find(function(s) { return s.tmpId === payload.tmp_id; });
        if (!shape) return;
        shape.uuid = payload.uuid;
        delete shape.tmpId;
        if (shape.el) {
          shape.el.setAttribute("data-uuid", payload.uuid);
          shape.el.removeAttribute("data-tmp-id");
        }

        // Text shape was discarded mid-creation (user pressed Esc with
        // no content typed) before the server ack'd. Now that we have
        // the uuid, ask the server to drop the row.
        if (shape._discardOnSave) {
          self.shapes = self.shapes.filter(function(s) { return s !== shape; });
          self.pushEventTo(self.el, "etcher:deleted", { uuid: payload.uuid });
          return;
        }

        // Text shape had its title typed before the server ack'd —
        // flush the pending title now that we can address the row.
        if (shape._pendingTitle != null) {
          var t = shape._pendingTitle;
          delete shape._pendingTitle;
          self.pushEventTo(self.el, "etcher:updated", {
            uuid: payload.uuid,
            title: t
          });
        }

        // If this shape was just recreated by an undo of a bulk
        // delete, the corresponding history item is waiting on this
        // tmpId so a subsequent redo can target the new uuid.
        function syncLiveUuid(stack) {
          (stack || []).forEach(function(op) {
            if (op.type !== "bulk_delete") return;
            op.items.forEach(function(item) {
              if (item.pendingTmpId === payload.tmp_id) {
                item.liveUuid = payload.uuid;
                item.pendingTmpId = null;
              }
            });
          });
        }
        syncLiveUuid(self._undoStack);
        syncLiveUuid(self._redoStack);
      });

      // Server reports an external delete — drop the shape from the overlay.
      self.handleEvent("etcher:annotation-removed", function(payload) {
        if (!payload || !payload.uuid) return;
        self._removeShape(payload.uuid);
      });

      // Server pushed a NEW annotation that wasn't drawn locally — e.g.
      // another user added one in a collaboration session. Payload mirrors
      // the shape of `initial_annotations` entries: `{uuid, kind,
      // geometry, style?, metadata?}`. No-ops if the shape already
      // exists locally (idempotent).
      self.handleEvent("etcher:annotation-added", function(payload) {
        if (!payload || !payload.uuid || !payload.kind || !payload.geometry) return;
        var existing = self.shapes.find(function(s) { return s.uuid === payload.uuid; });
        if (existing) return;
        self._renderAnnotation(payload);
      });

      // Server pushed new tooltip metadata for an existing shape — e.g.
      // after a comment was posted/edited that the tooltip should now
      // surface. Merge the new metadata into the in-memory shape and
      // re-render the tooltip if it's currently showing this shape.
      self.handleEvent("etcher:annotation-updated", function(payload) {
        if (!payload || !payload.uuid) return;
        var shape = self.shapes.find(function(s) { return s.uuid === payload.uuid; });
        if (!shape) return;
        shape.metadata = payload.metadata || {};
        // Re-render the shape so the inline title sibling picks up
        // any change to `metadata.title` / `metadata.title_offset`.
        // For callouts this also refreshes the in-group <text>.
        self._renderShape(shape);
        if (self._tooltipShape === shape && self.tooltipEl &&
            self.tooltipEl.style.display !== "none") {
          self._showTooltipFor(shape);
        }
      });

      // Server signals "drop out of the active drawing tool" — fired
      // after a successful Post so the user doesn't accidentally start
      // drawing another shape. Annotation mode itself stays on; we
      // just switch to the cursor tool (toolKey = null).
      self.handleEvent("etcher:exit-drawing", function() {
        if (self.annotationMode) self._selectTool(null);
      });

      // Register this layer in the public `window.Etcher.layerFor`
      // registry so external code can drive it programmatically.
      layerRegistry[self.frescoId] = {
        api: {
          exitDrawing: function() { self._selectTool(null); },
          setMode: function(on) { self._setAnnotationMode(!!on); },
          selectShape: function(uuid) {
            var shape = self.shapes.find(function(s) { return s.uuid === uuid; });
            if (shape) self._pinTooltipFor(shape);
          },
          getShapes: function() {
            return self.shapes.map(function(s) {
              return {
                uuid: s.uuid,
                kind: s.kind,
                geometry: s.geometry,
                style: s.style || null,
                metadata: s.metadata || null
              };
            });
          }
        }
      };
    },

    destroyed: function() {
      this._exitEditMode();
      this._removeTooltipOutsideClickHandler();
      this._clearCommentHighlights();
      if (this._undoKeyHandler) {
        document.removeEventListener("keydown", this._undoKeyHandler);
        this._undoKeyHandler = null;
      }
      if (this.removeNavBtn) { try { this.removeNavBtn(); } catch (_) {} }
      if (this.visibilityBtn) { try { this.visibilityBtn(); } catch (_) {} }
      if (this.toolbar && this.toolbar.parentNode) {
        this.toolbar.parentNode.removeChild(this.toolbar);
      }
      if (this.overlayWrapper && this.overlayWrapper.parentNode) {
        this.overlayWrapper.parentNode.removeChild(this.overlayWrapper);
      }
      if (this._unsubViewport) {
        this._unsubViewport.forEach(function(fn) { try { fn(); } catch (_) {} });
        this._unsubViewport = null;
      }
      if (this.frescoId) delete layerRegistry[this.frescoId];
      this._setAnnotationMode(false);
    },

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    _whenImageReady: function(cb) {
      var self = this;
      var viewer = self.handle.viewer;
      var item = viewer.world.getItemAt(0);
      if (item) { cb(); return; }
      var unsub = self.handle.on("open", function() { unsub(); cb(); });
    },

    _init: function() {
      var self = this;
      var handle = self.handle;
      var item = handle.viewer.world.getItemAt(0);
      if (!item) return;

      var size = item.getContentSize();
      self.imageSize = { x: size.x, y: size.y };

      self._buildOverlay();
      self._buildToolbar();
      // Visibility toggle goes above the annotation-mode pencil so
      // it reads "look first, edit second" top-to-bottom.
      self._buildVisibilityButton();
      self._buildNavButton();
      self._wireUndoKeyboard();
      self._renderInitial();
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

      tip.addEventListener("mouseenter", function() { self._cancelHideTooltip(); });
      tip.addEventListener("mouseleave", function() { self._scheduleHideTooltip(); });
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
      wrapper.addEventListener("pointerdown", function(e) { self._onPointerDown(e); });
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

      // Cursor (deselect any active drawing tool).
      bar.appendChild(self._makeToolButton("cursor", ICONS.cursor, "Cursor"));

      var divider = document.createElement("div");
      divider.className = "etcher-divider";
      bar.appendChild(divider);

      self.tools.forEach(function(toolKey) {
        var def = TOOL_DEFS[toolKey];
        if (!def) return;
        bar.appendChild(self._makeToolButton(toolKey, def.icon, def.title));
      });

      var divider2 = document.createElement("div");
      divider2.className = "etcher-divider";
      bar.appendChild(divider2);

      // Undo / redo — operates on the local history stack of in-session
      // mutations. Disabled when there's nothing to undo/redo. Keyboard
      // shortcuts (Cmd/Ctrl+Z, +Shift) are wired in `_wireKeyboard`.
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

      self._refreshUndoButtons();

      // Color swatches. Affects: (a) the active draft if drawing,
      // (b) the editing shape if one is being edited, (c) the default
      // color future shapes start with. CSS handles the "no selection"
      // state — without an inline style the shape inherits the default
      // blue from `.etcher-shape`.
      self.swatchEls = resolveColorSwatches().map(function(s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "etcher-swatch";
        b.dataset.color = s.color;
        b.title = s.title;
        b.setAttribute("aria-label", "Color: " + s.title);
        b.style.background = s.color;
        // Mark the swatch matching the initial `activeColor` as the
        // selected starting state — gives the picker a non-empty look
        // when annotation mode opens for the first time.
        if (s.color === self.activeColor) b.classList.add("is-selected");
        b.addEventListener("click", function(e) {
          e.preventDefault();
          self._selectColor(s.color);
        });
        bar.appendChild(b);
        return b;
      });

      var divider3 = document.createElement("div");
      divider3.className = "etcher-divider";
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
      self.toolbar = bar;
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

      var viewer = self.handle && self.handle.viewer;
      var mouse = viewer && viewer.gestureSettingsMouse;
      var touch = viewer && viewer.gestureSettingsTouch;

      function snap(gs) {
        return gs && {
          dragToPan: gs.dragToPan,
          clickToZoom: gs.clickToZoom,
          dblClickToZoom: gs.dblClickToZoom,
          pinchToZoom: gs.pinchToZoom
        };
      }
      function freeze(gs) {
        if (!gs) return;
        gs.dragToPan = false;
        gs.clickToZoom = false;
        gs.dblClickToZoom = false;
        gs.pinchToZoom = false;
      }
      function restore(gs, snapshot) {
        if (!gs || !snapshot) return;
        gs.dragToPan = snapshot.dragToPan;
        gs.clickToZoom = snapshot.clickToZoom;
        gs.dblClickToZoom = snapshot.dblClickToZoom;
        gs.pinchToZoom = snapshot.pinchToZoom;
      }

      if (on) {
        self.gestureBackup = { mouse: snap(mouse), touch: snap(touch) };
        freeze(mouse);
        freeze(touch);
      } else if (self.gestureBackup) {
        restore(mouse, self.gestureBackup.mouse);
        restore(touch, self.gestureBackup.touch);
        self.gestureBackup = null;
      }

      if (!on) {
        self._selectTool(null);
        self._cancelDraft();
        self._exitEditMode();
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
      // means we're done admiring the current edit.
      if (toolKey != null) self._exitEditMode();

      if (self.toolbar) {
        var btns = self.toolbar.querySelectorAll("button[data-tool]");
        btns.forEach(function(b) {
          var match = (toolKey == null && b.dataset.tool === "cursor") ||
                      (toolKey != null && b.dataset.tool === toolKey);
          b.classList.toggle("is-selected", match);
        });
      }

      // Wrapper catches input only while a drawing tool is active. Shapes
      // catch their own hover + click independently via CSS, so the
      // wrapper can stay `pointer-events: none` in every other state and
      // let background clicks pass through to OSD's canvas.
      if (self.overlayWrapper) {
        var drawing = toolKey != null;
        self.overlayWrapper.style.pointerEvents = drawing ? "auto" : "none";
        self.overlayWrapper.classList.toggle("is-drawing", drawing);
        if (drawing) self._hideTooltip();
      }

      self._dispatch("etcher:tool-changed", { tool: toolKey });
    },

    // Color picker — affects the active draft if drawing, the editing
    // shape if one is being edited, and the default for future shapes.
    // `null` resets to the CSS default blue.
    _selectColor: function(color) {
      this.activeColor = color;
      this._dispatch("etcher:color-changed", { color: color });

      if (this.swatchEls) {
        this.swatchEls.forEach(function(el) {
          el.classList.toggle("is-selected", el.dataset.color === color);
        });
      }

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
        this.pushEventTo(this.el, "etcher:updated", {
          uuid: shape.uuid,
          geometry: shape.geometry,
          style: shape.style
        });
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
    // Coord helpers — image px ↔ container px (the SVG's coordinate space)
    //
    // Two reasons we don't use `handle.screenToImage` / `handle.imageToScreen`:
    //
    //   1. They route through OSD's `imageToViewportCoordinates`, which
    //      depends on the *current* tile source's content size. When Tessera
    //      swaps sources at higher zoom levels (medium → large → DZI), every
    //      previously-drawn annotation shifts because the "image pixel" axis
    //      just resized under us. Solution: snapshot `imageSize` once at
    //      init and do the conversion ourselves in viewport space (which is
    //      source-independent — the image's viewport rect is always
    //      `(0, 0, 1, aspect)`).
    //
    //   2. They route through `windowToViewportCoordinates` /
    //      `viewportToWindowCoordinates`, which use OSD's `getElementPosition`
    //      (offsetParent traversal). Inside a `position: fixed` modal with
    //      flex centering (daisyUI's pattern) those traversals can give values
    //      that don't agree with `getBoundingClientRect`, so the round-trip
    //      drifts and the drift compounds with zoom. Solution: stay in OSD's
    //      element-pixel space the whole time. The Etcher overlay is
    //      `inset: 0` of the viewer element, so element-pixel coords *are*
    //      the SVG coords.
    // -------------------------------------------------------------------------

    _toImage: function(e) {
      var Point = window.OpenSeadragon.Point;
      var r = this.handle.container.getBoundingClientRect();
      var pixel = new Point(e.clientX - r.left, e.clientY - r.top);
      var vp = this.handle.viewer.viewport.pointFromPixel(pixel, true);
      // viewport unit = imageSize.x pixels on both axes (OSD normalizes by
      // image width, so y uses the same scale factor).
      return { x: vp.x * this.imageSize.x, y: vp.y * this.imageSize.x };
    },

    _imageToContainer: function(pt) {
      var Point = window.OpenSeadragon.Point;
      var vp = new Point(pt.x / this.imageSize.x, pt.y / this.imageSize.x);
      var pixel = this.handle.viewer.viewport.pixelFromPoint(vp, true);
      return { x: pixel.x, y: pixel.y };
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
        case "polygon":
        case "freehand": {
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
            var coFontSize = Math.max(10, bh * 0.65);
            coText.setAttribute("x", bx + coPad);
            coText.setAttribute("y", by + coPad);
            coText.setAttribute("font-size", coFontSize);
            coText.setAttribute(
              "font-family",
              "ui-sans-serif, system-ui, -apple-system, sans-serif"
            );
            coText.setAttribute("font-weight", "500");
            var coMeasured = self._fillTextWithWrappedTspans(
              coText, calloutText, bw - coPad * 2, coFontSize
            );

            // Shrink-wrap the callout's text bbox the same way text
            // shapes and titles do — keeps the underline + leader
            // attached to the visible text edge.
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
      }

      // Inline title sibling for non-callout shapes (rect/circle/poly/
      // freehand). Callout renders its title as a child <text> inside
      // its <g>; for the other kinds a separate <text> is positioned a
      // hair above the bounding box. The dedicated `kind: "text"` shape
      // is the proper way to drop free-floating labels on the image —
      // the inline title here is just a small context affordance.
      if (shape.kind !== "callout" && shape.kind !== "text") {
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
        var fontSize = Math.max(10, th * 0.65);
        textEl.setAttribute("x", tx + pad);
        textEl.setAttribute("y", ty + pad);
        textEl.setAttribute("font-size", fontSize);
        textEl.setAttribute(
          "font-family",
          "ui-sans-serif, system-ui, -apple-system, sans-serif"
        );
        textEl.setAttribute("font-weight", "500");
        var measured =
          this._fillTextWithWrappedTspans(textEl, trimmed, tw - pad * 2, fontSize);

        // Shrink-wrap the rect to the rendered text dimensions so the
        // bbox hugs the text exactly — corner handles + the underline
        // sit right at the text edge instead of leaving empty space.
        var actualW = Math.max(measured.width + pad * 2, fontSize);
        var actualH = Math.max(measured.height + pad * 2, fontSize * 1.2);
        if (rectEl) {
          rectEl.setAttribute("width",  actualW);
          rectEl.setAttribute("height", actualH);
        }
        // Convert container-px shrink back to image px so the cache
        // matches the units used by handles + drag math. Falls back
        // to the requested bbox dimensions if the scale degenerates.
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
          var pts = g.points || [];
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
          var pts = (g.points || []).map(function(p) {
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
        var inside = e.target.closest(
          ".etcher-shape, .etcher-handle, .etcher-title-group, .etcher-text-editor, .etcher-tooltip, .etcher-toolbar"
        );
        if (!inside) self._exitTitleEditMode();
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

      function onMove(ev) {
        var pt = self._toImage(ev);
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
        // Persist the shrunk-to-text box so storage matches what's
        // rendered (no leftover "drag envelope" wider than the text).
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
          self.pushEventTo(self.el, "etcher:updated", {
            uuid: shape.uuid,
            metadata: shape.metadata
          });
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
          // Same shrink-on-release as title-handle drags so the
          // saved bbox always hugs the text, never the drag envelope.
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
            self.pushEventTo(self.el, "etcher:updated", {
              uuid: shape.uuid,
              metadata: shape.metadata
            });
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
        // Pinned tooltips ignore mouseleave for hide scheduling — the
        // user explicitly pinned them and they should dwell.
        if (self.tooltipPinned) return;
        // Don't snap closed — give the cursor time to travel from shape
        // to tooltip so the delete button stays reachable.
        self._scheduleHideTooltip();
      });
      el.addEventListener("click", function(e) {
        // While a drawing tool is active, let the click pass through to
        // the wrapper so the user can drag-draw over an existing shape.
        if (self.annotationMode && self.activeTool != null) return;
        // Otherwise: this is a selection. Stop propagation so OSD's
        // canvas (which lives next to us in the container) doesn't
        // also receive the click and trigger a click-to-zoom.
        e.stopPropagation();
        e.preventDefault();
        var id = shape.uuid || shape.tmpId;
        if (self.annotationMode) {
          // Edit handles only appear in annotation mode + cursor tool.
          self._enterEditMode(shape);
        } else {
          // Outside annotation mode: pin the tooltip so the user can
          // dwell on the comment preview without it timing out.
          // Clicking the same shape again unpins; clicking another
          // shape switches the pin.
          if (self.tooltipPinned && self._tooltipShape === shape) {
            self._unpinTooltip();
          } else {
            self._pinTooltipFor(shape);
          }
        }
        self.pushEventTo(self.el, "etcher:selected", { uuid: id });
      });

      // Double-click on a text or callout (in annotation mode, cursor
      // tool) jumps into inline-edit mode. Matches Figma/Miro muscle
      // memory and lets users tweak the callout's label without
      // re-opening the composer.
      el.addEventListener("dblclick", function(e) {
        if (shape.kind !== "text" && shape.kind !== "callout") return;
        if (self.annotationMode && self.activeTool != null) return;
        if (!self.annotationMode) return;
        e.stopPropagation();
        e.preventDefault();
        self._enterEditMode(shape);
        self._startTextEdit(shape);
      });

      // When the shape is the active edit target, its body becomes a
      // grab-handle for translating the whole annotation. The early
      // return covers every other state (not editing, drawing tool
      // active, etc.) so the listener is cheap to leave always-on.
      el.addEventListener("pointerdown", function(e) {
        if (self.editingShape !== shape) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        self._startShapeMove(shape, e);
      });
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

      // Anchor the tooltip just above the shape's bounding rect, in
      // container px. `getBoundingClientRect` reflects the current
      // post-animation position so the tooltip sits where the shape is
      // *now*, not where it started.
      var shapeRect = shape.el.getBoundingClientRect();
      var containerRect = this.handle.container.getBoundingClientRect();
      var x = shapeRect.left + shapeRect.width / 2 - containerRect.left;
      var y = shapeRect.top - containerRect.top - 8;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
      tip.style.transform = "translate(-50%, -100%)";
      tip.style.display = "block";

      this._dispatch("etcher:tooltip-show", {
        uuid: shape.uuid || null,
        anchor: { x: x, y: y }
      });
    },

    _scheduleHideTooltip: function() {
      // Pinned tooltips never auto-close — only an explicit click action
      // (same shape again, another shape, or outside) closes them.
      if (this.tooltipPinned) return;
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

    _hideTooltip: function() {
      var wasVisible = this.tooltipEl && this.tooltipEl.style.display !== "none";
      var hidShape = this._tooltipShape;
      this._cancelHideTooltip();
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
      // Mark the pinned shape visually so its dashed outline persists
      // when the cursor leaves it — without this the shape would
      // appear deselected even though its tooltip is dwelling.
      if (shape && shape.el) shape.el.classList.add("is-selected");
      this._installTooltipOutsideClickHandler();
      this._highlightCommentsFor(shape.uuid);
      this._dispatch("etcher:tooltip-pin", { uuid: shape.uuid || null });
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

    // PhoenixKitComments stamps each rendered comment with
    // `data-annotation-uuid` when the comment has one. We find those in
    // the document (the comments thread lives in the sidebar, outside
    // our viewer container) and highlight them. Scroll the first match
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
        // Clicks on a shape, on the tooltip itself, or on an edit-mode
        // handle keep the pin alive. Anything else unpins.
        if (e.target.closest(".etcher-shape, .etcher-tooltip, .etcher-handle")) return;
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
      if (uuid) {
        this.pushEventTo(this.el, "etcher:deleted", { uuid: uuid });
      }
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
          metadata: { title: "Add a title…" },
          el: g
        };
        this._renderShape(this.draftCallout);
        this._syncDraftHandles();
        return;
      }

      // Second click — commit at the new text-bbox top-left.
      var anchor = this.draftCallout.geometry.anchor;
      var box = this.draftCallout.geometry.text_box;
      var geom = {
        anchor: anchor,
        text_box: { x: pt.x, y: pt.y - box.h / 2, w: box.w, h: box.h }
      };
      var el = this.draftCallout.el;
      el.classList.remove("is-draft");
      this.draftCallout = null;
      var self = this;
      this._finalizeShape("callout", geom, el, function(shape) {
        // Drop straight into inline-edit mode so the user can type
        // the label immediately, matching the text shape's flow.
        self._startTextEdit(shape);
      });
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
    // Freehand
    // -------------------------------------------------------------------------

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
      var el = this.draftState.el;
      el.classList.remove("is-draft");
      this._finalizeShape("freehand", { points: pts }, el);
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
        if (uuid) self.pushEventTo(self.el, "etcher:deleted", { uuid: uuid });
      });
      self._hideTooltip();
    },

    // Hit-test in image px against each shape's geometry (or the
    // shape's title group, if it has one). Permissive — covers the
    // full visible footprint so users don't have to nick the exact
    // glyph or vertex to erase.
    _eraserHit: function(shape, pt) {
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
      // text + callout edit their own bbox; rect/circle/poly/freehand
      // edit a title that lives in `metadata.title_box` on the parent.
      var hasTitle =
        shape.kind !== "text" &&
        shape.kind !== "callout" &&
        shape.metadata && shape.metadata.title != null;
      if (shape.kind !== "text" && shape.kind !== "callout" && !hasTitle) return;
      this._endTextEdit();

      var self = this;
      var g;
      if (shape.kind === "text") {
        g = shape.geometry;
      } else if (shape.kind === "callout") {
        g = this._calloutTextBoxImage(shape.geometry);
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
      input.style.color = "inherit";
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

      if (newTitle === "" && !prevTitle && !shape.uuid) {
        // Brand-new text shape with no content typed — clean up. The
        // server may not have responded yet, so the create event will
        // be paired with a delete on tmp_id arrival.
        this._discardEmptyTextShape(shape);
        return;
      }

      if (newTitle === prevTitle) return;

      if (shape.uuid) {
        this.pushEventTo(this.el, "etcher:updated", {
          uuid: shape.uuid,
          title: newTitle
        });
        this._pushUndo(shape.uuid, historyBefore, this._snapshotShape(shape));
      } else {
        // Server hasn't ack'd yet — stash the pending title; the
        // annotation-saved handler picks it up and flushes.
        shape._pendingTitle = newTitle;
      }
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
    // text + callout: the shape's own `<g>`.
    // rect/circle/poly/freehand with a title: the title group.
    _textEditHost: function(shape) {
      if (!shape) return null;
      if (shape.kind === "text" || shape.kind === "callout") return shape.el;
      return shape.titleGroup || null;
    },

    // Strip a text shape that was abandoned mid-creation (no title ever
    // typed). If the server already ack'd a uuid, fire a delete; if not,
    // mark the shape so the upcoming `annotation-saved` handler can
    // delete on arrival.
    _discardEmptyTextShape: function(shape) {
      if (!shape) return;
      if (shape.uuid) {
        var uuid = shape.uuid;
        this._removeShape(uuid);
        this.pushEventTo(this.el, "etcher:deleted", { uuid: uuid });
      } else {
        shape._discardOnSave = true;
        // Optimistically hide so the user sees it gone; the actual
        // shape struct is purged when uuid arrives.
        if (shape.el && shape.el.parentNode) {
          shape.el.parentNode.removeChild(shape.el);
        }
      }
    },

    // -------------------------------------------------------------------------
    // Shared finalize + cancel
    // -------------------------------------------------------------------------

    _finalizeShape: function(kind, geometry, el, afterCreate) {
      var tmpId = genTmpId();
      el.setAttribute("data-tmp-id", tmpId);
      var style = this.activeColor ? { color: this.activeColor } : null;
      var shape = {
        tmpId: tmpId,
        kind: kind,
        geometry: geometry,
        style: style,
        el: el
      };
      this.shapes.push(shape);
      this._renderShape(shape);
      this._attachShapeInteractions(shape);

      // Anchor for the consumer's "spawn a composer / popover next to
      // the new shape" UI: shape's bottom-left in container px, with
      // an 8px gap below. Lets the host LV position a floating widget
      // anchored to where the user just drew.
      var anchor = this._shapeAnchorBottomLeft(shape);

      var payload = {
        target_type: this.targetType,
        target_uuid: this.targetUuid,
        kind: kind,
        geometry: geometry,
        tmp_id: tmpId,
        anchor_x: anchor.x,
        anchor_y: anchor.y
      };
      if (style) payload.style = style;

      this.pushEventTo(this.el, "etcher:created", payload);

      this.draftState = null;
      this._syncDraftHandles();

      // Per-kind post-create hook (e.g. text → inline edit). Runs on
      // the just-pushed shape so callers can capture it without
      // re-finding by uuid.
      if (typeof afterCreate === "function") {
        try { afterCreate(shape); } catch (_) {}
      }
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
      (self.initialAnnotations || []).forEach(function(ann) {
        self._renderAnnotation(ann);
      });
    },

    _renderAnnotation: function(ann) {
      if (!ann || !ann.kind || !ann.geometry) return;
      var el;

      switch (ann.kind) {
        case "rectangle": el = svgEl("rect");                       break;
        case "circle":    el = svgEl("circle");                     break;
        case "polygon":   el = svgEl("polygon");                    break;
        case "freehand":  el = svgEl("polyline", { fill: "none" }); break;
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
        default: return;
      }

      // Non-callout shapes get a uniform stroke-width on the root. The
      // callout's stroke-width is on the inner line; the group itself
      // doesn't render anything. The text shape's stroke-width is on
      // the inner rect (set during construction above).
      if (ann.kind !== "callout" && ann.kind !== "text") {
        el.setAttribute("stroke-width", "2");
      }
      el.classList.add("etcher-shape");
      if (ann.uuid) el.setAttribute("data-uuid", ann.uuid);
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
      this._renderHandles(shape);

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
      // propagation handlers on inner elements.
      var self = this;
      this._outsideClickHandler = function(e) {
        var inside = e.target.closest(
          ".etcher-shape, .etcher-handle, .etcher-text-editor, .etcher-tooltip, .etcher-toolbar"
        );
        if (!inside) self._exitEditMode();
      };
      document.addEventListener("click", this._outsideClickHandler, true);
    },

    _exitEditMode: function() {
      if (!this.editingShape) return;
      this.editingShape.el.classList.remove("is-editing");
      this._removeHandles();
      this._unwireMidpointTracker();
      this.editingShape = null;
      if (this._outsideClickHandler) {
        document.removeEventListener("click", this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }
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
          var payload = { uuid: shape.uuid, geometry: shape.geometry };
          if (startTitleBox) payload.metadata = shape.metadata;
          self.pushEventTo(self.el, "etcher:updated", payload);
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
          self.pushEventTo(self.el, "etcher:updated", {
            uuid: shape.uuid,
            geometry: shape.geometry
          });
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
        // Freehand has too many points to edit individually for v1 —
        // delete and redraw.
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
      var startGeom;
      if (shape.kind === "text" && shape._renderedBox) {
        startGeom = JSON.parse(JSON.stringify(shape._renderedBox));
      } else if (shape.kind === "callout" && shape._renderedBox) {
        var coStart = JSON.parse(JSON.stringify(shape.geometry));
        coStart.text_box = JSON.parse(JSON.stringify(shape._renderedBox));
        startGeom = coStart;
      } else {
        startGeom = JSON.parse(JSON.stringify(shape.geometry));
      }

      function onMove(ev) {
        var pt = self._toImage(ev);
        self._applyHandleDrag(shape, idx, pt, startGeom);
        self._renderShape(shape);
        self._positionAllHandles(shape);
      }
      function onUp(ev) {
        handleEl.classList.remove("is-dragging");
        handleEl.removeEventListener("pointermove", onMove);
        handleEl.removeEventListener("pointerup", onUp);
        handleEl.removeEventListener("pointercancel", onUp);
        try { handleEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        // Persist the shrunk-to-text bbox rather than the larger
        // "drag envelope" the user swept through — keeps the stored
        // geometry consistent with what's visible. Applies to text
        // shapes (whole geometry is the bbox) and callouts (the text
        // endpoint of the geometry is the bbox).
        if (shape.kind === "text" && shape._renderedBox) {
          shape.geometry = {
            x: shape._renderedBox.x,
            y: shape._renderedBox.y,
            w: shape._renderedBox.w,
            h: shape._renderedBox.h
          };
        } else if (shape.kind === "callout" && shape._renderedBox) {
          shape.geometry = {
            anchor: shape.geometry.anchor,
            text_box: {
              x: shape._renderedBox.x,
              y: shape._renderedBox.y,
              w: shape._renderedBox.w,
              h: shape._renderedBox.h
            }
          };
        }
        if (shape.uuid) {
          self.pushEventTo(self.el, "etcher:updated", {
            uuid: shape.uuid,
            geometry: shape.geometry
          });
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
      var startPt = self._toImage(e);
      var startGeom = JSON.parse(JSON.stringify(shape.geometry));
      // Full pre-move snapshot for the undo stack.
      var historyBefore = self._snapshotShape(shape);
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
          // If the shape carries a title, sync the stored title_box
          // with the shrunk-to-text dimensions so the storage stays
          // consistent with what's drawn after the translation.
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
            var payload = { uuid: shape.uuid, geometry: shape.geometry };
            if (startTitleBox) payload.metadata = shape.metadata;
            self.pushEventTo(self.el, "etcher:updated", payload);
            self._pushUndo(shape.uuid, historyBefore, self._snapshotShape(shape));
          }
          // Cursor is still over the shape (we just released it there),
          // so the user expects the tooltip to come back.
          self._showTooltipFor(shape);
        }
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
        default:
          return geom;
      }
    },

    _applyHandleDrag: function(shape, idx, pt, startGeom) {
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
        case "callout": {
          // idx 0 = anchor (what's pointed at); idx 1-4 = text-bbox
          // corners (TL, TR, BR, BL), mirroring rectangle's resize
          // handlers but writing back into `geometry.text_box`.
          var startBox = this._calloutTextBoxImage(startGeom);
          if (idx === 0) {
            shape.geometry = {
              anchor: [pt.x, pt.y],
              text_box: { x: startBox.x, y: startBox.y, w: startBox.w, h: startBox.h }
            };
          } else {
            var right = startBox.x + startBox.w;
            var bottom = startBox.y + startBox.h;
            var nx, ny, nw, nh;
            switch (idx) {
              case 1: nx = pt.x;     ny = pt.y;     nw = right - pt.x;     nh = bottom - pt.y;    break;
              case 2: nx = startBox.x; ny = pt.y;   nw = pt.x - startBox.x; nh = bottom - pt.y;    break;
              case 3: nx = startBox.x; ny = startBox.y; nw = pt.x - startBox.x; nh = pt.y - startBox.y; break;
              case 4: nx = pt.x;     ny = startBox.y; nw = right - pt.x;   nh = pt.y - startBox.y; break;
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
    // slot that gets filled when an undo recreates the row — the
    // server-assigned uuid arrives via `etcher:annotation-saved`, the
    // saved handler maps tmpId → uuid back onto the item, and a
    // subsequent redo can target it.
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
          liveUuid: null,
          pendingTmpId: null
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
          var tmpId = self._recreateFromSnapshot(item.snapshot);
          item.pendingTmpId = tmpId;
          item.liveUuid = null;
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
          self.pushEventTo(self.el, "etcher:deleted", { uuid: uuid });
          item.liveUuid = null;
        });
        this._undoStack.push(op);
      } else if (op.type === "update") {
        this._undoStack.push(op);
        this._applyHistorySnapshot(op.uuid, op.after);
      }
      this._refreshUndoButtons();
    },

    // Rebuild a freshly-deleted shape from its pre-deletion snapshot
    // and ask the server to create a new row. Mirrors `_finalizeShape`
    // but works from arbitrary data instead of an in-flight draft.
    // The `restore: true` flag tells consumers (e.g. MediaBrowser) to
    // skip the post-create composer popup so an undo doesn't ambush
    // the user with a comment composer.
    _recreateFromSnapshot: function(snap) {
      if (!snap || !snap.kind || !snap.geometry) return;
      // Use the same builder the initial-render path uses so the SVG
      // structure and interaction wiring match a normal load.
      var ann = {
        kind: snap.kind,
        geometry: snap.geometry,
        style: snap.style,
        metadata: snap.metadata
      };
      this._renderAnnotation(ann);
      var shape = this.shapes[this.shapes.length - 1];
      if (!shape) return;

      var tmpId = genTmpId();
      shape.tmpId = tmpId;
      if (shape.el) shape.el.setAttribute("data-tmp-id", tmpId);

      var anchor = this._shapeAnchorBottomLeft(shape);
      var payload = {
        target_type: this.targetType,
        target_uuid: this.targetUuid,
        kind: snap.kind,
        geometry: snap.geometry,
        tmp_id: tmpId,
        anchor_x: anchor.x,
        anchor_y: anchor.y,
        restore: true
      };
      if (snap.style) payload.style = snap.style;
      if (snap.metadata) payload.metadata = snap.metadata;
      if (snap.metadata && typeof snap.metadata.title === "string") {
        payload.title = snap.metadata.title;
      }
      // Tells the consumer which old uuid this row is restoring from
      // so it can rehydrate any related state (e.g. soft-deleted
      // comment threads) onto the new uuid.
      if (snap.originalUuid) payload.restore_from_uuid = snap.originalUuid;
      this.pushEventTo(this.el, "etcher:created", payload);
      return tmpId;
    },

    // Apply a snapshot to a shape: restore local state and push the
    // matching `etcher:updated` so the server's row reflects the
    // reverted/redone value. Tolerates a missing local shape — happens
    // if the row was deleted by another session.
    _applyHistorySnapshot: function(uuid, snap) {
      var shape = this.shapes.find(function(s) { return s.uuid === uuid; });
      if (!shape) return;
      if (snap.geometry != null) shape.geometry = JSON.parse(JSON.stringify(snap.geometry));
      shape.style = snap.style == null ? null : JSON.parse(JSON.stringify(snap.style));
      shape.metadata = snap.metadata == null ? null : JSON.parse(JSON.stringify(snap.metadata));
      this._renderShape(shape);
      if (shape.style && shape.style.color) this._applyShapeColor(shape.el, shape.style.color);
      if (this.editingShape === shape) this._positionAllHandles(shape);
      if (this.editingTitleShape === shape) this._positionAllTitleHandles(shape);

      var payload = {
        uuid: uuid,
        geometry: shape.geometry,
        style: shape.style,
        metadata: shape.metadata
      };
      if (shape.metadata && typeof shape.metadata.title === "string") {
        payload.title = shape.metadata.title;
      }
      this.pushEventTo(this.el, "etcher:updated", payload);
    },

    _refreshUndoButtons: function() {
      var u = (this._undoStack || []).length;
      var r = (this._redoStack || []).length;
      if (this.undoBtn) this.undoBtn.disabled = u === 0;
      if (this.redoBtn) this.redoBtn.disabled = r === 0;
    }
  };
})();
