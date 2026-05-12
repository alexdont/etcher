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
  // Icons (Heroicons, outline, 24×24, stroke="currentColor")
  // ===========================================================================

  var ICONS = {
    pencil:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"/></svg>',
    trash:    '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>',
    paperclip:'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"/></svg>',
    cursor:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 15 9 9m6 6-2.625 6.75M15 15l6.75-2.625M9 9 2.25 11.625M9 9l2.625-6.75"/></svg>',
    rectangle:'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>',
    circle:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>',
    polygon:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3.5 21 9.5 18 20H6L3 9.5 12 3.5Z"/></svg>',
    freehand: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17.25c2-2 3-4 5-4s2.5 2 4.5 2 3-2 5-2 2.5 1 3.5 1"/></svg>',
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
      ".etcher-toolbar button:focus-visible {",
      "  outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 1px;",
      "}",
      ".etcher-toolbar svg { width: 18px; height: 18px; }",
      ".etcher-toolbar .etcher-divider {",
      "  width: 1px; background: rgba(255, 255, 255, 0.2); margin: 4px 2px;",
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
      "  fill: #fff; stroke: #f59e0b; stroke-width: 2;",
      "  pointer-events: auto; cursor: grab;",
      // `transform-box: fill-box` anchors `transform-origin` to the
      // element's own box rather than the SVG viewport, so `scale()`
      // grows the dot around its own center instead of warping it
      // toward (0, 0). Bumping `transform` rather than `r` because
      // CSS-set `r` doesn't always win over the attribute-set `r="5"`
      // across all browsers.
      "  transform-box: fill-box; transform-origin: center;",
      "  transition: transform 80ms ease, stroke-width 80ms ease, fill 80ms ease;",
      "}",
      ".etcher-handle:hover {",
      "  transform: scale(1.6); stroke-width: 3;",
      "  fill: rgba(245, 158, 11, 0.35);",
      "}",
      ".etcher-handle.is-dragging {",
      "  cursor: grabbing; transform: scale(1.8); stroke-width: 3;",
      "  fill: rgba(245, 158, 11, 0.55);",
      "}",
      // While drafting a polygon the first vertex doubles as the close
      // button — highlight it when the cursor is near so the user knows
      // a click there finishes the shape. Same look as `:hover` for
      // consistency.
      ".etcher-handle.is-close-target {",
      "  transform: scale(1.6); stroke-width: 3;",
      "  fill: rgba(245, 158, 11, 0.4);",
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
      // Comment-preview slots — filled from `shape.metadata.comment_*`
      // fields the server passes when an annotation has a thread.
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
      ".etcher-tooltip-author {",
      "  margin-top: 2px; opacity: 0.7; font-size: 11px;",
      "}",
      ".etcher-tooltip-count {",
      "  margin-top: 4px; display: inline-block;",
      "  padding: 1px 6px; border-radius: 999px;",
      "  background: rgba(255, 255, 255, 0.15);",
      "  font-size: 10px; font-weight: 500;",
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
    freehand:  { icon: ICONS.freehand,  title: "Freehand" }
  };

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
      });

      // Server reports an external delete — drop the shape from the overlay.
      self.handleEvent("etcher:annotation-removed", function(payload) {
        if (!payload || !payload.uuid) return;
        self._removeShape(payload.uuid);
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
    },

    destroyed: function() {
      this._exitEditMode();
      this._removeTooltipOutsideClickHandler();
      this._clearCommentHighlights();
      if (this.removeNavBtn) { try { this.removeNavBtn(); } catch (_) {} }
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
      self._buildNavButton();
      self._renderInitial();
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

    // -------------------------------------------------------------------------
    // Mode + tool selection
    // -------------------------------------------------------------------------

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
    },

    _selectTool: function(toolKey) {
      var self = this;
      if (self.activeTool !== toolKey) self._cancelDraft();
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
    _renderShape: function(shape) {
      if (!shape || !shape.el) return;
      var self = this;
      var g = shape.geometry;
      var el = shape.el;

      switch (shape.kind) {
        case "rectangle": {
          var tl = self._imageToContainer({ x: g.x,         y: g.y });
          var br = self._imageToContainer({ x: g.x + g.w,   y: g.y + g.h });
          el.setAttribute("x", Math.min(tl.x, br.x));
          el.setAttribute("y", Math.min(tl.y, br.y));
          el.setAttribute("width",  Math.abs(br.x - tl.x));
          el.setAttribute("height", Math.abs(br.y - tl.y));
          break;
        }
        case "circle": {
          var c  = self._imageToContainer({ x: g.cx, y: g.cy });
          var rp = self._imageToContainer({ x: g.cx + g.r, y: g.cy });
          el.setAttribute("cx", c.x);
          el.setAttribute("cy", c.y);
          el.setAttribute("r", Math.abs(rp.x - c.x));
          break;
        }
        case "polygon":
        case "freehand": {
          var pts = (g.points || []).map(function(p) {
            var s = self._imageToContainer({ x: p[0], y: p[1] });
            return s.x + "," + s.y;
          }).join(" ");
          el.setAttribute("points", pts);
          break;
        }
      }
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
      }
    },

    _onPointerMove: function(e) {
      if (!this.draftState) {
        if (this.activeTool === "polygon" && this.draftPolygon) {
          this._polygonHover(this._toImage(e));
        }
        return;
      }
      var pt = this._toImage(e);
      switch (this.draftState.kind) {
        case "rectangle": this._updateRectangle(pt); break;
        case "circle":    this._updateCircle(pt); break;
        case "freehand":  this._appendFreehand(pt); break;
      }
    },

    _onPointerUp: function(e) {
      if (!this.draftState) return;
      var pt = this._toImage(e);
      switch (this.draftState.kind) {
        case "rectangle": this._commitRectangle(pt); break;
        case "circle":    this._commitCircle(pt); break;
        case "freehand":  this._commitFreehand(pt); break;
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
        // While a different tooltip is pinned, hover is suppressed so
        // the pin stays in control. Click switches the pin.
        if (self.tooltipPinned) return;
        el.classList.add("is-hovered");
        self._showTooltipFor(shape);
      });
      el.addEventListener("mouseleave", function() {
        // Pinned tooltips ignore mouseleave entirely.
        if (self.tooltipPinned) return;
        el.classList.remove("is-hovered");
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

      var meta = shape.metadata || {};
      var label = meta.label || shape.label || null;
      var commentText = meta.comment_text || null;
      var commentAuthor = meta.comment_author || null;
      var commentThumb = meta.comment_thumbnail_url || null;
      var commentHasAttachment = meta.comment_has_attachment === true;
      var commentCount = meta.comment_count || 0;

      var html = '<div class="etcher-tooltip-header">';
      html += '<span class="etcher-tooltip-kind">' + escapeHtml(shape.kind) + '</span>';
      // Only show delete for persisted annotations — temp shapes that
      // haven't been ack'd by the server yet shouldn't be deletable
      // through the server-side path.
      if (shape.uuid) {
        html += '<button type="button" class="etcher-tooltip-delete"' +
                ' data-etcher-action="delete" title="Delete annotation"' +
                ' aria-label="Delete annotation">' + ICONS.trash + '</button>';
      }
      html += '</div>';
      if (label) html += '<div>' + escapeHtml(label) + '</div>';

      // Comment preview block — renders when there's text / thumb /
      // author / attachment info. The thumb slot is either:
      //   (a) the image URL, with an onerror that swaps to a paperclip
      //       if the image fails to load (broken URL, 404, CSP block)
      //   (b) a paperclip icon when the comment has an attachment but
      //       no preview-able image (PDFs, audio, zips)
      //   (c) skipped entirely when there's no attachment + no image
      if (commentText || commentThumb || commentAuthor || commentHasAttachment) {
        html += '<div class="etcher-tooltip-body">';
        if (commentThumb) {
          html += '<img class="etcher-tooltip-thumb" src="' +
                  escapeHtml(commentThumb) + '" alt="">';
        } else if (commentHasAttachment) {
          html += '<span class="etcher-tooltip-thumb etcher-tooltip-thumb-icon">' +
                  ICONS.paperclip + '</span>';
        }
        html += '<div class="etcher-tooltip-text">';
        if (commentText) {
          html += '<div class="etcher-tooltip-quote">' + escapeHtml(commentText) + '</div>';
        }
        if (commentAuthor) {
          html += '<div class="etcher-tooltip-author">— ' +
                  escapeHtml(commentAuthor) + '</div>';
        }
        html += '</div></div>';
      }

      if (commentCount > 1) {
        html += '<span class="etcher-tooltip-count">' +
                commentCount + ' ' + (commentCount === 1 ? 'comment' : 'comments') +
                '</span>';
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
      this._cancelHideTooltip();
      // _hideTooltip is the universal teardown; make sure pin state is
      // also reset so the next click-to-pin starts clean.
      this.tooltipPinned = false;
      this._removeTooltipOutsideClickHandler();
      this._tooltipShape = null;
      if (this.tooltipEl) this.tooltipEl.style.display = "none";
    },

    // Pin / unpin — click-to-stick UX. Pinned tooltips ignore hover
    // events and only close on (a) clicking the same shape again,
    // (b) clicking another shape (which switches the pin), or
    // (c) clicking anywhere else on the page.
    _pinTooltipFor: function(shape) {
      this._showTooltipFor(shape);
      this.tooltipPinned = true;
      this._installTooltipOutsideClickHandler();
      this._highlightCommentsFor(shape.uuid);
    },

    _unpinTooltip: function() {
      this.tooltipPinned = false;
      this._removeTooltipOutsideClickHandler();
      this._clearCommentHighlights();
      this._hideTooltip();
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
      var uuid = shape.uuid;
      if (this.editingShape === shape) this._exitEditMode();
      // Optimistic local removal so the UI feels instant. Server still
      // gets the etcher:deleted event below to persist the change.
      var idx = this.shapes.indexOf(shape);
      if (idx !== -1) {
        if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
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
      // fills properly.
      var polygon = svgEl("polygon", { "stroke-width": "2" });
      polygon.classList.add("etcher-shape");
      this.svg.replaceChild(polygon, el);
      this.draftPolygon = null;
      this._lastHover = null;
      this._finalizeShape("polygon", { points: pts }, polygon);
      this._renderShape({ kind: "polygon", geometry: { points: pts }, el: polygon });
    },

    // -------------------------------------------------------------------------
    // Freehand
    // -------------------------------------------------------------------------

    _startFreehand: function(pt, e) {
      var path = svgEl("polyline", { "stroke-width": "2", fill: "none" });
      path.classList.add("etcher-shape", "is-draft");
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
    // Shared finalize + cancel
    // -------------------------------------------------------------------------

    _finalizeShape: function(kind, geometry, el) {
      var tmpId = genTmpId();
      el.setAttribute("data-tmp-id", tmpId);
      var shape = { tmpId: tmpId, kind: kind, geometry: geometry, el: el };
      this.shapes.push(shape);
      this._renderShape(shape);
      this._attachShapeInteractions(shape);

      // Anchor for the consumer's "spawn a composer / popover next to
      // the new shape" UI: shape's bottom-left in container px, with
      // an 8px gap below. Lets the host LV position a floating widget
      // anchored to where the user just drew.
      var anchor = this._shapeAnchorBottomLeft(shape);

      this.pushEventTo(this.el, "etcher:created", {
        target_type: this.targetType,
        target_uuid: this.targetUuid,
        kind: kind,
        geometry: geometry,
        tmp_id: tmpId,
        anchor_x: anchor.x,
        anchor_y: anchor.y
      });

      this.draftState = null;
      this._syncDraftHandles();
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
        default: return;
      }

      el.setAttribute("stroke-width", "2");
      el.classList.add("etcher-shape");
      if (ann.uuid) el.setAttribute("data-uuid", ann.uuid);
      this.svg.appendChild(el);

      var shape = {
        uuid: ann.uuid,
        kind: ann.kind,
        geometry: ann.geometry,
        metadata: ann.metadata || null,
        label: ann.label || null,
        el: el
      };
      this.shapes.push(shape);
      this._renderShape(shape);
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

      this.editingShape = shape;
      shape.el.classList.add("is-editing");
      this._hideTooltip();
      this._renderHandles(shape);

      // Dismiss on any click outside the shape, its handles, the
      // tooltip, or the toolbar. Capture phase so we run before stop-
      // propagation handlers on inner elements.
      var self = this;
      this._outsideClickHandler = function(e) {
        var inside = e.target.closest(
          ".etcher-shape, .etcher-handle, .etcher-tooltip, .etcher-toolbar"
        );
        if (!inside) self._exitEditMode();
      };
      document.addEventListener("click", this._outsideClickHandler, true);
    },

    _exitEditMode: function() {
      if (!this.editingShape) return;
      this.editingShape.el.classList.remove("is-editing");
      this._removeHandles();
      this.editingShape = null;
      if (this._outsideClickHandler) {
        document.removeEventListener("click", this._outsideClickHandler, true);
        this._outsideClickHandler = null;
      }
    },

    _renderHandles: function(shape, opts) {
      opts = opts || { interactive: true };
      this._removeHandles();
      var self = this;
      var positions = this._handlePositions(shape);

      this.handles = positions.map(function(pt, idx) {
        var h = svgEl("circle", { r: 5 });
        h.classList.add("etcher-handle");
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
      if (!this.handles || !this.handles.length) return;
      var positions = this._handlePositions(shape);
      var self = this;
      this.handles.forEach(function(h, idx) {
        if (positions[idx]) self._positionHandle(h, positions[idx]);
      });
    },

    _positionHandle: function(h, imagePt) {
      var c = this._imageToContainer(imagePt);
      h.setAttribute("cx", c.x);
      h.setAttribute("cy", c.y);
    },

    _removeHandles: function() {
      (this.handles || []).forEach(function(h) {
        if (h.parentNode) h.parentNode.removeChild(h);
      });
      this.handles = [];
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
        case "circle":
          return [{ x: g.cx + g.r, y: g.cy }];   // 0: east, controls radius
        case "polygon":
          return (g.points || []).map(function(p) { return { x: p[0], y: p[1] }; });
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
      // Snapshot the starting geometry so corner drags derive from the
      // *original* opposite corner, not the live one that's moving.
      var startGeom = JSON.parse(JSON.stringify(shape.geometry));

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
        if (shape.uuid) {
          self.pushEventTo(self.el, "etcher:updated", {
            uuid: shape.uuid,
            geometry: shape.geometry
          });
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
        shape.geometry = self._translateGeometry(
          shape.kind, startGeom, pt.x - startPt.x, pt.y - startPt.y
        );
        self._renderShape(shape);
        self._positionAllHandles(shape);
      }
      function onUp(ev) {
        el.classList.remove("is-moving");
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
        if (dragged) {
          if (shape.uuid) {
            self.pushEventTo(self.el, "etcher:updated", {
              uuid: shape.uuid,
              geometry: shape.geometry
            });
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
        default:
          return geom;
      }
    },

    _applyHandleDrag: function(shape, idx, pt, startGeom) {
      switch (shape.kind) {
        case "rectangle": {
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
      }
    },

    _removeShape: function(uuid) {
      var idx = this.shapes.findIndex(function(s) { return s.uuid === uuid; });
      if (idx === -1) return;
      var shape = this.shapes[idx];
      if (this.editingShape === shape) this._exitEditMode();
      if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
      this.shapes.splice(idx, 1);
      // Removed shape's element can no longer fire mouseleave, so close
      // any tooltip that was anchored to it.
      this._hideTooltip();
    }
  };
})();
