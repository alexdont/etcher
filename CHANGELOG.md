# Changelog

All notable changes to **Etcher** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.5] — 2026-05-15

New annotation kind — `dimension` — for measurement-style labeling.
A horizontal-or-angled shaft with V-arrows on both ends and a
black, slidable label. Arrow color follows the active swatch; label
stays black with a white halo so it's legible on any color.

### Added

- **Dimension tool** (`kind: "dimension"`). Two endpoints
  (`geometry: {a: [x,y], b: [x,y]}`); label text + position along
  the shaft live in `metadata.title` and `metadata.title_offset`
  (0–1, default 0.5 = midpoint). Drawn either by click-drag (commit
  on release) or by two-click rubberband (first click locks endpoint
  A, the line follows the cursor, second click commits endpoint B).
  After commit, drops straight into inline-edit mode for the label.
- **Slidable label** — in cursor mode, click and drag the label to
  slide it along the shaft. Persists as `metadata.title_offset`.
- Endpoint corner handles + body-drag translate, double-click to
  re-edit the label, eraser supports the new kind.
- `Etcher.Annotation`'s `@kinds` widened to include `"callout"`,
  `"text"`, and `"dimension"` (the schema docs were also out of date
  for callout/text — fixed in passing).

### Changed

- The bundled `Etcher.Annotation` schema now accepts the same kinds
  the JS toolbar exposes. Consumers using the bundled storage need
  no migration if their CHECK constraint was already widened for
  callout/text — add `'dimension'` to the same allow-list.
- Inline text editor input pinned to black so the typed text stays
  readable on the white-ish input background regardless of the
  shape's stroke color (light pastels were nearly invisible).

## [0.2.4] — 2026-05-15

Cross-browser fixes + a callout stability sweep — mostly fallout from
the 0.2.3 title fix not being symmetric across the rendering paths.

### Fixed

- **Title / callout / text-shape labels render at the same vertical
  position in Firefox as in Safari.** The text elements were created
  with `dominant-baseline: hanging`, which Safari and Firefox
  interpret differently for Latin text — Safari renders glyphs ABOVE
  the hanging baseline while Firefox renders them BELOW per spec.
  Combined with the wrap helper's `dy="1em"` on the first tspan,
  callout text rendered correctly in Safari but floated below the
  rect in Firefox. All three render paths (`_renderTitleSibling`,
  the `case "text"` branch, and the callout branch in `_renderShape`)
  now override `dominant-baseline` to `alphabetic` on the text
  element each render. Both browsers honor alphabetic identically:
  the alphabetic baseline lands at `text.y + 1em`, putting the text
  cleanly inside the rect with the underline / leader attaching at
  the rect's bottom edge.
- **Callouts no longer grow exponentially when text overflows.** The
  width-fit font cap that 0.2.3 added to `_renderTitleSibling` was
  missing from the callout render path, so a long callout label
  triggered the same multi-line wrap → grow → wider font → more wraps
  feedback loop the title fix originally addressed. Same cap applied
  to callouts.
- **Click on a title or callout/text-shape handle no longer triggers
  a phantom resize.** `_startTitleHandleDrag` and `_startHandleDrag`
  unconditionally fired `etcher:updated` and snapped geometry to the
  rendered (shrunk) box on `pointerup`, even when the user just
  clicked without dragging. Both now use a 3-px screen-space dead
  zone (matching the body-drag and title-drag handlers) so a bare
  click is a no-op.
- **Callout corner drags no longer shrink the box on every
  interaction.** Drag math used `_renderedBox` (shrink-fit visual)
  as the start reference, so each drag computed a new geometry of
  `(visual + delta)` instead of `(geometry + delta)`. With shrink-fit
  on, that baked the shrink offset back into storage every drag —
  the callout visibly shrunk a bit each time, then converged. Drag
  math now uses pointer DELTA (`pt - startPt`) against the full
  `geometry.text_box`, so dragging a handle by Δpx grows or shrinks
  geometry by exactly Δpx; the visual continues to shrink-fit
  independently. Anchor drag (idx 0) still uses absolute pt — no
  visual/storage offset there.
- The `_startHandleDrag` `onUp` snap-to-`_renderedBox` is skipped for
  callouts (delta math already keeps geometry consistent with the
  visible drag). Text shapes still snap on release — same 0.2.x
  behavior, no regression.

## [0.2.3] — 2026-05-14

Single bug fix — stops the runaway growth of shape titles on drag /
click. No API change, no behavior change for code that doesn't hit
the bug.

### Fixed

- **Shape title text no longer balloons on every interaction.** When
  a title's content overflowed the default box width at the
  height-derived font-size, `_fillTextWithWrappedTspans` wrapped it
  onto multiple lines. `actualH = measured.height + pad·2` then
  exceeded the input `th`, that taller height got persisted back
  into `metadata.title_box` on release, the next render derived an
  even larger font, more lines wrapped, and the title grew
  exponentially per interaction (`title_box.h` going
  22 → 54 → 273 → … in three drags). `_renderTitleSibling` now
  caps the font-size so the title fits the box width on a single
  line (floor of 10 px), bounding `actualH` to one line of text.
  The shrink-to-text rendering + handle-drag commit are unchanged;
  with the cap in place the system has a fixed point instead of a
  feedback loop.

## [0.2.2] — 2026-05-14

Follow-up patch to 0.2.1: restore body-grab on the editing shape,
keep the tooltip from blocking the satellite title label, and make
edit-mode survive a click on a sibling shape now that shapes are
`pointer-events: none`.

### Fixed

- **Body-grab restored on the editing shape.** With 0.2.1 flipping
  every shape to `pointer-events: none`, the click-drag-the-body-
  to-move-the-shape gesture stopped firing because the shape's
  own pointerdown listener no longer saw any events. The
  currently-edit-mode shape now re-enables `pointer-events:
  visiblePainted` via a `.etcher-shape.is-editing` rule — only
  THAT shape catches its own pointerdown; the rest of the shapes
  stay invisible to events so pan/zoom still passes through them.
- **Tooltip no longer covers the title satellite.** When the cursor
  was over a shape's movable title label, the hover tooltip
  rendered above the parent shape — directly on top of the title
  the user was trying to grab. The doc-level hover hit-test now
  detects when the cursor is inside a title's bbox and suppresses
  the tooltip for that hit; hover styling on the parent shape
  stays applied so it's still clear which annotation is targeted.
- **Edit-mode and tooltip-pin survive a click on a sibling shape.**
  Both outside-click handlers (the edit-mode tear-down and the
  tooltip-pin tear-down) used `e.target.closest(".etcher-shape")`
  to detect "is this click on a shape?" — but since 0.2.1 shapes
  are `pointer-events: none`, the click's DOM target is OSD's
  canvas, not the shape. The handlers now fall back to an
  image-px hit-test via `_shapeAt(pt)` so clicking a different
  shape switches edit mode or the pin instead of tearing down to
  empty.

### Internal

- `_setHoveredShape/2` (was /1) gains an `onTitle` flag.
- New helper `_pointOnTitleOf/2` for the title-bbox hit-test.

## [0.2.1] — 2026-05-14

Patch release: pan / zoom now work over shapes.

### Fixed

- Scroll-wheel zoom and click-drag pan on the underlying viewer
  stopped working whenever the cursor was over an annotation
  (rectangle, circle, polygon, freehand, callout, text). Root
  cause: shapes had `pointer-events: visiblePainted` so they
  caught wheel + pointerdown before OSD's MouseTracker on the
  canvas sibling could see them — pointer events bubble UP the
  DOM, not sideways. Shapes are now `pointer-events: none`, and
  hover + click are re-detected at the document level via
  image-px hit-testing (reuses the eraser's per-kind point-in-
  shape check). Hover styling, tooltips, click-to-pin, click-to-
  edit, and dblclick-inline-edit all continue to work; pan and
  zoom now pass through every annotation cleanly.

### Internal

- Renamed `_eraserHit/2` to a shared `_shapeContainsPoint/2`
  helper. The eraser keeps a thin alias for readability at its
  call sites.
- New helpers: `_shapeAt/1` (topmost-shape lookup), `_onShapeTap/1`
  (shared tap-handling entry), `_wireGlobalShapeListeners/0` +
  `_unwireGlobalShapeListeners/0`, `_setHoveredShape/1`.
- Tap-vs-drag disambiguation with a 5px dead-zone keeps a quick
  click-without-drag firing the shape's selection / pin / edit
  flow, while any drag-with-movement passes through to OSD's
  pan unchanged.

## [0.2.0] — 2026-05-14

A backwards-compatible second release: two new shape kinds, an eraser
tool, undo/redo with full history, satellite titles, edge-resize
grabbers, polygon midpoint insertion, a visibility toggle, and a
complete programmatic API so consumers can drive the layer without
rendering its built-in toolbar.

### Added

- **Callout tool** (`kind: "callout"`) — blueprint-style leader-line
  annotation: an anchor dot pointing at the image, a thin line to a
  resizable text bbox (with a horizontal underline spanning the bbox
  bottom). Text inside scales to fit the bbox.
- **Text tool** (`kind: "text"`) — freestanding text label drawn as
  a click-drag bbox. Inline editor (`<foreignObject>` + `<input>`)
  opens on commit and on double-click for re-edit. Font scales with
  bbox height; bbox shrink-wraps to the text on release.
- **Eraser tool** — press-and-drag wipes shapes by sweep. Each shape
  the cursor crosses dims (`.is-erasing`) for preview; release
  flushes them all as a single compound delete. Idle hover (eraser
  selected, no button held) previews the single shape under the
  cursor.
- **Optional title field per annotation** — every kind can carry a
  short label (`title varchar(200)`). On rect/circle/polygon/freehand
  the title renders as a movable, resizable satellite group with a
  dashed leader line back to the parent's nearest perimeter point
  (leader auto-hides when the title is inside the parent). On
  callouts the title is the in-bbox content. Drag to move (persisted
  as `metadata.title_box`), 4 corner handles to resize, double-click
  to inline-edit.
- **Edge-midpoint resize grabbers on rectangles** — small rounded
  rect handles on each side; drag a side to slide one edge while
  the opposite edge stays anchored. Distinct visual + `ns-resize` /
  `ew-resize` cursors so they don't conflate with polygon midpoints.
- **Polygon midpoint vertex insertion** — every polygon edge now
  carries a "ghost" midpoint handle that lights up when the cursor
  is near. Grab it to insert a new vertex at that midpoint and place
  it via a vertex-style drag.
- **Undo / Redo** — toolbar buttons + ⌘Z / ⌘⇧Z / Ctrl+Y keyboard
  shortcuts. 50-op session history covers geometry, style, metadata,
  title text, and deletes (including bulk-delete from the eraser).
  Delete recreation honors a new `restore: true` flag so the consumer
  can suppress its create-time UI (e.g. comment composer) on undo.
- **Visibility toggle** — eye / eye-slash button above the pencil in
  Fresco's nav column. Hides/shows the entire SVG overlay with one
  click.
- **Color picker** — bottom-toolbar swatches; persisted as
  `style.color` on each annotation; vertex + title handles inherit
  the shape's color via `currentColor` (no more always-orange dots).
  Override the palette via `window.Etcher.colorSwatches`; initial
  color via `window.Etcher.defaultColor`.
- **Tooltip slot extension API** — `window.Etcher.tooltipSlots = {
  header, body, footer }` lets consumers replace the tooltip content
  per-slot while keeping the wrapper (trash button, pin/unpin, hover
  bridge) under Etcher's control. Default slots read generic
  `metadata.{title,body,subtitle}` keys.
- **Complete programmatic control surface** on
  `window.Etcher.layerFor(frescoId)` so every built-in button is
  callable from outside. Methods grouped by mode, visibility, tool,
  color, history, and shape selection/edit. Consumers can render
  their own toolbar and drive the layer headlessly.
- **CustomEvents** for state changes:
  `etcher:mode-changed`, `etcher:tool-changed`, `etcher:color-changed`,
  `etcher:visibility-changed`, `etcher:history-changed`,
  `etcher:tooltip-show / -hide / -pin / -unpin`.
- **Restored comment threads on undo-of-delete** — the etcher:created
  payload for a restore carries `restore_from_uuid` so consumers can
  re-link soft-deleted child rows (e.g. comments) to the new uuid the
  server assigns to the recreated annotation.
- **`appendNavButton` mutable handle (Fresco 0.1.2+)** — Etcher's nav
  buttons can now update their icon / title in place (used by the
  visibility toggle to flip eye ↔ eye-slash).

### Changed

- Default `:tools` list on `Etcher.Layer.layer/1` is now
  `[:rectangle, :circle, :polygon, :freehand, :callout, :text,
  :eraser]` (all seven). Pass an explicit list to subset.
- Text + title + callout bboxes shrink-wrap to the rendered text on
  every render; the stored geometry is rewritten to the shrunk
  dimensions on release so storage always matches what's visible.
- Vertex handles now inherit the shape's color (`currentColor`)
  instead of hard-coded orange. CSS hover / drag fills use
  `fill-opacity` so they tint correctly with whichever color the
  shape carries.
- Single-shape deletes now flow through the same compound
  `bulk_delete` undo op the eraser uses, so the tooltip trash button
  also gets redo support.

### Fixed

- Tooltip stops hijacking hover state on a different shape while
  another shape's tooltip is pinned.
- Pinned shape keeps its `.is-selected` outline when the cursor
  leaves it (was getting stuck visually deselected).
- Tooltip `.is-hovered` no longer sticks after the cursor leaves a
  pinned shape.

## [0.1.0] — 2026-05-06

Initial release.

### Added

- `Etcher.Layer` Phoenix LiveView function component — attaches an
  annotation overlay to a named Fresco viewer and adds a pencil button
  to its nav column.
- `Etcher.Storage` behaviour — pluggable storage adapter contract with
  four callbacks (`create/1`, `list_for/2`, `update/2`, `delete/1`).
- `Etcher.Storage.Default` — bundled implementation backed by the
  `etcher_annotations` table. Reads the consumer's Repo from
  `config :etcher, repo: …`.
- `Etcher.Annotation` Ecto schema for the bundled table (UUIDv7 primary
  key, `target_type` / `target_uuid`, four geometry kinds: rectangle,
  circle, polygon, freehand).
- `mix etcher.gen.migration` — generates the `etcher_annotations` table
  migration into the consumer's `priv/repo/migrations/`.
- JS engine at `priv/static/etcher.js` — registers the `EtcherLayer`
  LiveView hook, draws shapes as SVG overlays anchored to image
  coordinates, emits `etcher:created` / `:updated` / `:deleted` /
  `:selected` events.
- Bottom drawing toolbar with rectangle / circle / polygon / freehand
  tools; pencil-button toggle integrated with Fresco's nav column via
  `handle.appendNavButton/3` (Fresco 0.2+).

[0.2.2]: https://github.com/alexdont/etcher/releases/tag/v0.2.2
[0.2.1]: https://github.com/alexdont/etcher/releases/tag/v0.2.1
[0.2.0]: https://github.com/alexdont/etcher/releases/tag/v0.2.0
[0.1.0]: https://github.com/alexdont/etcher/releases/tag/v0.1.0
