# Changelog

All notable changes to **Etcher** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.11.0] — 2026-08-04

### Added

- **Audio and video annotations.** Drop or paste an audio file and it lands as a player
  card — play/pause, title, timecode, scrub bar — drawn entirely in SVG, so it
  pans, zooms, moves, resizes and layers like any other shape. The `<audio>`
  element that plays it lives outside the overlay and is addressed by uuid;
  an `<audio>` inside a `<foreignObject>` behaves differently in every engine.

  Video shares the whole transport; only the picture differs. `<video>` can't
  be drawn into SVG except through a `<foreignObject>`, which is
  transform-buggy across engines, so frames render in a plain DOM layer
  positioned by the same transform the shapes use, under the SVG so
  annotations draw on top. Layering between the two is therefore
  all-or-nothing — no arrow can sit behind one video and in front of another.

  New `audio` and `video` kinds: `%{"x", "y", "w", "h", "href", "title",
  "duration"}`.
  Requires a host uploader — unlike images there is no embed fallback, because
  base64'd audio would put megabytes of JSON in the annotation payload on
  every save and every peer broadcast.

  **Shared playback** is a seam, not a policy. Local controls emit
  `etcher:media-command` `{uuid, action, position}`; the host broadcasts and
  hands state back via `applyMediaState(uuid, {playing, position})`, which
  corrects only past 250ms of drift and never re-broadcasts a correction.
  `etcher:media-blocked` fires when a browser's autoplay policy refuses
  `play()`, so the host can prompt for the interaction it needs.
  `mediaStates()` reports every shape's transport at once, so a host can
  answer a peer who joins mid-playback instead of leaving them silent until
  the next command.

  A dropped file **appears at once**, greyed out, labelled and with a
  progress bar, and fills in
  when the upload finishes — letting go of a file and watching nothing happen
  gave no way to tell a large file from a broken one. The placeholder stays
  out of the annotations payload until it has a source, so nothing persists
  or reaches a peer that they couldn't play, and a failed upload takes it
  away again rather than stranding a dead card.

  Both kinds resize by their corners. A video holds its proportions the way
  an image does, with Shift to stretch; an audio card doesn't, because it's a
  control rather than a picture and making it wider without making it taller
  is a reasonable thing to want.

  A video shows its controls only while pointed at (or selected) — the
  picture is the point of it, and a bar welded across the bottom permanently
  covers what you came to look at. The transport carries the current and
  total time, and hovering the scrub bar previews the moment you'd seek to.

  Files can also be **dragged onto the canvas** now, and land where they were
  dropped. Nothing handled `drop` before — not for images either — so
  dragging a file onto a board did what a browser does with an unhandled
  drop: navigated away to open the file.

  Files the browser can't play are refused *before* upload —
  `etcher:media-unsupported` — rather than transferring a large unplayable
  file in full and landing a card that never does anything. Volume and mute
  (`setMediaVolume`, `setMediaMuted`) are per-listener and emit nothing: in a
  room, turning it down for yourself is normal and turning it down for
  everyone is not.

- **Connectors — arrows that bind to shapes and follow them.** Hover a shape
  with the cursor tool and eight green dots appear on its bounding box (four
  corners, four side midpoints). Pull an arrow out of one; bring it near
  another shape and that shape's dots appear, with the nearest one
  highlighting as the arrow's head snaps onto it. Finish, and the two are
  connected — move or resize either shape and the arrow stays attached at the
  chosen points. Finished away from a shape, the end simply stays put.

  Two gestures, distinguished by what follows the press on a dot. **Drag** —
  press, move, release — commits where you let go, and is the quick way to
  join two shapes. **Route** — press and release without moving — leaves the
  arrow live and following the pointer, with each click dropping a bend so it
  can be snaked around obstacles; a click on another shape finishes it,
  double-click finishes with a free head, `Esc` or right-click abandons it.

  Selecting an arrow makes its whole path editable. The endpoints re-aim onto
  a different anchor (or off a shape, to detach). Every bend is a handle —
  drag to re-route, click to delete — and bringing the pointer near any
  segment raises a dot at that segment's middle which drags out into a new
  bend. The same pair of gestures polygons already use for vertices, and both
  are undoable. Proximity is measured to the whole segment rather than to its
  midpoint, so the dot is there before you reach a long leg's centre; it
  stays at the middle rather than tracking the pointer, which would drift it
  over the bend handles at either end.

  New `arrow` shape kind: `%{"a" => [x, y], "points" => [[x, y], …],
  "b" => [x, y], "from" => binding, "to" => binding}`, where a binding is
  `%{"uuid" => …, "anchor" => …}` or `null` and `points` holds the bends in
  order. The bindings are the source of truth and `a`/`b` are a cache
  rewritten on every render, which is what makes an arrow follow its
  endpoints through moves, resizes, undo and collab updates without any of
  those paths knowing connectors exist — and what lets `Etcher.Raster` bake
  one into a flattened image with no notion of what it's attached to.
  Deleting a bound shape leaves the arrow where it was rather than
  collapsing it.

  Connector dots are suppressed while a shape is selected, since the resize
  handles occupy the same eight points.

  Grabbing one doesn't take precision: the visible dot is small, but the
  press is accepted by a much larger invisible zone under it, which reaches
  past the shape's edge so an anchor can be approached from outside. However
  roughly you press, the arrow attaches to the exact anchor. The zone is
  clamped to a fraction of the shape's rendered size, so eight of them can't
  carpet a small or zoomed-out shape and leave nowhere to press for selecting
  or moving it.

### Fixed

- **Dragging a multi-selection moved one shape and broke the group.** A
  selected shape has pointer events enabled, so a press on it lands on the
  shape's own handler and stops there — the doc-level handler that owns the
  group-move branch never saw it. The press fell through to a single-shape
  move: the rest of the group stayed put and the one pressed entered edit
  mode, which reads as the selection falling apart. That handler now runs the
  same three cases the doc-level one does — shift extends the selection, a
  press on a member drags the whole group, a press on a non-member abandons
  it. Releasing after a group drag keeps the selection, so it can be dragged
  again straight away.

- **Connector dots appeared while a group was selected.** They invite a drag
  that starts an arrow, but a press on those shapes means "move the group",
  and the two gestures begin identically. The dots are now suppressed
  whenever a multi-selection exists, and return on the next hover once it's
  dropped.

- **The style panel's fill icons were near-invisible.** Every chrome surface
  (tool bar, action bar, style panel, popups) paints on its own near-black
  background in both light and dark hosts, but none of them set a foreground
  colour — so an icon drawn in `currentColor` inherited the *host page's*
  text colour, which on a light page is near-black on near-black. Only the
  fill icons showed it; the dash icons had been hiding the problem by
  hardcoding `stroke="#fff"`. The chrome now pins `color: #fff` at the
  container, so icons are white regardless of the host's theme and anything
  added later inherits a sane colour.

- **Freehand loops lost their fill.** Adding the fill modes narrowed the
  fillable-element list to rect/circle/polygon, which quietly dropped the
  body from freehand — a `<path>` or `<polyline>` — so lassoing a region
  drew the outline and shaded nothing. Freehand is fillable again and honours
  all four modes (none / semi / solid / pattern) like every other shape.
  Markers stay hollow: a marker is a stroke, and filling one would blob a
  felt-tip scribble into a solid shape.

- **Selecting an image showed nothing — and could make it vanish.** The
  selected/hovered styles paint a stroke, a fill and a drop-shadow. None of
  the first two apply to an SVG `<image>`, and the shadow is drawn outside
  the element's box, which the rounded-corner `clip-path` added in 0.10.2
  then clipped straight off (clipping happens after filtering). So box-
  selecting an image gave no feedback at all, and left a `filter` fighting a
  `clip-path` on one element — a combination some engines fail to rasterize,
  dropping the image entirely.

  Images now opt out of those styles and get a stroked ring instead, drawn as
  a sibling that follows the image's box and corner radius. Orange when
  selected or being edited, blue on hover.

- **The colour picker opened off the top of the canvas.** Toolbar popups were
  positioned above their trigger unconditionally, which is right for the
  toolbars at the bottom of the canvas but not for the colour swatches, which
  live in the style panel pinned near the top — the picker was placed ~190px
  above the viewport's top edge and was effectively unreachable. Popups now
  open above when there's room and flip below when there isn't, clamping into
  view if neither side fits. Applies to all four (tools, colours, params,
  marker) in both canvas and strip mode.

### Fixed

- **A dimension's label is a normal label.** It was a bespoke line of text
  welded to the shaft: the words could be edited and nothing else — no
  resizing, and a colour hard-pinned to black whatever the dimension was. It
  is now the same label every other shape has, so it resizes by its corner
  handles, takes the shape's colour, and edits the same way. It stays
  magnetic to the dimension: centred on the line, and dragging it slides it
  along rather than pulling it off.

- **A shape's label follows its colour.** The label's colour was fixed when
  it was first drawn, so recolouring a shape left its label behind with no
  way to catch it up.

- **Shapes no longer light up under a drag.** Dragging a dimension's label
  along its line, or moving anything across the board, lit up every shape the
  pointer crossed on the way — a hover outline and connector dots on each,
  drawn over the thing actually being dragged. Hover now waits until the
  button is released.

- **Connectors, play buttons and labels scale with the board.** Zooming out
  shrank the shapes but not the things drawn on and between them: arrows
  between blocks kept their weight and their arrowheads, a play button
  outgrew the card it sits in, and a shape's title held its size until it was
  the largest thing on screen.

  These were all lengths written as on-screen pixels — a padding, a font
  floor, an arrowhead — which are right at 1:1 and know nothing about zoom.
  The clamps mattered as much as the sizes: a floor like "no smaller than 7px"
  exists to keep a deliberately small card usable, and once the board is
  zoomed out it wins every comparison and the card stops shrinking.

  An audio or video card is now a single rigid design: every length in it —
  padding, corner radius, play disc, scrub bar, text — is a fixed proportion
  of the card, so at any size it is the same card scaled. It had been drawn
  with corners squared off and its scrub bar reduced to a hairline, because
  those clamps were held in screen pixels while the card around them grew.

  Dimensions scale with the board too, as one object: shaft, arrowheads,
  label and the halo behind it. A dimension had kept its full size on a
  zoomed-out board, so its measurement ended up the largest thing on screen.
  It is drawn at the same weight connectors are, so the two match side by
  side.

  Every connector on a board is drawn at the same weight. Nothing about an
  individual arrow — its length, how far apart its shapes are, which shapes
  they are, the zoom it was drawn at, or whether its head snapped to an
  anchor — can make two arrows look different from each other. The weight is
  taken from the board's own scale rather than a fixed number of canvas
  units, which would come out invisible on one board and enormous on another,
  since a board's coordinates depend on the zoom its content was added at.

  Two things deliberately do NOT scale. An audio card still drops its title
  and timecode below a fixed on-screen height, because that is a question of
  whether there is room to read them. And a connector's stroke keeps the same
  minimum width every other line has, so a zoomed-out board still shows its
  arrows.

- **The board no longer breaks when you rotate the canvas.** Rotating turned
  each shape's *position* correctly but left the shape itself facing the way
  it always had: pictures stayed upright inside sideways boxes, labels ran
  across the drawing rather than along it, and media players kept their bar
  welded to the screen's bottom edge instead of the picture's. Rotating now
  gives you the same picture, turned.

  Separately, every line on a rotated board rendered far too thick — around
  fourteen times, at the zoom this was found at. The overlay works out how
  much a canvas pixel is worth on screen by projecting a unit vector, and it
  was reading only one axis of the result. At 90° and 270° that axis is zero,
  and the guard behind it substituted a scale of 1, so stroke widths, hit
  tolerances and default text boxes were all computed in raw canvas units.
  The same probe had been copied into four places; there is now one.

### Changed

- **Stroke widths scale with the canvas.** A line was a fixed on-screen
  thickness at every zoom, so zooming out left every outline sitting on top of
  the shape it outlined — a 2px line around a 50px box reads very differently
  from a 2px line around a 500px one. Widths are now stored in canvas units
  like a marker's already were, so a line keeps the weight it was drawn with
  relative to the drawing.

  Widths saved before this are on-screen values authored at a zoom nobody
  recorded, so they're anchored to the zoom they're first painted at: the
  shape looks exactly as it did, and scales from there. Reading a stored `2`
  as 2 canvas units instead would render it at a fifth of a pixel on a
  zoomed-out board. The conversion is marked on the style, so it happens once
  and travels to peers on the next edit rather than being redone forever.

- **The marker draws a better line.** Three changes, none of which alter what
  a stroke stores:

  - **Every pointer reading is used, not one per frame.** A pointer is
    sampled far faster than frames are delivered and the extra readings are
    batched into the event that lands each frame; taking only that one turned
    a fast stroke into a polygon of frame-length straight segments — the
    faster you drew, the more angular it got. Coalesced events are now
    consumed in full.
  - **Input is filtered before it becomes a sample.** The spline passes
    exactly through what it's given, so hand tremor and a mouse's
    integer-pixel steps were drawn faithfully as wobble. An exponential
    filter (perfect-freehand's "streamline", at the same default) smooths
    them out, and the stroke is pinned to the real release position so the
    filter's lag can't leave it short.
  - **The spline no longer loops at sharp corners.** Catmull-Rom with uniform
    knot spacing overshoots wherever consecutive samples are unevenly spaced
    — which is what a hand decelerating into a turn produces — putting a
    small knot at every corner. It now uses centripetal spacing, which is
    provably free of cusps and self-intersections.

  Sampling is also keyed to screen distance rather than image distance, so a
  stroke has the same fidelity at every zoom, and stored coordinates keep one
  decimal instead of rounding to whole image px, which visibly stair-stepped
  strokes drawn while zoomed in.

- **Middle-button presses pass through to Fresco**, so its middle-drag pan
  (new in Fresco 0.11) works over annotations and their handles rather than
  only over blank canvas. The overlay swallowed every press to stop a drawing
  or handle drag from also panning the canvas underneath; that reasoning only
  ever applied to the left button. Every handle drag now ignores non-primary
  presses too.
- `Etcher.Raster` renders the new `arrow` kind — the routed path as a
  polyline plus a head at `b`, oriented along the final segment and clamped
  so a very short connector still reads as an arrow.
- The V-arrowhead maths behind `dimension` moved into a shared helper now
  that connectors draw one too. No visual change to dimensions.

## [0.10.2] — 2026-08-04

### Changed

- **Image shapes render with rounded corners**, matching the link preview
  cards a pasted URL turns into — a photo and a card sitting side by side on
  a board now round the same amount instead of one being square.

  The radius is a fraction of the image's shorter *rendered* side (4.5%,
  clamped to 2–16px) rather than a fixed number of pixels, because the
  overlay draws in container pixels and re-renders on every pan and zoom: a
  constant 8px reads as a rounded button on a board zoomed out far enough
  that an image is 56px across, and disappears entirely once you zoom in.
  Applied as a `clip-path: inset(… round …)` on the `<image>` element, so
  there's no per-shape `<clipPath>` rect to keep in step with the geometry.
  Covers every image on the layer — pasted, uploaded, and the local preview
  shown while an upload is still in flight.

## [0.10.1] — 2026-08-04

### Fixed

- **Strip-mode chrome was invisible once the reader scrolled.** In strip mode
  the layer's container *is* the scrolling element, so absolutely positioned
  chrome scrolls away with the content. 0.4.1 solved that for the tool bar
  with `.etcher-toolbar[data-strip] { position: fixed }`; 0.10.0 added the
  action bar, style panel and style trigger, stamped two of them `data-strip`
  and gave none of them the rule. They stayed `absolute`, so the action bar
  and panel drifted off the top of the viewport by exactly `scrollTop`, and
  the panel's `top: 12px` parked it at the top of the entire chapter.

  All four surfaces now carry both the marker and the rule. Positioning was
  the subtler half: `_positionActionBar` and `_positionStyleChrome` computed
  container-relative offsets, which are correct for `absolute` chrome but
  wrong for `fixed` chrome by however far the strip sits from the viewport
  origin — and right *by accident* when it sits at 0,0. Both now ask
  `_chromeOrigin/0` which space to emit, so canvas mode keeps its
  container-relative maths and strip mode gets viewport coordinates. The
  compact popup's `bottom` follows the viewport rather than the container
  height, and the docked panel's inset is measured from the container's rect
  so it pins to the strip's corner rather than the window's when the strip
  doesn't fill the screen.

  Covered by `test/js/strip_chrome_test.js`, in which every case places the
  strip away from the viewport origin — the arrangement that tells the right
  answer from the wrong one, and the one container-relative maths hides.

## [0.10.0] — 2026-08-04

### Added

- **`setImageUploader(fn)` — hand image files to the host instead of
  embedding them.** `fn(file, ctx)` returns a Promise of a URL, which becomes
  the shape's `href`. Covers every path that yields a file: paste,
  drag-drop, and the built-in picker. `window.Etcher.imageUploader` sets the
  same thing for every layer; the per-layer one wins.

  Worth setting whenever the annotation list is persisted over a socket.
  Without it a pasted screenshot lives in the shape as a base64 data URL,
  and since the whole list is re-emitted on every edit, that image is re-sent
  in full each time anything changes — two or three of them push ordinary
  edits past a socket frame limit, where they fail silently.

  A pasted image is now placed **immediately** and uploads behind it: the
  shape persists from the first frame with position, size and layering
  intact, drawing a local full-resolution preview while a reduced copy (up
  to 1600px, ~400KB budget) stands in as the saved `href`. So it survives a
  reload mid-upload, shows up for peers, and stays usable if the upload never
  completes. If the uploader rejects, throws, or resolves to a non-string,
  Etcher falls back to embedding: a failed upload should cost bytes, not the
  user's paste.
- **`setLinkUnfurler(fn)` — pasted URLs become preview cards.** `fn(url, ctx)`
  returns a Promise of `{svg, width, height}`; Etcher rasterises it and
  places it as an image shape carrying the URL in `metadata.link`. Etcher
  can't build one itself — reading a page's OpenGraph tags means fetching
  it, which the browser blocks cross-origin and which needs answering for
  anyway (SSRF, size caps, timeouts) somewhere with a server.

  A URL is settled *before* anything is drawn — nothing goes on the canvas
  while the unfurl runs, and a status line reads "Link detected — building
  preview…" until the card is ready. No unfurler, or a rejection, and the
  URL is pasted as text instead.

  Under the cursor tool a click selects the card and a **double-click**
  opens the link; under the grabber a single tap opens it. Dragging under
  either moves the card or pans the canvas and never opens anything.
  Selecting a card shows a `⋯` in its corner with **Open link** and **Edit
  link…**, the latter rebuilding the card in place so a mistyped address
  doesn't cost its position.
- **Text paste.** Pasting text inserts an ordinary text shape — double-click
  to edit, corners to resize, takes the active colour. Images win when the
  clipboard carries both, which is the usual case copying from a web page.
- **Shape labels.** Double-click any shape to add or edit a label
  (`metadata.title`); it starts centred inside the shape. The style panel
  gains alignment presets (`metadata.title_align`) giving the nine anchors
  inside the shape's box, plus a *float* control for the original
  above-with-a-leader placement. Dragging or resizing a label returns it to
  free positioning.
- **`"none"` line style and `"pattern"` fill.** Fill modes are now
  none / semi / solid / pattern (45° hatch) and line styles solid / dashed /
  dotted / none. "No line" only takes effect where the body is painted — a
  shape with neither stroke nor fill can't be seen, and an invisible shape
  can't be clicked back into existence.
- **Z-order actions** — bring to front / forward / backward / send to back,
  in the action bar's `⋮`, with tap-cycling to reach a shape underneath
  another.
- **Paste button** in the action bar, for touch devices with no ⌘V to press.
  Reading the clipboard on demand needs a secure context and permission;
  refused or unsupported, it says so rather than doing nothing.

### Changed

- **The toolbar is three surfaces instead of one.** A bottom bar of
  essentials (cursor, grabber, freehand, eraser, line, text, callout, image)
  plus a "last used" slot and a `[⋯]` grid for everything else; a floating
  **action bar** above it (undo / redo / delete / duplicate / paste, with
  arrange behind `⋮`); and a **style panel** docked right, which is where
  the colour swatches now live.

  On a narrow container the style panel collapses into a button beside the
  tool bar and opens as a popup — decided on the container's width, not the
  viewport's, since a layer can be embedded in a column on a wide page.
- **Resizing an image keeps its proportions.** A corner drag scales by
  whichever axis you pulled further and leaves the opposite corner fixed;
  hold **Shift** to stretch freely. The lock is against the aspect the shape
  had when the drag started, not the file's natural one, so a deliberately
  stretched image keeps the shape you gave it.
- **Text, callout and label glyphs no longer carry a white halo.** A 2–3px
  stroke under every letter was holding contrast over photographs; on a
  canvas it read as an outline on the type and thickened small text into
  mush. The dimension label keeps its halo, where it masks the shaft line
  running behind the number.
- **Anything pasted arrives selected with the cursor tool active**, ready to
  move or scale without another click and without putting down whatever tool
  was being held.

### Fixed

- **Dotted strokes were invisible on shapes.** A zero-length dash paints
  nothing under the default `butt` linecap; markers only looked right
  because their own CSS already rounded caps.
- **The toolbar collapsed a button late.** It measured itself with
  `scrollWidth`, which reports the client box for a flex row sized by its own
  content — 448 against a rendered 490 — and reset the `[⋯]` trigger to
  hidden just before measuring, though `_syncToolsPopup` turns it straight
  back on.
- **A shape whose fill was set to "none" could never get its colour back**:
  switching to none wrote `fill: none` onto the element and the params path
  never touched colour again.
- **A dragged label came back as two lines.** The width-fit font size is
  computed as if text width were linear in font size, and hinting makes it
  slightly not, so fitted text could land a hair over the available width and
  wrap.
- **Label resize handles didn't follow an alignment change**, leaving them
  behind until title-edit mode was toggled off and back on.

## [0.9.0] — 2026-07-21

### Added

- **`image` shape kind.** Annotations can now be images. An image shape is
  `{kind: "image", geometry: {x, y, w, h, href}}` where `href` is any image
  URL (a `data:` URL works, so a pasted/dropped image needs no upload). It
  renders as an SVG `<image>` positioned like a rectangle box
  (`preserveAspectRatio="none"`, so a corner-drag scales it freely) and
  reuses the rectangle's box geometry everywhere else — move, four-corner
  resize, hit-test, bounding box, and selection handles all work with no
  new interaction code. `href` rides inside `geometry`, so it travels with
  the shape through `addShape`, the `etcher:annotations-changed` emit, and
  the persisted extensions map. Add one via the layer API:
  `window.Etcher.layerFor(id).addShape({kind: "image", geometry: {x, y, w, h, href}})`.
  Images carry no stroke/fill styling.
- **`:image` toolbar tool.** Add `:image` to `<Etcher.layer tools={[...]}>` and
  the toolbar gains a photo button. It's a one-shot action, not a drawing
  mode: clicking it inserts an image without changing the current tool. Two
  ways to source the image, via the new `image_source` attr:
  - `:file_picker` (default) — opens the OS file picker and inserts the chosen
    file as a `data:` URL. Zero host code.
  - `:custom` — emits `etcher:image-insert-requested` (a LiveView hook event
    **and** a bubbling DOM `CustomEvent`) so the host opens its own uploader /
    media modal, then calls `layerFor(id).insertImage(href, opts)` with the
    result. Inserted images are auto-sized (longest side scaled to 800 canvas
    px) and centered on the viewport (or `opts.at`).
- **Paste-to-canvas, on by default.** Pasting an image (⌘/Ctrl-V) onto the
  canvas inserts it at the viewport center — no `:image` tool required.
  Pastes into a focused text field (including Etcher's own text editor) are
  left alone. Disable per-layer with `paste_images={false}`.
- **Layer API for image insertion + coordinates**
  (`window.Etcher.layerFor(id)`): `insertImage(href, opts)` places an image
  (`opts.at = {x, y}`, `opts.width`/`height`/`maxSide`), `openImagePicker()`
  runs the built-in file picker, and `screenToImage`/`imageToScreen`/
  `viewportCenterImage` expose the Fresco handle's screen ↔ image round-trip
  so hosts can place shapes under the cursor or at the viewport center.

## [0.8.2] — 2026-07-20

### Fixed

- **Circles were invisible when drawn on a rotated canvas.** The circle
  renderer computed its screen radius from only the x-component of the
  projected edge point (`rp.x - c.x`). At 90°/270° an image-x offset
  projects to a screen-*y* offset, so that difference collapsed to ~0 and
  the `<circle>` rendered with radius 0 — the shape existed and hit-tested
  correctly, it just didn't paint until you rotated back to 0°/180°. Now
  uses the full projected distance (`hypot(rp.x-c.x, rp.y-c.y)`), which
  equals `r × scale` at any rotation. Same fix applied to the circle
  edge-anchor helper (handle/title placement). Other shapes were already
  correct: strokes/polygons/lines/dimensions project every point, and
  rect/text/callout use axis-aligned corner bboxes that stay valid under
  90°-snapped rotation.

## [0.8.1] — 2026-07-19

### Changed

- **Allow fresco 0.10.x** (`~> 0.10.0` added to the version constraint).
  Fresco 0.10.0 adds a counter-clockwise rotate button + `rotateLeft` /
  `rotateRight` handle helpers; it's backward-compatible with the handle
  API Etcher uses.

## [0.8.0] — 2026-07-16

### Added

- **Fresh draws are undoable.** Committing a shape now pushes a `create` op
  onto the history stack — undo deletes the just-drawn shape, redo recreates
  it from a snapshot (same machinery as bulk-delete, inverted). Previously a
  draw left no history entry at all: the undo/redo buttons stayed disabled
  and ⌘Z did nothing until the first drag, edit, or delete.
- **Per-tool mouse cursors.** While a drawing tool is armed, the pointer is a
  small crosshair (the hotspot) with the tool's glyph badged bottom-right,
  double-stroked white/black so it stays legible over any imagery. Data-URI
  SVG cursors with plain `crosshair` as the fallback; applied in both canvas
  and strip modes. The grabber keeps `grab`.

### Changed

- **Tool icons redrawn to match what the tools do.** Marker is now a felt-tip
  marker leaving an ink trail (was a paint brush); Eraser is an eraser wedge
  (was a trash can — the trash stays on the tooltip's delete button, where
  deletion is what happens); Freehand is a hand-tilted half-circle stroke
  with node dots at both ends, a faint dashed closing edge, and a
  half-transparent fill — freeform draw, selection region, and editable
  nodes in one glyph. Freehand/marker tooltips now spell out the
  editable-curve vs ink-stroke distinction.
- **`etcher:shape-drawn` payload now carries `fresco_id`** like every other
  pushed event, so hosts rendering two viewers on one page can route it.
  Additive — existing `%{"uuid" => _, "kind" => _}` handler clauses still
  match.
- **Cursor tool shows the plain arrow while annotating.** Fresco's `grab`
  cursor leaked through even though Etcher locks drag-pan in cursor mode
  (drag means box-select / shape-move); `grab` returns when the toolbar
  closes.
- **Allow fresco 0.9.x** (`~> 0.9.0` added to the version constraint).
  Fresco 0.9.0 is backward-compatible with the handle API Etcher uses.

### Fixed

- **Marker strokes can be moved.** `_translateGeometry` had no `"marker"`
  case, so dragging a marker ran the whole move interaction but returned the
  geometry unchanged. Markers now translate their points like other strokes;
  covers single drags and multi-selection group moves.
- **Body-dragging a node-based freehand no longer destroys it.** The same
  translate path replaced `{nodes: …}` geometry with an empty points array;
  nodes now shift their anchors (`hIn`/`hOut` are anchor-relative and stay
  untouched).
- **Freehand strokes are selectable again.** The hit-test treated freehand as
  a closed polygon (ray-casting only) — a drawn line encloses near-zero
  area, so clicking directly on the stroke never hit: no edit handles, no
  move, no pen editor. Freehand now hits by proximity to the curve first
  (the marker's test, which already flattens node geometry), with the
  interior test kept so closed loops still respond to clicks inside.
- **Undo/redo of deletes keeps `image_idx` / `image_id`.** Bulk-delete
  snapshots dropped the image tags, so a redo-after-undo revived shapes
  untagged on strips and multi-image canvases (breaking per-page routing and
  visibility toggling).

## [0.7.2] — 2026-07-06

### Changed

- Allow **fresco 0.8.x** (`~> 0.8.0` added to the version constraint). Fresco
  0.8.0 is backward-compatible with the handle API Etcher uses — no code
  changes required; this only widens the dependency so consumers can adopt it.

## [0.7.1] — 2026-06-25

### Fixed

- **`Etcher.Raster` now renders marker and vector-freehand strokes.** `0.7.0`
  skipped the `marker` kind entirely and only matched legacy point-based
  `freehand`, so strokes from the marker tool — and from the current
  vector-freehand tool, which persists cubic-bezier `nodes` rather than raw
  `points` — were dropped from baked output (e.g. annotated thumbnails). Both
  now flatten to a polyline; node-based strokes are subdivided the same way the
  canvas does (mirrors `_freehandFlatten`), so a curved stroke reads as a curve,
  not a chord.

## [0.7.0] — 2026-06-25

### Added

- **`Etcher.Raster` — server-side rendering of annotations.** A pure,
  dependency-free counterpart to the browser overlay: turns persisted
  `extensions.etcher` geometry into either ImageMagick `convert -draw`
  arguments (`to_draw_args/2`, to bake shapes into a raster — e.g. an
  annotated thumbnail) or a standalone `<svg>` string (`to_svg/2`, an
  `object-cover`-aligned overlay). Single source of truth for "geometry →
  drawn shape" on the server, mirroring the README wire format; accepts
  string- or atom-keyed maps and skips unsupported/malformed shapes.
  `primitives/1` exposes the normalised primitive list for custom backends.

## [0.6.6] — 2026-06-06

### Added

- **Re-hydrate on Fresco `setSources`.** When a `<Fresco.canvas>` swaps its
  image set in place (Fresco 0.7's `handle.setSources`, which also fires a
  `sources-changed` event), the overlay now rebuilds from the new
  `extensions.etcher`: it tears down the current shapes + interaction state
  (edit mode, selection, tooltip, undo/redo), re-renders the new
  annotations, re-seeds the per-canvas palette from
  `extensions.etcher.colors` (the `:colors` attr still wins), and re-emits
  `etcher:annotations-changed` for consumer save handlers. Without this,
  chapter N's shapes lingered on chapter N+1's images. Per-shape `readonly`
  flows in naturally via the new annotations array. No-op on Fresco < 0.7
  (the event never fires) and in strip mode (the event is canvas-only).

### Changed

- Widen the Fresco dependency to
  `~> 0.5.9 or ~> 0.6.0 or ~> 0.7.0` so consumers can pull Fresco 0.7, where
  `handle.setSources` lives.

## [0.6.5] — 2026-06-05

### Added

- **`:line_params` attr + `etcher:line-params-changed` event.** Seeds the
  layer's global stroke defaults (`width` / `opacity` / `dash`) on mount —
  any missing key falls back to the built-in default (`2` / `1` / `solid`)
  — and echoes any change made via the Parameters popup *with no shape
  selected*, so consumers can persist per-user line defaults exactly the
  way `:colors` / `etcher:colors-changed` works. Editing a *selected*
  shape's style keeps flowing through `etcher:annotations-changed`
  (unchanged) and does not fire this event. New `getLineParams()` /
  `setLineParams(map)` layer-instance methods; like `setColors`,
  programmatic `setLineParams` does not fire the change event. New optional
  attr defaults to `nil` → identical to prior behavior.

## [0.6.4] — 2026-06-05

### Fixed

- **Strip mode: freehand / marker strokes that cross an image boundary no
  longer teleport.** Points captured while the cursor was over a later
  image came back in that image's local coordinates (y reset near 0) but
  were stored in the starting image's space, so the line snapped back to
  the top. Cross-image points are now translated into the starting image's
  coordinate space, so the stroke keeps drawing across the seam — it stays
  anchored to the starting image and extends over the following images via
  the overlays' `overflow: visible`. Bounded shapes (rectangle / circle /
  text / dimension / line) still clamp to their starting image.

## [0.6.3] — 2026-06-05

### Changed

- **Marker strokes are stored far more compactly.** A marker now keeps a
  sparse set of RDP-simplified, whole-pixel control points and renders as a
  Catmull-Rom spline through them, instead of a dense smoothed polyline. The
  spline supplies the smoothness, so the result looks the same (smooth,
  following the stroke) while the stored point set shrinks ~5–10× per stroke
  — meaningful for pages with many marker annotations. Markers from earlier
  versions still render. Control-point density is tunable via `SIMPLIFY_PX`
  in `_smoothStroke`.

## [0.6.2] — 2026-06-05

### Changed

- **Markers draw as smoothed point strokes instead of fitted bezier
  curves.** A marker now keeps the path you actually drew (pixel-accurate)
  and gets a light cleanup on release — a small RDP denoise plus Chaikin
  corner-cutting — so finger / mouse jitter reads as clean curves while
  still following the stroke. Markers stay fully styleable (color /
  thickness / opacity / dash) and selectable (click or box-select), but no
  longer expose the bezier pen editor; reshaping a marker by dragging
  anchors / handles isn't supported. Freehand keeps its fitted, node-
  editable vector curve. Markers drawn in 0.6.0–0.6.1 (stored as `nodes`)
  still render. Smoothing strength is tunable via `_smoothStroke`.

### Fixed

- `_shapeBBoxImagePx` flattens both stroke formats, fixing box-select and
  bounding-box math for point-based markers and legacy `{points}`
  freehand (it previously read `.x` / `.y` off `[x, y]` tuples → `NaN`).

## [0.6.1] — 2026-06-05

### Added

- **`readonly` annotation flag.** An annotation with `readonly: true` — a
  top-level field alongside `uuid` / `kind` / `geometry` / `style` /
  `metadata`, defaulting to `false` — still renders and responds to hover
  and tooltip-pin, but skips edit mode, drag-to-move, color pickup, the
  tooltip's delete button, the eraser, marquee + shift box-select, and the
  pen editor. Clicking a locked shape in annotation mode pins its tooltip
  (the browse-mode behavior) instead of selecting it.
  `setShapeReadonly(uuid, bool)` flips the lock at runtime. The flag is
  **render-only** — it's never echoed in `etcher:annotations-changed`, so
  consumers recompute it from their own ownership data each render — and
  the `.etcher-shape` element carries `data-readonly="true"` for styling.
  It's a generic per-shape lock: Etcher has no user/ownership model, and it
  is **not** a security boundary — keep your server-side filter on save.

## [0.6.0] — 2026-06-04

### Added

- **Freehand is now a vector curve tool with a pen editor.** A stroke is
  simplified (Ramer–Douglas–Peucker) and fitted (Schneider's algorithm,
  the one Paper.js uses) into a sparse run of cubic-bezier nodes on
  release, stored as `geometry.nodes` and rendered as an SVG `<path>`.
  Selecting a stroke opens the editor: drag **anchors** and their
  **bezier handles**, **double-click the curve** to insert a node, select
  a node and press **Delete** to remove it, **double-click an anchor** to
  toggle corner (independent handles) ⇄ smooth (mirrored, equal-length
  handles). Legacy `{points}` freehand still renders.
- **Marker tool** — a freeform stroke rendered thick, opaque, round-capped
  in the selected color, with the same simplify-and-fit pipeline and full
  pen-editor parity. Each stroke carries its appearance
  (`color` / `width` / `opacity` / `dash`) in `style`; thickness is
  zoom-anchored (scales with the image like ink). The tool stays armed for
  several strokes in a row.
- **Grabber (hand) tool** — pan-only navigation, like Photoshop/Affinity.
  The overlay stays click-through so a drag pans Fresco, and shape
  hover/selection is suppressed while it's active. Grouped beside the
  cursor.
- **Marquee box-select on the cursor tool.** Drag empty canvas to select
  every shape the marquee touches (Shift extends the group); the group
  feeds the existing multi-select move / delete. Drag-pan is locked in
  cursor mode (panning now lives on the grabber); wheel/pinch zoom still
  work.
- **Parameters button** (line thickness / opacity / dash) replaces the
  palette `[⋯]`. It sets the global default for every new stroke shape
  (rectangle, circle, polygon, freehand, marker); with a shape — or a
  multi-selection — selected it edits those live, with undo.
- **Multi-selection styling** — color and line params apply across a
  box/shift selection at once.
- **Color pickup on select** — selecting a shape switches the toolbar's
  active color to that shape's color (activating a matching swatch, or
  eyedropping into the active slot).

### Changed

- **The palette `[⋯]` is now the Parameters button; the hue picker opens
  from the swatches.** Click the active swatch again, or double-tap any
  swatch, to edit that color. The colors popup still holds the hue ring,
  presets, and overflowed slots.
- Shape tooltips are suppressed while the marker tool is active so they
  don't sit over what you're drawing.

### Fixed

- Markers no longer collapse to a 3px line on hover/select (thickness is
  applied as an inline style so the state-class rules can't override it).
- The pen editor's anchors, handles, and tethers recolor live when the
  shape's color changes, instead of waiting for a reselect.
- Clicks on Etcher's own toolbar / popups no longer clear the selection or
  drop a shape out of edit mode (an empty-canvas press was being read as a
  box-select).
- `_shapeBBoxImagePx` for polygons read `.x` / `.y` off `[x, y]` tuples and
  produced a `NaN` bbox — used by box-select and multi-image routing.

## [0.5.5] — 2026-06-03

### Changed

- **Toolbar overflow now splits space evenly between the tools and the
  color swatches.** The old lockstep collapse left the drawing tools
  with the lion's share (~70/30); the bar now sheds whichever group is
  currently wider, converging to a ~50/50 split as it narrows. Each
  group always keeps its selected item.
- **Undo / redo collapse as a single unit.** They sit inline whenever the
  bar fits, but the moment it runs short both fold into the tools `[⋯]`
  popup together — before any individual tool — and pop back out as a
  pair when there's room again.
- **The colors `[⋯]` wears a palette icon** instead of the generic
  overflow dots, so it reads as the picker.
- A 32px gutter is kept on each side: the bar collapses a control into
  the menus before reaching the viewer edges rather than touching them.

### Added

- **Overflowed color slots are reachable in the colors popup.** When the
  customizable swatches don't all fit on the toolbar, the collapsed ones
  appear in a row above the preset colors; picking one selects it (it
  pins back onto the bar) without closing the picker.

### Fixed

- **The colors popup stays open until an outside click.** Choosing a
  preset or an overflowed slot, or dragging the hue ring / lightness
  slider, no longer dismisses it — only clicking outside (or re-toggling
  the trigger / exiting annotation mode) closes it.

## [0.5.4] — 2026-06-03

### Added

- **Fixed editable color slots + `colors-changed` save hook.** Replaces
  the MRU recent-colors model with 5 fixed, editable slots: clicking a
  slot selects it; editing via the hue picker / popup presets overwrites
  that slot in place (no reordering, no localStorage). The palette seeds
  per-layer from the new `:colors` attr on `Etcher.layer`, then
  `extensions.etcher.colors`, then presets. Every committed edit fires
  `etcher:colors-changed` on two channels (LiveView `pushEvent` +
  bubbling `CustomEvent`) so the consumer owns persistence — Etcher
  stores nothing. Adds `getColors` / `setColors` / `setSlotColor` to the
  layer API.

### Fixed

- **The colors `[⋯]` is now always visible.** It's the permanent entry
  to the hue-wheel picker, not a swatch-overflow indicator, but it was
  gated on `.is-active` (overflow) — so when the palette fit inline it
  vanished, leaving hosts (e.g. PhoenixKit's media browser) with no way
  to open the picker. The tools `[⋯]` stays overflow-gated and now lights
  only when a tool is actually hidden (never for undo/redo alone), via a
  `_computeToolbarOverflow` / `_syncToolsPopup` split.

## [0.5.3] — 2026-05-28

### Fixed

- **Strip mode silently dropped shapes on pages appended after mount.**
  `_onResize` (the universal re-sync path wired to window `resize`,
  `orientationchange`, and the strip's `image-loaded` event) refreshed
  layout for existing overlays but bailed for pages added to the
  container after the initial `_buildStripOverlays` pass. Multi-
  chapter infinite-scroll readers that fetch the next chapter's
  `<img>`s on demand were the canonical break: drawing tools fell
  through (no overlay to receive the gesture) and `addShape` /
  `addShapes` for the appended pages rejected with
  `[Etcher] addShape: strip mode requires a valid image_idx. …`.
  `_onResize` now builds overlays for newly-discovered pages.
  Extracted a single `_buildStripOverlay(page)` helper shared by
  mount-time iteration and the post-mount resync.

### Added

- **`layer.refreshPages()`** — public strip-mode method to force the
  same re-sync the window-`resize` / `image-loaded` listeners use.
  Useful for consumers that hydrate the next chapter's annotations
  immediately after appending its `<img>`s and want overlays in place
  before the first `addShape` call, rather than leaning on the
  synthetic-resize side-channel. No-op on canvas hosts.

## [0.5.2] — 2026-05-28

### Fixed

- **Shape hover/click inside daisyUI `.modal-open` host.** When Etcher
  was rendered inside a `<div class="modal modal-open">`, the doc-level
  `isInputOwner` gate matched the surrounding modal and short-circuited
  hover, click, double-click, and outside-click for every shape kind
  that relies on the global doc-fallback (rectangle, circle, polygon,
  freehand, callout, line shaft). `text` and `dimension` were unaffected
  because their per-element listeners bypass the gate. The check now
  ignores input-owner ancestors that **contain** the layer's own overlay
  — only ancestors layered *over* the Etcher canvas still suppress
  interaction, restoring the original intent.

## [0.5.1] — 2026-05-25

### Added

- **`layer.shapeAt(pt)`** — public hit-test API. Returns the top-
  most shape descriptor (`{uuid, kind, geometry, image_idx?,
  image_id?, style, metadata}`) under `pt`, or `null`. Strip
  handles take `pt = {imageIdx, x, y}` in source-pixel space;
  canvas handles take `pt = {x, y}` in canvas-pixel space.
  Wraps the existing internal `_shapeAt` so consumers wiring
  custom tap-zone navigation (left-third = previous page,
  right-third = next page, sidebars, mini-maps) can defer to
  Etcher's per-kind hit-test instead of re-implementing one per
  shape kind (rectangle / circle / polygon / freehand / …).
  Pairs with `fresco 0.6.3`'s suppress-tap fix — most consumers
  don't need this if they rely on `data-fresco-suppress-tap`,
  but custom tap handlers that bypass Fresco's tap-bus do.

### Compatibility

- Pure additive — no existing API changed.

## [0.5.0] — 2026-05-24

Deep-linking release. Collapses the ~60 lines of consumer JS each
"find this annotation in context" flow used to need (poll for the
shape, scrape DOM data-attrs for the host image, translate coords,
call the right handle method, optionally flash the shape) down to
a single `layer.revealShape(uuid, { pulse: true })` Promise.

### Added

- **`layer.getShape(uuid)` / `layer.getShapes()` carry the host-
  image identifier.** The returned descriptor now includes
  `image_idx` (strip mode) or `image_id` (canvas multi-image)
  when applicable — either field is present iff that handle mode
  is in use; both omitted for single-image canvas. Consumers
  routing UI to a shape no longer need to scrape
  `data-image-idx` / `data-image-id` off the SVG. Fully additive
  to the existing `{ uuid, kind, geometry, style, metadata }`
  shape.
- **`layer.revealShape(uuid, opts)` is now Promise-returning** and
  polls for late-mounted shapes (chapters that hydrate on scroll,
  async annotation backfills) for up to `opts.timeout` ms
  (default `10000`). Resolves with
  `{ uuid, image_idx?, image_id?, scrollTop?, cameraBounds? }`
  as soon as the underlying scroll / `fitBounds` call has been
  issued; rejects with `{ reason }` on timeout or handle failure.
- **`align` option** on `revealShape` for strip mode:
  `"center" | "top" | "bottom"` (default `"center"`). Lets
  callers pin the shape to a specific edge of the viewport — e.g.
  align to top when a fixed bottom comment-modal would otherwise
  occlude the shape.
- **`pulse` option** on `revealShape`: a brief halo flash
  (`.etcher-shape--pulse` keyframe animation, 1.5s default,
  configurable via `pulseDuration`). Helps users spot the just-
  navigated-to shape against a busy page.
- **`etcher:shape-revealed` DOM event** fires on the layer host
  with the same payload as the resolved Promise. LiveView hooks /
  consumer event-bus listeners can react to reveals without
  owning the Promise — useful when the deep-link handler lives
  somewhere other than where `revealShape` was called.

### Docs

- New **Coordinate spaces** section in `Etcher.Layer` moduledoc
  explaining the strip-mode source-pixel vs canvas-mode canvas-
  pixel distinction. Consumers persisting shape positions outside
  of Etcher (mini-maps, server-side analytics, deep-link routes)
  need to know which space their geometry is in. The "Programmatic
  API" section now shows the descriptor shape with `image_idx` /
  `image_id` and the `revealShape` Promise + pulse pattern.

### Compatibility

- `layer.revealShape` returning a Promise instead of a boolean is
  the one consumer-visible change. Callers that did
  `if (handle.revealShape(uuid)) { ... }` will hit the truthy-
  Promise gotcha — a Promise is always truthy. In practice the
  only caller in the wild is consumer deep-link code, and the
  Promise return is the actual asked-for change. Migrate to
  `revealShape(uuid).then(...)` / `await revealShape(uuid)`.
- Fully back-compat for `getShape` / `getShapes` — added fields
  only.

## [0.4.12] — 2026-05-24

### Changed

- **`mix.exs` `:fresco` dep constraint relaxed** to
  `"~> 0.5.9 or ~> 0.6.0"` so Etcher resolves against both the
  current `fresco` 0.5.x and the strip-extracted `fresco` 0.6.0.
  No code changes — Etcher's strip-renderer detects handles at
  runtime via `"scrollTo" in handle` and works identically
  whether the strip handle was registered by `fresco <= 0.5.9` or
  by the new `fresco_strip` package.

### Note

Strip mode is moving to the standalone
[`fresco_strip`](https://hex.pm/packages/fresco_strip) package
in `fresco 0.6.0`. If you use `<Fresco.scroll_strip>` (now
`<FrescoStrip.viewer>`), add `{:fresco_strip, "~> 0.1.0"}` to
your deps alongside `{:fresco, "~> 0.6.0"}`. Both packages
contribute handles to the same `window.Fresco.viewerRegistry`,
so Etcher finds them uniformly.

## [0.4.11] — 2026-05-24

Polishes touch-and-tooltip UX on `<Fresco.scroll_strip>` hosts +
plumbs into Fresco 0.5.9's tap-suppression hooks so consumer tap-
zone navigation no longer races etcher's shape interactions.
Backwards-compatible — every fix is either purely additive (new
API surface) or scoped to the broken state.

### Requires Fresco ~> 0.5.9

The `data-fresco-suppress-tap` shape-attribute and
`handle.suppressNextTap(...)` call paths only engage when paired
with Fresco 0.5.9+. The etcher.js side guards the latter with
`typeof handle.suppressNextTap === "function"` so older Fresco
silently degrades (no crash, but the iOS tap-race fixes don't
activate). The dep constraint in `mix.exs` is bumped to make
the requirement explicit.

### Fixed

- **Strip-mode tooltip lands at the right position when the
  container is scrolled.** `_showTooltipFor` now adds the
  container's `scrollLeft` / `scrollTop` when computing the
  tooltip's `style.top` / `style.left`. The tooltip is
  `position: absolute` inside the relatively-positioned scroll
  container, so its coordinates are interpreted in CONTENT space
  — without the scroll offset, every tooltip past the first
  viewport-worth of content landed `scrollTop` px above the
  visible area. Canvas-mode containers don't scroll (they pan
  via CSS transform) so `scrollTop` stays 0 and the addition
  is a no-op there — no per-mode branching.
- **Tooltip hover-bridge race on first show.** After
  `_showTooltipFor`, a 250 ms grace window suppresses the next
  `_scheduleHideTooltip` call. Without it, iOS Safari's
  synthesized mousemove (which lands on the just-shown tooltip,
  not the originating shape) fires `_setHoveredShape(null)` →
  `_scheduleHideTooltip` before the tooltip's own `mouseenter`
  cancellation runs, so the tooltip flashed visible then hid in
  the same frame.
- **Touch-drag of vertex / midpoint handles + edit-mode shape
  body** no longer fights the strip container's native scroll
  on mobile. New CSS rule applies `touch-action: none` to
  `.etcher-handle`, `.etcher-handle-midpoint`, and
  `.etcher-shape.is-editing` / `.is-moving` — defers iOS's
  scroll-vs-app classification long enough for `setPointerCapture`
  to claim the gesture. Scoped to interactive states so static
  shapes don't block native scroll past them.

### Added

- **`handle.tooltip()`** on the public layer API. Returns the
  currently-shown tooltip's `{shape, pinned}` or `null`. The
  `shape` field is the same `{uuid, kind, geometry, style?,
  metadata?}` descriptor `getShape` returns. Lets consumers
  driving custom chrome react to "user opened the tooltip on
  shape X" without scraping the DOM. The raw `tooltipEl` is
  intentionally not exposed.
- **`handle.repositionTooltip()`** on the public layer API. Re-
  anchors the currently-shown tooltip to its shape. No-op when
  no tooltip is up. Useful after a consumer-driven layout
  change (toggling a side panel, adjusting strip padding) has
  drifted the tooltip from its anchor.
- **`data-fresco-suppress-tap`** on every `.etcher-shape`
  element (set by both `_finalizeShape` and `_renderAnnotation`).
  Fresco 0.5.9+ probes for this attribute under the tap point
  via `document.elementsFromPoint` and skips the `tap` emit, so
  tapping an existing annotation pins the tooltip without
  bubbling to consumer-side tap-zone navigation. Older Fresco
  versions ignore the attribute entirely (no behavior change).
- **`handle.suppressNextTap(250)` call after every shape-commit**
  (inside `_finalizeShape`). Closes the synthesized-tap-after-
  drag race that would fire a consumer's tap-zone navigation
  immediately after the user finished drawing a shape. Guards
  on `typeof handle.suppressNextTap === "function"` so older
  Fresco versions silently no-op.

## [0.4.10] — 2026-05-23

### Added

- **`handle.addShape(payload)` / `handle.addShapes(payloads)`** on
  the public layer API. Splices one or more shapes into a
  live-mounted layer without remounting — preserves the active
  tool, color selection, multi-selection, undo stack, and any
  pinned tooltip. Useful for multi-chapter strip readers that
  fetch the next chapter's annotations on scroll, or canvas
  hosts that grow with new images at runtime.

  The payload mirrors the persisted-annotation shape used by
  `etcher:annotations-changed`:

      {
        uuid?:      "01HXY...",          // optional; generated if omitted
        kind:       "rectangle",
        geometry:   { ... },
        image_idx?: 17,                  // strip mode (REQUIRED)
        image_id?:  "page-3",            // canvas multi-image (auto-resolved
                                          //  from centroid when omitted)
        style?:     %{ color: "..." },
        metadata?:  %{ ... }
      }

  `addShape` returns the shape's uuid (or `null` on validation
  failure — strip mode requires a valid `image_idx`).
  `addShapes` returns an array of uuids in input order with any
  rejected payloads filtered out.

  Multiple sibling `addShape` / `addShapes` calls scheduled in
  the same microtask batch into one
  `etcher:annotations-changed` emit, so the consumer's
  server-sync handler doesn't see a flurry of full-array
  replays.

## [0.4.9] — 2026-05-21

Lets consumers hide Etcher's built-in chrome and wire their own UI
to the same actions. Pure-additive — defaults preserve every
existing consumer's behavior. Pairs naturally with Fresco 0.5.7's
matching `:nav_buttons` empty-list semantics on the viewer side,
though no Fresco upgrade is required.

### Added

- **`:nav_buttons` attr** on `<Etcher.layer>`. Atom list controlling
  which buttons get appended to Fresco's nav column:
  `[:pencil, :visibility]`.

    - `nil` (default) — both enabled.
    - `[]` — both hidden. Consumers wire their own UI to
      `handle.toggleMode()` / `handle.toggleVisible()` (or
      `setMode(true|false)` / `setVisible(true|false)`).
    - A subset list — only those buttons render.

  Mirrors as `data-nav-buttons` on the layer host using the
  `"none"` sentinel for the empty case, matching Fresco's
  convention.
- **`:toolbar` attr** on `<Etcher.layer>` (boolean, default `true`).
  `false` skips building the bottom toolbar entirely. Annotation
  mode still works programmatically — consumers wire their own
  toolbar UI to `handle.selectTool(...)` / `handle.selectColor(...)` /
  `handle.undo()` / `handle.redo()` / `handle.setMode(false)`.

### Programmatic equivalents for every built-in button

The `window.Etcher.layerFor(id)` handle already exposes the
matching primitives — this release just clarifies the mapping so
consumers hiding a built-in button know exactly which method to
call from their replacement UI:

| Built-in button         | Programmatic equivalent                       |
|-------------------------|-----------------------------------------------|
| Pencil (annotation on)  | `handle.setMode(true)` / `toggleMode()`       |
| Visibility (eye)        | `handle.setVisible(true)` / `toggleVisible()` |
| Toolbar — cursor        | `handle.exitDrawing()` / `selectTool(null)`   |
| Toolbar — rectangle…    | `handle.selectTool("rectangle")` (etc.)       |
| Toolbar — undo / redo   | `handle.undo()` / `handle.redo()`             |
| Toolbar — color swatch  | `handle.setColor("#hex")`                     |
| Toolbar — close (×)     | `handle.setMode(false)`                       |

All seven were already on the API surface; this entry just gives
consumers building their own chrome a single place to find the
mapping.

## [0.4.8] — 2026-05-21

### Fixed

- **Pre-0.4.7 canvas shapes now get their `image_id` backfilled on
  hydration**, closing the gap where annotations persisted before
  0.4.7 still ghost-rendered into adjacent viewport bands on
  multi-image `<Fresco.canvas>` hosts. Older payloads had no
  `image_id` field, so 0.4.7's `_applyImageVisibility` filter
  couldn't tell which page they belonged to and left them
  unconditionally visible.

  `_renderAnnotation` now runs the same centroid hit-test that
  draw-time uses (`_resolveCanvasImageId`) for any canvas-mode
  annotation that hydrates without an `image_id`. The full
  hydration pass batches its work and `_renderInitial` emits one
  `etcher:annotations-changed` after the loop — so the consumer
  persists the new ids once, not per shape, and the next mount
  reads them straight from `ann.image_id` without re-running the
  lookup. Single-image canvases (where `getImages().length < 2`)
  and shapes that already carry an `image_id` skip the branch.

  Shapes that sit in empty canvas margin (not over any image)
  stay untagged — matching draw-time behavior. A freeform note
  between two pages isn't owned by any page, so it stays visible
  regardless of which image is hidden.

## [0.4.7] — 2026-05-21

### Requires Fresco ~> 0.5.5

The visibility-mirroring fix below relies on Fresco 0.5.5's new
`image-visibility-change` event + `getHiddenImageIds()` snapshot.
Older Fresco gracefully degrades (the wiring no-ops; shapes still
leak into hidden-image bands as before).

### Fixed

- **Shapes on a hidden image no longer leak into adjacent viewport
  bands on multi-image `<Fresco.canvas>` hosts.** Paged readers,
  spreads, and lookbooks lay every page out side-by-side on one
  canvas and call `handle.setImageVisible(id, false)` to hide the
  non-active pages. Before this release, the page imgs were
  hidden but their Etcher shapes stayed visible — ghost-rendering
  inside the surrounding canvas-space the host exposes via
  page-padding bands.

  Etcher now subscribes to Fresco's `image-visibility-change` and
  toggles `display: none` on shapes whose `image_id` is in the
  hidden set (plus their title satellites). Hidden shapes that
  were being edited drop out of edit mode; hidden shapes with a
  pinned tooltip unpin — both states would otherwise float with
  no visible anchor.

### Added

- **`image_id` field on canvas-mode annotations.** When a shape is
  finalized on a multi-image canvas (`handle.getImages().length > 1`),
  its centroid is hit-tested against every image rect and the
  matching id is recorded on `shape.image_id` + emitted in
  `etcher:annotations-changed`. Shapes that land in empty canvas
  space (between images, in an unallocated region) get no
  `image_id` and behave like always — visible regardless of any
  image's visibility. Single-image canvas consumers are
  unaffected: the `length > 1` gate skips the lookup entirely, so
  no `image_id` is emitted.

  Hydrated annotations with `image_id` round-trip cleanly through
  the LiveView — Etcher reads it from `ann.image_id` in
  `_renderAnnotation` and tags the new DOM element with
  `data-image-id` for consumer CSS hooks.

## [0.4.6] — 2026-05-21

### Fixed

- **Touch taps after a finger-move no longer re-grab the previously-
  moved shape.** `_docPointerDown` now hit-tests fresh on every
  `pointertype === "touch"` event instead of trusting
  `_hoveredShape`. iOS synthesizes a `mousemove` at the
  `touchend` point after every gesture, which fires
  `_docMouseMove` and leaves the hover cache pinned to the last-
  touched shape — making the *next* tap re-select that shape
  regardless of where the finger actually landed. Mouse / pen
  events still consult the cache (it's accurate there) and fall
  back to a fresh hit-test only when it's empty.

## [0.4.5] — 2026-05-21

### Fixed

- **Cursor-mode finger-drag on a shape in `<Fresco.scroll_strip>`
  now moves the shape instead of scrolling the page.** Strip
  `_wireStripPointerInput` adds a `touchstart` listener that
  hit-tests the touch point and calls `preventDefault()` only when
  the finger lands on an existing shape — defers iOS's
  scroll-vs-app classification long enough for `pointerdown` +
  `setPointerCapture` to claim the gesture for the move handler.
  Every other tap (empty area, between pages, etc.) still scrolls,
  so the reader can navigate the chapter without exiting
  annotation mode.

  Sibling to 0.4.4's `touch-action: none` fix, but scoped to
  cursor mode where blanket-disabling `touch-action` would break
  reader navigation. `{ passive: false }` on the listener so
  `preventDefault` actually overrides the scroll classification.

## [0.4.4] — 2026-05-21

### Fixed

- **Finger-drawing on iOS Safari in `<Fresco.scroll_strip>` mode no
  longer commits a single oversized shape spanning finger-down to
  finger-up.** The strip container now picks up
  `touch-action: none` while annotation mode is on AND a drawing
  tool is active, so iOS hands every `touchmove` to the app
  instead of classifying the gesture as scroll at `touchstart` —
  too early for `pointerdown`'s `preventDefault` to override.
  Cursor mode (no drawing tool) keeps `touch-action: auto` so the
  reader can still scroll the chapter to reach existing shapes.

  The `.etcher-strip-drawing` class was already toggled on the
  strip container in `_selectTool` for the crosshair cursor and a
  consumer-CSS hook; this release adds the matching
  `touch-action: none` rule to Etcher's injected stylesheet.

## [0.4.3] — 2026-05-20

**Mobile-friendly toolbar + custom color picker + multi-select +
polygon vertex deletion.** A round of UX features that turn the
annotation surface from "works on desktop" into "comfortable on a
phone with a real workflow." Backwards-compatible: no API breakage,
no consumer changes required.

### Added

- **Progressive-overflow toolbar.** A `ResizeObserver` on the viewer
  container drives a layout pass that walks tools and swatches in
  lockstep and collapses the rightmost non-active items into one of
  two new `[⋯]` overflow popups (`tools`, `colors`) as the
  container narrows. Tools and swatches shrink in alternation so
  the row stays visually balanced; once both groups are exhausted,
  `undo` / `redo` collapse together as the final step (still
  reachable from the bottom of the tools popup under a hairline).
  The active tool / swatch is pinned and never collapses.
- **Custom color picker.** The colors popup now hosts a 132 px hue
  ring + 120 px lightness slider + preview chip. Press + drag on
  either canvas commits live via `_selectColor` (in-flight drafts
  and edits update under the finger); the final color pushes to
  recents on `pointerup`. Saturation is fixed at 100 %.
- **Recent custom colors.** Up to 5 picks are persisted to
  `localStorage` under `etcher.recentColors` (MRU, dedup +
  move-to-front on re-pick). The toolbar's inline swatch row now
  reflects this list — new users see the static preset palette,
  and once they pick anything the row transitions to their actual
  usage. Presets backfill any unused slots so the toolbar is never
  empty.
- **Canvas-frequent bootstrap.** When `_recentColors` is empty but
  the canvas already has annotations (a hydrated `.fresco` file, a
  manga chapter with persisted comments), the inline toolbar
  derives from the top 5 most-used colors on existing shapes —
  inferred from `style.color` frequencies. Once the user picks any
  color, recents takes over and the inferred palette stops
  contributing.
- **Shift-click multi-select.** In annotation cursor mode,
  `Shift+click` toggles a shape in/out of `selectedShapes`. The
  group can be dragged together (image-px delta applied uniformly,
  title boxes translate too) or deleted with a single
  `Backspace`/`Delete` under one `bulk_delete` undo entry + one
  `etcher:annotations-changed` emit. Selection clears on empty-
  canvas click, drawing-tool select, or annotation-mode exit.
- **Polygon vertex deletion.** While a polygon is in edit mode,
  clicking a vertex (no drag) highlights it red; `Backspace`/
  `Delete` splices the selected vertices out of `geometry.points`
  and re-renders. `Shift+click` extends the vertex selection.
  Falls through to whole-shape delete if the removal would leave
  fewer than 3 vertices.
- **`Etcher.registerInputOwnerSelector(selector)`** on the global
  `window.Etcher`. Append a CSS selector to the input-owner escape
  list for non-conventional overlays that don't match the built-in
  modal / dialog / tooltip / handle defaults. Idempotent.

### Changed

- **Default active color** now snaps to whatever lands as the
  leftmost toolbar swatch on first paint, not the legacy preset
  blue. Once the user picks anything, `_pushRecentColor`'s
  move-to-front keeps `activeColor` in agreement with the leftmost
  slot — so "what's highlighted" always matches "what will draw."
- **`etcher:annotations-changed` payload** carries a `fresco_id`
  key alongside `annotations` so a LiveView hosting multiple
  `<Etcher.layer>` instances can pattern-match the source.
- **Doc-level hit-test handlers** (`_docPointerDown`,
  `_docDblClick`, `_outsideClickHandler`,
  `_titleOutsideClickHandler`, `_tooltipOutsideClick`,
  `_docMouseMove`) route through a shared `isInputOwner(target)`
  helper instead of inline selector lists. Adding `.etcher-popup`
  to the input-owner set means the new picker popups don't tear
  down their own state.

## [0.4.2] — 2026-05-20

### Fixed

- **Clicks inside consumer-owned modals no longer fall through to
  shapes behind them.** Etcher's doc-level hit-test handlers
  (`_docPointerDown`, `_docDblClick`, `_outsideClickHandler`,
  `_titleOutsideClickHandler`, `_tooltipOutsideClick`, and the
  hover-tracker `_docMouseMove`) now skip events whose target is
  inside a standard modal / dialog. Three selectors are recognized
  out of the box:

  - `dialog[open]` — native HTML5 `<dialog>` shown via `.showModal()`
    or `.show()`
  - `.modal-open` — daisyUI / Bootstrap convention
  - `[role='dialog']` — ARIA-compliant custom modals

  Previously, tapping a button inside a modal that sat over the
  viewer would shadow the button's own handler and pin / move /
  select the shape underneath instead. Consumers shipping a comment
  composer, settings sheet, share dialog, or confirmation prompt
  layered over a Fresco viewer can now drop their per-modal
  `pointerdown` / `stopPropagation` shims.

### Added

- **`Etcher.registerInputOwnerSelector(selector)`** on the global
  `window.Etcher`. Append a CSS selector to the input-owner escape
  list for non-conventional overlays that don't match the three
  defaults. Idempotent — re-registering the same selector is a
  no-op. Affects every doc-level Etcher handler immediately on the
  next event.

  ```js
  window.Etcher.registerInputOwnerSelector(".my-custom-overlay");
  ```

## [0.4.1] — 2026-05-20

Closes strip-mode parity gaps flagged by the consumer reader on top of
0.4.0. Most issues collapsed to two missing wires; a couple needed
small fresco-side help (`getImages()` now reports horizontal layout +
prefers live natural dims — see Fresco 0.5.4).

### Requires Fresco ~> 0.5.4

The overlay-positioning fix below relies on Fresco 0.5.4's enriched
`getImages()` (added `left` / `width`, switched `naturalWidth` /
`naturalHeight` to prefer loaded bitmap dims over consumer-passed
`sources` hints). Older Fresco gracefully falls back to the 0.4.0
behavior (overlay pinned to container width).

### Fixed

- **Shape hover + tap now work on strip.** `_initStripRenderer` was
  missing the `_wireGlobalShapeListeners()` call canvas mode has. The
  doc-level listeners already understand strip's `{imageIdx, x, y}`
  coords (since `_shapeAt` filters by `pt.imageIdx`), so wiring them
  in unlocks: tooltip on hover, `.is-hovered` styling, `_onShapeTap`
  in browse mode (pin tooltip → fires `etcher:tooltip-pin`), and
  `_enterEditMode` on shape click in annotation cursor mode (no
  drawing tool active). No consumer-side hover/tap workarounds
  needed.
- **Toolbar stays in view while scrolling.** Strip-mode toolbar gets
  a `data-strip` attribute and a `position: fixed` CSS rule so it
  anchors to the viewport instead of the scroll container (which IS
  the scrolling element in strip mode and was carrying the toolbar
  off-screen).
- **Overlays size to each image, not to the container.**
  `_buildStripOverlays` and `_onResize` now read `left` / `width`
  from `getImages()` per image, so consumer-side horizontal padding
  or centered narrow pages render correctly. Previously every
  overlay was hardcoded to `left: 0; width: 100%`, stretching shapes
  to fill the container width.
- **viewBox refreshes on resize / image-load.** `_onResize` (which
  also fires on Fresco's `image-loaded` event) now refreshes each
  overlay's `viewBox` from the current `naturalWidth` /
  `naturalHeight`. Combined with Fresco 0.5.4 preferring loaded
  bitmap dims, consumers who patch `sources[i]` after the bitmap
  arrives no longer end up with stale-ratio viewBoxes that distort
  geometry.
- **No more momentary stretch on layout mismatches.** The overlay
  SVG's `preserveAspectRatio` is now the default (`xMidYMid meet`),
  which letterboxes if there's a brief mismatch between the
  element's box and the viewBox (during load / aspect-ratio
  correction / padding changes). Previously `"none"` would stretch
  shapes during those windows as a user-visible flash of distorted
  geometry. Trade-off: shapes don't perfectly fill the element
  during the mismatch — but a momentary letterbox is strictly
  better UX than a momentary stretch.

### Added

- **`_applyStripOverlayLayout(svg, page)`** internal helper: shared
  by mount + resize paths so viewBox / position / size always
  refresh together. Universal re-sync entrypoint is still
  `window.dispatchEvent(new Event("resize"))` — same hook the
  browser uses on its own. Consumers who mutate `<img>` layout via
  CSS (toggling a padding slider, swapping an aspect-ratio class)
  should dispatch a resize event to nudge etcher to re-query.

## [0.4.0] — 2026-05-20

**`<Fresco.scroll_strip>` support.** Etcher now renders on strip-format
viewers (vertical-scroll manga/manhwa, long-form web comics) with the
same UX surface canvas mode has — pencil button, toolbar, hover
tooltips, undo/redo, hydration from `extensions.etcher`. Pure-additive
on the consumer side: the existing `<Etcher.layer>` mounts unchanged
and dispatches strip vs canvas internally based on the Fresco handle
shape.

### Requires Fresco ~> 0.5.3

Strip mode relies on `handle.getExtension("etcher")` and
`handle.getImages()` (both added in Fresco 0.5.3). Mixing Etcher 0.4
with an older Fresco prints a console warning and skips hydration but
otherwise no-ops cleanly.

### Added

- **Strip renderer.** `<Etcher.layer>` inspects the Fresco handle at
  mount and picks between two renderers: the existing canvas renderer
  (one SVG overlay spanning the whole canvas) and a new strip renderer
  (one SVG sibling per image, sized to each image's `offsetTop` /
  `offsetHeight`, with `viewBox` set to natural pixel dimensions so
  geometry stored in image-px renders 1:1 without any per-frame coord
  math). Native browser scroll moves overlays with their images for
  free.
- **Per-image annotations.** Strip shapes carry an `image_idx` field
  (the page they live on), pushed in the `etcher:annotations-changed`
  payload and round-tripped through `extensions.etcher`. Canvas-mode
  payloads are unchanged — `image_idx` is strip-only.
- **`handle.revealShape(uuid, opts)` on the layer API.** Scroll a
  strip to center a shape's bbox in the viewport (or call
  `handle.fitBounds` on the shape's bbox in canvas mode). `opts`:
  `{behavior: "smooth" | "instant", padding: <natural-px>}`. Returns
  `true` if the shape was found and a reveal action was issued.
  Useful for "click a comment thread → jump to the page it's on"
  flows.
- **Touch-native tap-to-select.** `_docPointerDown` now hit-tests
  directly on pointerdown when no shape is currently hovered.
  Previously, devices without hover (mobile Safari / Chrome on
  Android) never populated `_hoveredShape`, so finger-tapping a shape
  never pinned its tooltip — fixed for canvas and strip alike.
- **Per-page click + drag locking.** When the user starts drawing on
  image #3, a `pointermove` that wanders into image #4 is clamped to
  image #3's screen rect — the resulting shape stays anchored to the
  page it was started on. Polygon and callout multi-click flows lock
  the same way: clicks outside the starting page are ignored.
- **Strip-mode `crosshair` cursor** on the scroll container while a
  drawing tool is active, plus an `etcher-strip-drawing` class hook
  for consumer CSS that wants to restyle native scrollbars or hide
  page chrome while drawing.

### Changed

- **`_init` dispatch.** The mount-time init split into
  `_initCanvasRenderer(handle)` and `_initStripRenderer(handle)`.
  Detection: `"scrollTo" in handle && typeof handle.scrollTo === "function"`
  → strip; `typeof handle.getCanvasSize === "function"` → canvas;
  anything else logs a warning and bails. Consumers driving the layer
  via `window.Etcher.layerFor(...)` see the same `api` either way.
- **`_shapeAt(pt)`** filters hit-tests by `pt.imageIdx` in strip mode.
  Without the filter, a shape on image 2 with bbox
  `{x: 100, y: 200, w: 50, h: 50}` would falsely match a click at
  the same image-px coordinates on image 5. Canvas mode is
  unaffected.
- **`_finalizeShape` / `_renderAnnotation`** stamp `data-image-idx`
  on the shape's `<g>` / `<rect>` / `<polygon>` element in strip mode
  for DOM-level debugging + consumer CSS hooks.
- **`mix.exs`** dep pinned to `{:fresco, "~> 0.5.3"}` (was `~> 0.5`).

### Why now

The consumer reader was migrating their long-form manhwa chapters
from `<Fresco.canvas>` (paged, one image at a time) to
`<Fresco.scroll_strip>` (vertical scroll, all pages stitched) but
couldn't bring Etcher with them — strip's handle missed the surface
canvas had, and Etcher's geometry model assumed a single canvas-pixel
coord space. Fresco 0.5.3 closed the handle-side gap; this release
closes the Etcher-side gap.

## [0.3.0] — 2026-05-19

**Major rewrite.** Etcher now plugs into `<Fresco.canvas>`'s
`extensions.etcher` blob instead of a separate Ecto table. Annotations
live in the `.fresco` file alongside the image layout, so a single
`Fresco.Canvas.write!/2` saves the entire scene — no more scattered
DB rows.

### Requires Fresco ~> 0.5

Etcher 0.2 was OpenSeadragon-coupled (through Fresco 0.3.x). Fresco 0.5
dropped OSD entirely; Etcher's coord transforms (`pointFromPixel`,
`pixelFromPoint`, `world.getItemAt`) port to Fresco 0.5's stable
`handle.screenToImage` / `handle.imageToScreen` / `handle.getCanvasSize`.
The "tile-source axis shift" and "modal-traversal drift" problems that
motivated Etcher's custom OSD-viewport math are gone in Fresco 0.5, so
the bridge math is now four lines instead of a forty-line workaround
with footnotes.

### Removed

- **`Etcher.Annotation` Ecto schema.** Annotations are plain maps inside
  `extensions.etcher`, not DB rows.
- **`Etcher.Storage` behaviour** + `Etcher.Storage.Default` adapter. No
  adapter pattern — one storage path: `Fresco.Canvas.put_extension/3`
  and `Fresco.Canvas.write!/2`.
- **`mix etcher.gen.migration`** task + the `etcher_annotations` table.
- **`:target_type`, `:target_uuid`, `:initial_annotations` attrs** on
  `<Etcher.layer>`. The canvas IS the target; hydration comes from
  `handle.getExtension("etcher")` at mount.
- **`Etcher.create_annotation` / `list_annotations_for` /
  `update_annotation` / `delete_annotation`** defdelegates on the
  `Etcher` module.
- **`etcher:created` / `etcher:updated` / `etcher:deleted` /
  `etcher:selected`** events and the matching `etcher:annotation-saved`
  / `:annotation-removed` / `:annotation-added` /
  `:annotation-updated` / `:exit-drawing` push-events. Replaced by a
  single bulk `etcher:annotations-changed` event.
- **tmp_id ⇄ real-uuid round-trip.** UUIDv7 is generated client-side
  via `crypto.getRandomValues` at draw time; the server never assigns
  ids. The `_pendingTitle` / `_discardOnSave` / `syncLiveUuid`
  deferred-action plumbing all goes away.
- **`OpenSeadragon.Point` references** and the `handle.on("fast-pan")`
  listener. Fresco 0.5's CSS-transform engine doesn't need either.

### Added

- **Hydration from `handle.getExtension("etcher")`** on mount. Initial
  annotations come from the canvas's `extensions` map — the consumer
  loads a `.fresco` file via `Fresco.Canvas.read!/1` and stashes it in
  assigns; Etcher reads it through Fresco's handle.
- **Single bulk event** `etcher:annotations-changed`, payload
  `%{"annotations" => [%{uuid, kind, geometry, style, metadata}, …]}`.
  Consumer's LiveView pipes through `Fresco.Canvas.put_extension(canvas,
  "etcher", %{"version" => "1", "annotations" => annotations})`.
- **`etcher:shape-drawn` event**, payload `%{"uuid", "kind"}`. Fires
  once per `_finalizeShape` call — i.e. on actual user-draw intent.
  Distinct from `annotations-changed` (which fires on every mutation
  including undo/redo of deletes, drags, color picks). Use this when
  a consumer wants to open a composer / inspector keyed on "the user
  just drew a new shape" without false positives.
- **`patchShape(uuid, {metadata, style})` API** on the layer handle.
  Merges the supplied fields into the in-memory shape and re-renders
  so DOM that derives from metadata (dimension labels, callout text,
  title siblings) reflects the patch. Designed for consumers hosting
  the canvas with `phx-update="ignore"` — `handle.getExtension("etcher")`
  freezes at mount, so a full layer remount used to be the only way
  to push server-side state updates.
- **`deleteShape(uuid)` API** on the layer handle. Removes the shape
  from local state + DOM, pushes the deletion onto Etcher's undo
  stack (Cmd+Z restores), and fires `annotations-changed` so the
  consumer's persistence layer catches up automatically.
- **Line annotation tool** — eighth drawing kind. Two-endpoint stroke,
  no arrows, no inline label. Geometry (`{a: [x,y], b: [x,y]}`) and
  edit-handle mechanics shared with `dimension`. Title rides the
  standard sibling-above-shape path (the same movable label group
  rectangle / circle / polygon use).
- **Direct shape drag in annotation cursor mode** — pointerdown on
  any shape's body now immediately starts the move gesture. Stationary
  clicks still select via the no-drag fallback. Doc-level pointer
  routing was extended so shapes with `.etcher-shape { pointer-events:
  none }` wrappers (rectangle, circle, polygon, line, dimension,
  freehand) participate; callout and text were already covered via
  their inner `pointer-events: all` rects.
- **Select-on-grab** — shape enters edit mode the moment the user
  starts a move gesture, not on release. Handles appear immediately
  so drag feels like "select and move" instead of "move then select."
- **Backspace / Delete keyboard shortcut** removes the
  currently-selected shape. Routes through the same `_deleteShape`
  path as the eraser tool, so undo + sync behavior is identical.

### Changed

- **Callout commit flow.** Second-click no longer auto-opens Etcher's
  inline text editor and no longer seeds `metadata.title` with an
  `"Add a title…"` placeholder. Consumers wiring their own composer
  (taking the title via a UI field + creating a linked comment in
  one flow) now get a clean draft to work with — the composer is the
  single edit surface for the title. Re-editing the title later via
  double-click is unchanged.
- **Tooltip placement** flips below the shape when sitting above
  would clip the container's top edge, and clamps horizontally so
  the tooltip stays inside the container near the left/right edges.
  Previously a shape near the top of the viewport had its tooltip
  rendered partially off-screen above the container.

### Unchanged (drawing UX)

The eight drawing tools (rectangle, circle, polygon, freehand,
callout, text, dimension, line) plus the eraser keep their existing
draw + edit mechanics. Hit-testing, undo/redo (⌘Z / ⌘⇧Z / Ctrl+Y),
inline text editor for text shapes, color swatches, tooltips, the
bottom toolbar, the pencil + visibility nav buttons — all preserved.
The new drag-without-tap + select-on-grab + keyboard-delete layers
above these without changing the per-shape draw paths. The ~5000
lines of shape drawing code are substantially unchanged; only the
~200-line Fresco bridge was rewritten.

### Migration from 0.2.x

Consumers on Etcher 0.2 with persisted annotations in
`etcher_annotations` need to migrate. Export the rows you care about:

```sql
SELECT uuid, kind, geometry, style, metadata
FROM etcher_annotations
WHERE target_type = ? AND target_uuid = ?
ORDER BY position;
```

Marshal them into the new `extensions.etcher.annotations` array shape
and stash into the canvas struct:

```elixir
canvas =
  Fresco.Canvas.new(width: 4000, height: 3000)
  |> Fresco.Canvas.add_image(%{src: image_url, x: 0, y: 0, width: 4000})
  |> Fresco.Canvas.put_extension("etcher", %{
    "version" => "1",
    "annotations" => exported_rows
  })

Fresco.Canvas.write!("/path/to/scene.fresco", canvas)
```

Drop the `etcher_annotations` table once migrated. `<Etcher.layer>`
loses its `:target_type` / `:target_uuid` / `:initial_annotations`
attrs in the template — pass just `fresco_id="..."` and optionally
`tools={...}`. The handle_event clauses for `etcher:created`,
`etcher:updated`, `etcher:deleted` collapse into a single
`etcher:annotations-changed` clause.

`<Fresco.viewer>` users need to switch to `<Fresco.canvas>` (use a
canvas with a single image for the same effect) — Etcher 0.3 only
attaches to canvases.

## [0.2.8] — 2026-05-17

Coordinate with Fresco's new CSS-transform pan fast path so
annotations stay anchored to the canvas during the pan window. No
behavior change for consumers on Fresco `< 0.3.0` or for viewers
not opted into `:pan_optimized` — the new subscription is inert
when the event never fires.

### Added

- Subscribe to Fresco's `fast-pan` event (introduced in fresco
  `0.3.0` for the `:pan_optimized` viewer mode). When Fresco emits
  `fast-pan {phase, x, y}` during a fast-path pan, the EtcherLayer
  hook applies the same `translate3d(x, y, 0)` CSS transform to
  its SVG overlay wrapper so annotations, tooltips, and
  foreignObject editors glide in lockstep with the canvas. CSS
  transform propagates to descendants automatically; hit-testing
  follows the visual transform so clicks during fast-pan still
  register on the correct annotation. On `phase: "end"`, the
  transform is cleared — Fresco has restored OSD's drawer and the
  next `animation` tick re-renders the overlay from the committed
  viewport.

### Notes

- Backwards compatible. Older Fresco (`< 0.3.0`) never emits the
  `fast-pan` event, so the new subscription is dead code with no
  overhead. Etcher 0.2.8 works identically against any Fresco
  version it was previously compatible with.
- The subscription is added to the existing `_unsubViewport`
  array, so `destroyed()` cleans it up like the other viewport
  bridges.

## [0.2.7] — 2026-05-15

Documentation + comment cleanup release. No runtime behavior changes
— every existing call site behaves exactly as in 0.2.6. The goal is
to make Etcher visibly **decoupled from any specific consumer** so
that a third-party Phoenix dev reading the source or docs sees a
clean, drop-in library rather than an obvious satellite.

### Changed

- `Etcher.Storage` moduledoc: replaced the "PhoenixKit, for example"
  paragraph with a generic "consumer that pairs every annotation
  with a comment thread" example. The behaviour itself is unchanged
  — only the explanatory prose.
- `lib/etcher.ex` moduledoc: corrected the install snippet
  (`{:fresco, "~> 0.1"}, {:etcher, "~> 0.2"}` — the old version pins
  pointed at non-existent fresco 0.2 / outdated etcher 0.1) and
  expanded the shape list to include `callout, text, dimension`
  rather than only the original four.
- `Etcher.Layer` moduledoc: tools example and "Tools" section now
  include `:eraser`, matching the actual default. Added one line
  explaining how to opt out.
- `priv/static/etcher.js`: four inline comments that named PhoenixKit
  / PhoenixKitComments now describe the generic contract instead
  (any element with `data-annotation-uuid` for cross-component
  highlight; "consumer's annotation-creation UI" / "host apps" for
  extension-point comments). The contracts themselves were already
  generic — only the prose changed.
- `README.md`: corrected the Installation version pins, expanded the
  bottom-toolbar ASCII diagram to show all eight buttons, replaced
  "the four drawing tools" with "seven drawing tools (rectangle,
  circle, polygon, freehand, callout, text, dimension) plus an
  eraser," documented the `EtcherLayer` hook name for explicit
  hook-map wiring, and rewrote the Out-of-scope section to drop a
  stale "v0.1 is draw-and-commit" claim (editing has been supported
  for several releases) and the "four built-ins" reference.
- `CHANGELOG.md`: reworded the 0.2.6 entry to drop the two PhoenixKit
  name-drops; the same fix applies to any consumer that opens its
  own composer popup on `etcher:created`.

## [0.2.6] — 2026-05-15

Single fix to the dimension-creation flow so consumer apps that open
their own composer popup on `etcher:created` can attach a comment to
a freshly-drawn dimension without fighting an auto-opened inline
editor.

### Fixed

- **Dimension creation no longer auto-opens the inline label editor.**
  0.2.5 fired `_startTextEdit` in the `_finalizeShape` afterCreate
  for dimensions (mirroring the callout flow), which stacked a
  foreignObject input over the label position. Consumers that pop a
  separate composer popup on `etcher:created` (for setting an
  annotation title + comment in one flow) lost the composer behind
  the inline editor — users would dismiss the composer they hadn't
  noticed and lose the comment, sometimes the whole shape (such
  composers typically treat cancel as "discard the annotation").
  Dimensions now spawn empty; the consumer's UI sets the label via
  whatever path it normally uses for non-text shapes (typically the
  `etcher:created` → composer-popup → `etcher:updated` chain). Re-
  editing the label after creation still works via double-click on
  the dimension — that path was wired in 0.2.5 and is unchanged.

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
