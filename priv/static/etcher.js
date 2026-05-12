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
      "}",
      ".etcher-shape.is-selected {",
      "  stroke: #f59e0b; fill: rgba(245, 158, 11, 0.18);",
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
    },

    destroyed: function() {
      if (this.removeNavBtn) { try { this.removeNavBtn(); } catch (_) {} }
      if (this.toolbar && this.toolbar.parentNode) {
        this.toolbar.parentNode.removeChild(this.toolbar);
      }
      if (this.overlayWrapper && this.handle && this.handle.viewer) {
        try { this.handle.viewer.removeOverlay(this.overlayWrapper); } catch (_) {}
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
    // SVG overlay — one big OSD overlay covering the image rect; SVG viewBox
    // is in image pixels so shape coords are stored natively.
    // -------------------------------------------------------------------------

    _buildOverlay: function() {
      var self = this;
      var handle = self.handle;
      var w = self.imageSize.x;
      var h = self.imageSize.y;

      var wrapper = document.createElement("div");
      wrapper.className = "etcher-overlay";
      wrapper.style.width = "100%";
      wrapper.style.height = "100%";

      var svg = svgEl("svg", {
        viewBox: "0 0 " + w + " " + h,
        preserveAspectRatio: "none",
        width: "100%",
        height: "100%"
      });
      svg.style.overflow = "visible";
      wrapper.appendChild(svg);

      self.overlayWrapper = wrapper;
      self.svg = svg;

      var aspect = h / w;
      var Rect = window.OpenSeadragon.Rect;
      handle.viewer.addOverlay({
        element: wrapper,
        location: new Rect(0, 0, 1, aspect)
      });

      // Drawing input — only listens when we're in annotation mode with a
      // tool other than cursor. `pointer-events: auto` is toggled on the
      // wrapper to gate this.
      wrapper.addEventListener("pointerdown", function(e) { self._onPointerDown(e); });
      wrapper.addEventListener("pointermove", function(e) { self._onPointerMove(e); });
      wrapper.addEventListener("pointerup",   function(e) { self._onPointerUp(e); });
      wrapper.addEventListener("dblclick",    function(e) { self._onDoubleClick(e); });
      // Click-on-shape selection (cursor tool).
      svg.addEventListener("click", function(e) { self._onSvgClick(e); });
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

      var settings = self.handle && self.handle.viewer && self.handle.viewer.gestureSettingsMouse;
      if (on && settings) {
        self.gestureBackup = {
          dragToPan: settings.dragToPan,
          clickToZoom: settings.clickToZoom,
          dblClickToZoom: settings.dblClickToZoom
        };
        settings.dragToPan = false;
        settings.clickToZoom = false;
        settings.dblClickToZoom = false;
      } else if (!on && settings && self.gestureBackup) {
        settings.dragToPan = self.gestureBackup.dragToPan;
        settings.clickToZoom = self.gestureBackup.clickToZoom;
        settings.dblClickToZoom = self.gestureBackup.dblClickToZoom;
        self.gestureBackup = null;
      }

      if (!on) {
        self._selectTool(null);
        self._cancelDraft();
      }
    },

    _selectTool: function(toolKey) {
      var self = this;
      if (self.activeTool !== toolKey) self._cancelDraft();
      self.activeTool = toolKey;

      if (self.toolbar) {
        var btns = self.toolbar.querySelectorAll("button[data-tool]");
        btns.forEach(function(b) {
          var match = (toolKey == null && b.dataset.tool === "cursor") ||
                      (toolKey != null && b.dataset.tool === toolKey);
          b.classList.toggle("is-selected", match);
        });
      }

      if (self.overlayWrapper) {
        var drawing = toolKey != null;
        self.overlayWrapper.style.pointerEvents = drawing || self._hasSelectableShapes()
          ? "auto"
          : "none";
        self.overlayWrapper.classList.toggle("is-drawing", drawing);
      }
    },

    _hasSelectableShapes: function() {
      return this.annotationMode && this.shapes.length > 0;
    },

    // -------------------------------------------------------------------------
    // Pointer → image coords
    // -------------------------------------------------------------------------

    _toImage: function(e) {
      var p = this.handle.screenToImage({ x: e.clientX, y: e.clientY });
      return { x: p.x, y: p.y };
    },

    _clamp: function(pt) {
      return {
        x: Math.max(0, Math.min(this.imageSize.x, pt.x)),
        y: Math.max(0, Math.min(this.imageSize.y, pt.y))
      };
    },

    // -------------------------------------------------------------------------
    // Drawing handlers — dispatch to per-tool state machines
    // -------------------------------------------------------------------------

    _onPointerDown: function(e) {
      if (!this.annotationMode || !this.activeTool) return;
      if (e.button !== 0) return;
      var pt = this._clamp(this._toImage(e));

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
          this._polygonHover(this._clamp(this._toImage(e)));
        }
        return;
      }
      var pt = this._clamp(this._toImage(e));
      switch (this.draftState.kind) {
        case "rectangle": this._updateRectangle(pt); break;
        case "circle":    this._updateCircle(pt); break;
        case "freehand":  this._appendFreehand(pt); break;
      }
    },

    _onPointerUp: function(e) {
      if (!this.draftState) return;
      var pt = this._clamp(this._toImage(e));
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

    _onSvgClick: function(e) {
      if (!this.annotationMode || this.activeTool !== null) return;
      var target = e.target.closest(".etcher-shape");
      if (!target) return;
      var uuid = target.getAttribute("data-uuid");
      if (!uuid) return;

      this._selectShape(uuid);
      this.pushEventTo(this.el, "etcher:selected", { uuid: uuid });
    },

    // -------------------------------------------------------------------------
    // Rectangle
    // -------------------------------------------------------------------------

    _startRectangle: function(pt, e) {
      var rect = svgEl("rect", {
        x: pt.x, y: pt.y, width: 0, height: 0,
        "vector-effect": "non-scaling-stroke",
        "stroke-width": "2"
      });
      rect.classList.add("etcher-shape", "is-draft");
      this.svg.appendChild(rect);
      this.draftState = { kind: "rectangle", anchor: pt, el: rect };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateRectangle: function(pt) {
      var a = this.draftState.anchor;
      var x = Math.min(a.x, pt.x), y = Math.min(a.y, pt.y);
      var w = Math.abs(pt.x - a.x), h = Math.abs(pt.y - a.y);
      var el = this.draftState.el;
      el.setAttribute("x", x); el.setAttribute("y", y);
      el.setAttribute("width", w); el.setAttribute("height", h);
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
      var circle = svgEl("circle", {
        cx: pt.x, cy: pt.y, r: 0,
        "vector-effect": "non-scaling-stroke",
        "stroke-width": "2"
      });
      circle.classList.add("etcher-shape", "is-draft");
      this.svg.appendChild(circle);
      this.draftState = { kind: "circle", center: pt, el: circle };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _updateCircle: function(pt) {
      var c = this.draftState.center;
      var dx = pt.x - c.x, dy = pt.y - c.y;
      var r = Math.sqrt(dx * dx + dy * dy);
      this.draftState.el.setAttribute("r", r);
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
        var poly = svgEl("polyline", {
          points: pt.x + "," + pt.y,
          "vector-effect": "non-scaling-stroke",
          "stroke-width": "2",
          fill: "none"
        });
        poly.classList.add("etcher-shape", "is-draft");
        this.svg.appendChild(poly);
        this.draftPolygon = { points: [[pt.x, pt.y]], el: poly };
        return;
      }
      this.draftPolygon.points.push([pt.x, pt.y]);
      this._renderPolygonPreview(null);
    },

    _polygonHover: function(pt) {
      this._renderPolygonPreview(pt);
    },

    _renderPolygonPreview: function(hover) {
      var pts = this.draftPolygon.points.slice();
      if (hover) pts.push([hover.x, hover.y]);
      this.draftPolygon.el.setAttribute("points",
        pts.map(function(p) { return p[0] + "," + p[1]; }).join(" "));
    },

    _commitPolygon: function() {
      var pts = this.draftPolygon.points;
      if (pts.length < 3) {
        this._cancelDraft();
        return;
      }
      var el = this.draftPolygon.el;
      // Convert polyline preview to closed polygon.
      var polygon = svgEl("polygon", {
        points: pts.map(function(p) { return p[0] + "," + p[1]; }).join(" "),
        "vector-effect": "non-scaling-stroke",
        "stroke-width": "2"
      });
      polygon.classList.add("etcher-shape");
      this.svg.replaceChild(polygon, el);
      this.draftPolygon = null;
      this._finalizeShape("polygon", { points: pts }, polygon);
    },

    // -------------------------------------------------------------------------
    // Freehand
    // -------------------------------------------------------------------------

    _startFreehand: function(pt, e) {
      var path = svgEl("polyline", {
        points: pt.x + "," + pt.y,
        "vector-effect": "non-scaling-stroke",
        "stroke-width": "2",
        fill: "none"
      });
      path.classList.add("etcher-shape", "is-draft");
      this.svg.appendChild(path);
      this.draftState = { kind: "freehand", points: [[pt.x, pt.y]], el: path };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    },

    _appendFreehand: function(pt) {
      var pts = this.draftState.points;
      var last = pts[pts.length - 1];
      var dx = pt.x - last[0], dy = pt.y - last[1];
      if (dx * dx + dy * dy < 4) return; // throttle: skip sub-2px moves
      pts.push([pt.x, pt.y]);
      this.draftState.el.setAttribute("points",
        pts.map(function(p) { return p[0] + "," + p[1]; }).join(" "));
    },

    _commitFreehand: function(_pt) {
      var pts = this.draftState.points;
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
      this.shapes.push({ tmpId: tmpId, kind: kind, geometry: geometry, el: el });

      this.pushEventTo(this.el, "etcher:created", {
        target_type: this.targetType,
        target_uuid: this.targetUuid,
        kind: kind,
        geometry: geometry,
        tmp_id: tmpId
      });

      this.draftState = null;
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
      var g = ann.geometry, el;

      switch (ann.kind) {
        case "rectangle":
          el = svgEl("rect", { x: g.x, y: g.y, width: g.w, height: g.h });
          break;
        case "circle":
          el = svgEl("circle", { cx: g.cx, cy: g.cy, r: g.r });
          break;
        case "polygon":
          el = svgEl("polygon", {
            points: (g.points || []).map(function(p) { return p[0] + "," + p[1]; }).join(" ")
          });
          break;
        case "freehand":
          el = svgEl("polyline", {
            points: (g.points || []).map(function(p) { return p[0] + "," + p[1]; }).join(" "),
            fill: "none"
          });
          break;
        default:
          return;
      }

      el.setAttribute("vector-effect", "non-scaling-stroke");
      el.setAttribute("stroke-width", "2");
      el.classList.add("etcher-shape");
      if (ann.uuid) el.setAttribute("data-uuid", ann.uuid);
      this.svg.appendChild(el);

      this.shapes.push({ uuid: ann.uuid, kind: ann.kind, geometry: g, el: el });
    },

    _selectShape: function(uuid) {
      this.svg.querySelectorAll(".etcher-shape.is-selected").forEach(function(s) {
        s.classList.remove("is-selected");
      });
      var hit = this.svg.querySelector('.etcher-shape[data-uuid="' + uuid + '"]');
      if (hit) hit.classList.add("is-selected");
    },

    _removeShape: function(uuid) {
      var idx = this.shapes.findIndex(function(s) { return s.uuid === uuid; });
      if (idx === -1) return;
      var shape = this.shapes[idx];
      if (shape.el && shape.el.parentNode) shape.el.parentNode.removeChild(shape.el);
      this.shapes.splice(idx, 1);
    }
  };
})();
