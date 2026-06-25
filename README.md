# Etcher

[![Hex.pm](https://img.shields.io/hexpm/v/etcher.svg)](https://hex.pm/packages/etcher)
[![Hex Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/etcher)
[![License](https://img.shields.io/hexpm/l/etcher.svg)](LICENSE)

**Etcher** is the annotation layer for [Fresco](https://hex.pm/packages/fresco)-based image viewers in Phoenix.

Users draw shapes (rectangle, circle, polygon, freehand, callout, text, dimension, line) on top of any `<Fresco.canvas>`; the annotations live inside the canvas's `extensions.etcher` blob and travel with the `.fresco` file. Your LiveView receives bulk update events and writes the canvas back to disk (or DB, or wherever). No Ecto schema, no migrations, no adapters — Etcher is a thin renderer + event source over Fresco's existing extension contract.

An *etcher* is the tool that incises marks into a surface — Etcher does the same digitally.

```
┌─────────────────────────────────────────────────────┐
│  <Fresco.canvas id="photo" canvas={@canvas} />      │
│   ┌──┐                                              │
│   │+ │  ← fresco's nav column                       │
│   │- │                                              │
│   │⟲ │                                              │
│   │⛶ │                                              │
│   │✎ │  ← added by <Etcher.layer />                 │
│   └──┘                                              │
│                                                     │
│         ┌───┐  ┌────────┐                           │
│         │   │  │        │   ← drawn annotations     │
│         │   │  │        │                           │
│         └───┘  └────────┘                           │
│                                                     │
│   [⌖] [▭] [○] [⬡] [〰] [💬] [T] [⟷] [╱] [⌫]  ← toolbar │
└─────────────────────────────────────────────────────┘
```

## Installation

Add `:fresco` (the viewer) and `:etcher` to your `mix.exs`:

```elixir
def deps do
  [
    {:fresco, "~> 0.5"},
    {:etcher, "~> 0.3"}
  ]
end
```

Wire the JS hooks in your `assets/js/app.js`:

```js
import "../../deps/fresco/priv/static/fresco.js"
import "../../deps/etcher/priv/static/etcher.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.FrescoHooks, ...window.EtcherHooks, ...colocatedHooks }
})
```

The hook name is `EtcherLayer` — if you maintain an explicit hooks map instead of spreading `window.EtcherHooks`, register it as `{ EtcherLayer: window.EtcherHooks.EtcherLayer }` (alongside Fresco's `FrescoCanvas`).

That's it. No `mix etcher.gen.migration` step, no `config :etcher, repo: ...` — Etcher 0.3 doesn't own any tables. Annotations live in a `%Fresco.Canvas{}` struct under `extensions.etcher`, which you persist however you like (a `.fresco` file on disk, a JSONB column, a blob store, …).

## Quick start

```elixir
defmodule MyAppWeb.PhotoLive do
  use MyAppWeb, :live_view

  def mount(_params, _session, socket) do
    canvas =
      "/uploads/photo.fresco"
      |> Fresco.Canvas.read!()
      # Or build it inline:
      # Fresco.Canvas.new(width: 4000, height: 3000)
      # |> Fresco.Canvas.add_image(%{src: "/uploads/photo.jpg", x: 0, y: 0, width: 4000})
      # |> Fresco.Canvas.put_extension("etcher", %{"version" => "1", "annotations" => []})

    {:ok, assign(socket, :canvas, canvas)}
  end

  def render(assigns) do
    ~H"""
    <Fresco.canvas id="photo" canvas={@canvas} class="w-full h-[80vh]" />

    <Etcher.layer fresco_id="photo" />
    """
  end

  # Bulk event — every annotation create / update / delete / drag / color
  # change ends with this single event carrying Etcher's full current list.
  # The Etcher 0.2.x per-op events (etcher:created / :updated / :deleted /
  # :selected) are gone — diff against your last-known state if you need
  # per-row semantics.
  def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
    canvas =
      Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", %{
        "version" => "1",
        "annotations" => annotations
      })

    # Persist however you like — file, DB column, S3, ...
    Fresco.Canvas.write!("/uploads/photo.fresco", canvas)

    {:noreply, assign(socket, :canvas, canvas)}
  end

  # Optional: fires once when the user finishes drawing a new shape. Use
  # it to open a composer / inspector / metadata-entry popup. Unlike
  # `annotations-changed`, this does NOT fire on undo/redo, drags, or
  # color picks — only on actual user-draw intent.
  def handle_event("etcher:shape-drawn", %{"uuid" => uuid, "kind" => _kind}, socket) do
    {:noreply, assign(socket, :composing_uuid, uuid)}
  end
end
```

Open the page, click the pencil in Fresco's nav column → the bottom toolbar appears with the eight drawing tools (rectangle, circle, polygon, freehand, callout, text, dimension, line) plus an eraser. Pick rectangle, drag on the image, release — `handle_event("etcher:annotations-changed", …)` fires with the geometry in canvas-pixel coordinates.

## The component

```heex
<Etcher.layer
  fresco_id="photo"
  tools={[:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :line, :eraser]}
/>
```

| Attr | Required | Notes |
|------|----------|-------|
| `fresco_id` | yes | DOM id of the `<Fresco.canvas>` this layer attaches to. |
| `tools` | no | Subset of drawing tools to expose. Defaults to all eight drawable kinds plus `:eraser`. |
| `id` | no | DOM id of the layer host element. Defaults to `"etcher-layer-<fresco_id>"`. |

Hydration is implicit: on mount, Etcher reads `handle.getExtension("etcher")` from the Fresco canvas it attaches to and renders whatever annotations are already inside `extensions.etcher.annotations`. There's no `:initial_annotations` attr — the canvas IS the source of truth.

## Events

### Client → server LiveView events

The component emits these events.

#### `etcher:annotations-changed` — fires on every mutation

```elixir
def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket), do: ...
```

Payload: `%{"annotations" => [annotation_map, ...]}` — the full current list, replayed on every change. Each map looks like:

```elixir
%{
  "uuid"     => "019e3c53-7734-76bf-b983-a2e158ef6e17",  # UUIDv7, client-assigned
  "kind"     => "rectangle" | "circle" | "polygon" | "freehand"
              | "callout" | "text" | "dimension" | "line",
  "geometry" => %{ ... },        # shape-specific, canvas-pixel coords (see below)
  "style"    => %{ "color" => "#fca5a5" },  # optional
  "metadata" => %{ ... }          # optional, consumer-controlled
}
```

UUIDs are generated client-side via `crypto.getRandomValues` (UUIDv7) at draw time, so the server never has to assign one — no tmp-id round-trip.

The canonical handler pipes the array straight through `Fresco.Canvas.put_extension/3` and persists the resulting canvas. Diff against `viewer_annotations` (or your own snapshot) if you need per-row create/update/delete semantics — see [the PhoenixKit MediaBrowser](https://hexdocs.pm/phoenix_kit) for a worked example with linked-comment cleanup.

#### `etcher:shape-drawn` — fires only on real user draws

```elixir
def handle_event("etcher:shape-drawn", %{"uuid" => uuid, "kind" => kind}, socket), do: ...
```

Payload: `%{"uuid", "kind"}`. Use this to drive UI keyed on actual user-draw intent (open a composer, focus a metadata form, fire an analytics event). It does **not** fire on undo/redo of a delete (which also adds a shape back into the canvas), drags, color picks, or programmatic shape additions via `layer.patchShape/2`. `etcher:annotations-changed` handles persistence; `etcher:shape-drawn` handles intent.

#### `etcher:colors-changed` / `etcher:line-params-changed` — per-user defaults

Two optional hooks for persisting per-user toolbar defaults (Etcher stores nothing itself). `etcher:colors-changed` (`%{"colors" => ["#rrggbb", ...]}`) fires when a color slot is edited; `etcher:line-params-changed` (`%{"line_params" => %{"width" => n, "opacity" => n, "dash" => "solid"|"dashed"|"dotted"}}`) fires when the Parameters popup changes the **global** stroke default (no shape selected). Seed them back via the `:colors` / `:line_params` attrs on the next mount. Editing a *selected* shape's style instead persists with the shape through `etcher:annotations-changed`. If you don't persist these, add a no-op `handle_event` clause (or a catch-all) so the unhandled event doesn't log noise.

### Geometry shapes

| kind | geometry |
|------|----------|
| `rectangle` | `%{"x" => x, "y" => y, "w" => w, "h" => h}` |
| `circle`    | `%{"cx" => cx, "cy" => cy, "r" => r}` |
| `polygon`   | `%{"points" => [[x1, y1], [x2, y2], ...]}` |
| `freehand`  | `%{"points" => [[x1, y1], [x2, y2], ...]}` |
| `callout`   | `%{"anchor" => [x, y], "text_box" => %{"x" => x, "y" => y, "w" => w, "h" => h}}` |
| `text`      | `%{"x" => x, "y" => y, "w" => w, "h" => h}` |
| `dimension` | `%{"a" => [x, y], "b" => [x, y]}` (label lives in `metadata.title` / `metadata.title_offset`) |
| `line`      | `%{"a" => [x, y], "b" => [x, y]}` (title lives in `metadata.title`, rendered as a sibling label) |

All coordinates are in canvas pixels — Fresco's pan/zoom rescales them automatically.

## Read-only annotations

Add `readonly: true` to any annotation to lock it — for layers that mix shapes from multiple authors (public manga annotations, multiplayer whiteboards, comment-on-image flows) where the current user shouldn't be able to touch shapes they don't own. A locked shape still renders and responds to hover and tooltip-pin, but the viewer can't enter edit mode, move/resize it, delete it (tooltip trash **or** eraser), box-select it, open its pen editor, or pick up its color. Clicking it in annotation mode pins its tooltip, the same as browse mode.

```elixir
annotations =
  Enum.map(annotations, fn ann ->
    Map.put(ann, "readonly", ann["owner_uuid"] != current_user.uuid)
  end)
```

The flag is **render-time only**: Etcher never echoes `readonly` back in `etcher:annotations-changed`, so recompute it from your own ownership data on every render. Flip it at runtime (no re-render) via the layer API:

```js
Etcher.layerFor("board").setShapeReadonly(uuid, true)
```

A locked `.etcher-shape` element carries `data-readonly="true"`, so you can style locked shapes without specificity fights:

```css
.etcher-shape[data-readonly="true"] { opacity: 0.85; }
```

> **Not a security boundary.** `readonly` is UX, not enforcement — a determined client can flip it in DevTools. Keep a server-side filter that drops edits to annotations the user doesn't own when you persist `etcher:annotations-changed`.

## Persistence

Etcher's component doesn't run any persistence itself — it emits `etcher:annotations-changed` and trusts the consumer. The canvas-extension model means every persistence shape works the same way:

```elixir
def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
  canvas =
    Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", %{
      "version" => "1",
      "annotations" => annotations
    })

  # Pick whichever storage path fits your app:
  Fresco.Canvas.write!(my_path(socket), canvas)         # local file
  # MyRepo.update!(my_changeset(socket, canvas))         # JSONB column
  # MyBlobStore.put(my_key(socket), Fresco.Canvas.to_json!(canvas))  # S3 / similar

  {:noreply, assign(socket, :canvas, canvas)}
end
```

Linking annotations to other rows (comments, audit trails, notifications) belongs in your handler too. Diff `annotations` against `socket.assigns.canvas.extensions["etcher"]["annotations"]` to know what changed; route the deltas wherever they need to go.

### Server → client live updates

For consumers that mutate annotation metadata server-side (e.g. a comment arrives in the sidebar and you want the tooltip to reflect a new `comment_count`), Fresco's `phx-update="ignore"` freezes `data-extensions` at mount. Use the layer API to patch the in-DOM shape directly:

```elixir
push_event(socket, "etcher:patch-shape", %{
  fresco_id: "photo",
  uuid: annotation_uuid,
  metadata: updated_metadata
})
```

On the client, your JS bridges this to `layer.patchShape(uuid, {metadata})` — see [the `phoenix_kit.js` reference bridge](https://github.com/alexdont/phoenix_kit/blob/main/priv/static/assets/phoenix_kit.js) for a 12-line listener. Same pattern works for `style` updates or for `etcher:delete-shape` → `layer.deleteShape(uuid)`.

## Server-side rendering

Etcher draws shapes live (SVG) on the canvas in the browser. `Etcher.Raster` is the **server** counterpart: it turns the same persisted geometry into a static drawing, with no JavaScript and no canvas — for baking a thumbnail, an OG image, a PDF, or any place a shape needs to appear without a live LiveView.

It's pure and dependency-free: it returns strings (ImageMagick draw-args or SVG markup) and leaves the actual rasterizing to you. Feed it the annotation list straight out of `extensions.etcher` (string **or** atom keys; it's the same wire format as the [geometry table](#geometry-shapes) above).

**Bake shapes into a raster** — `to_draw_args/2` returns `convert` arguments to splice in *before* any resize/crop, so shapes are drawn in the image's pixel space and scale with it:

```elixir
draw_args = Etcher.Raster.to_draw_args(annotations, stroke_width: 4)

System.cmd("convert",
  [source_path] ++ draw_args ++
    ["-resize", "400x400^", "-gravity", "center", "-extent", "400x400", "png:#{out}"])
```

**Overlay without rasterizing** — `to_svg/2` returns a standalone `<svg>` string. With `preserveAspectRatio="xMidYMid slice"` it crops identically to CSS `object-cover`, so it lines up over a cover-fit `<img>`:

```elixir
Etcher.Raster.to_svg(annotations, width: img.width, height: img.height, class: "absolute inset-0")
```

**Options:** `:stroke_width`, `:default_color` (fallback when a shape has no `style` colour), and for SVG `:width` / `:height` / `:class`. Outlines only — `text`, `eraser`, and unknown/malformed shapes are skipped, so one bad row never breaks a render. Need a different backend (PDF, Cairo, …)? `primitives/1` hands you the normalised `{primitive, colour}` list to render yourself.

## Customizing the tooltip

Hovering or clicking an annotation pops up a small tooltip with a trash button (for persisted shapes) and three content slots: **header**, **footer**, and **body**. The defaults read a few generic `metadata` keys and degrade to just the shape kind if those are absent, but a consumer can replace any slot with its own rendering by setting `window.Etcher.tooltipSlots`:

```js
window.Etcher.tooltipSlots = {
  header: (shape) => Etcher.escapeHtml(shape.metadata.author || shape.kind),
  footer: (shape) => shape.metadata.last_edited || null,
  body:   (shape) => `<p>${Etcher.escapeHtml(shape.metadata.note || "")}</p>`
};
```

- Slots are functions `(shape) => string | null`.
- Returning `null` or `undefined` falls back to Etcher's default for that slot. An empty return for `body` / `footer` omits the row entirely.
- The whole `shape` object is passed (`{uuid, kind, geometry, style, metadata, …}`) so consumers can build whatever HTML their data supports.
- Etcher controls the wrapper, positioning, hover bridge, click-to-pin, and the trash button — slots only own content. This keeps delete + pin behavior consistent across consumers.
- `window.Etcher.escapeHtml(value)` is exposed as a stable escape helper.

### Default slot keys

If you don't register custom slots but want a meaningful tooltip, populate these on each annotation's `metadata`:

| Slot   | Read from              | Fallback                          |
|--------|------------------------|-----------------------------------|
| header | `metadata.title`       | capitalized `shape.kind`          |
| body   | `metadata.body`        | (none — row omitted)              |
| footer | `metadata.subtitle`    | (none — row omitted)              |

### Styling primitives

The tooltip exposes a few CSS classes you can target from your own stylesheet:

- `.etcher-tooltip` — the floating wrapper
- `.etcher-tooltip-header` / `.etcher-tooltip-meta` — title + meta rows
- `.etcher-tooltip-body` / `.etcher-tooltip-thumb` / `.etcher-tooltip-text` / `.etcher-tooltip-quote` — body slot building blocks
- `.etcher-tooltip-delete` — the trash button

### Lifecycle events

Etcher dispatches bubbling `CustomEvent`s for the tooltip's lifecycle — see "Lifecycle DOM events" below. If you need tooltip `show` / `hide` / `pin` events tied into analytics or shared state, listen on the layer host.

## Hooks reference

All extension points beyond the LiveView events listed above. None are required — Etcher works with zero configuration.

### `window.Etcher.colorSwatches` — palette override

Replace the bundled pastel rainbow + monochrome bookends with your own swatches:

```js
window.Etcher.colorSwatches = [
  { key: "brand",   color: "#ff6f00", title: "Brand orange" },
  { key: "muted",   color: "#9ca3af", title: "Muted gray" },
  { key: "ink",     color: "#0f172a", title: "Ink" }
];
```

Falls back to the default palette if unset or not an array.

### `window.Etcher.defaultColor` — initial active color

Override which swatch starts pre-selected when annotation mode opens:

```js
window.Etcher.defaultColor = "#ff6f00";
```

Falls back to the "blue" swatch in the active palette (back-compat) or the first swatch.

### `window.Etcher.layerFor(frescoId)` — programmatic control

Returns the layer's control surface, or `null` if no layer is mounted for that fresco id. Every built-in button (toolbar tools, color swatches, undo/redo, the eye visibility toggle, the pencil annotation-mode toggle) delegates to a method on this object — so you can drive Etcher headlessly (custom toolbar, keyboard shortcuts, command palette, URL handlers, automated tests):

```js
const layer = window.Etcher.layerFor("photo");
if (!layer) return;

// Mode / visibility
layer.setMode(true);          // enter annotation mode
layer.toggleVisible();        // show / hide annotations
layer.isVisible();            // → boolean

// Tools
layer.tools();                // → ["rectangle", "circle", ...]
layer.selectTool("rectangle");
layer.selectTool(null);       // back to cursor (alias: exitDrawing())
layer.getTool();              // → "rectangle" | null

// Color
layer.swatches();             // → [{ color, title }, ...]
layer.setColor("#fca5a5");
layer.getColor();             // → "#fca5a5" | null

// Line params (global stroke defaults) — parity with the palette;
// setLineParams does NOT fire etcher:line-params-changed.
layer.getLineParams();        // → { width?, opacity?, dash? }
layer.setLineParams({ width: 8, opacity: 1, dash: "dashed" });

// History
if (layer.canUndo()) layer.undo();
if (layer.canRedo()) layer.redo();

// Shapes
const shapes = layer.getShapes();
// → [{ uuid, kind, geometry, style, metadata }, ...]
const one = layer.getShape("uuid-…");
layer.selectShape("uuid-…");  // pins the tooltip (no-op + warn if readonly)
layer.enterEditMode("uuid-…");
layer.exitEditMode();
layer.deleteShape("uuid-…");
layer.setShapeReadonly("uuid-…", true);  // lock / unlock a shape (see Read-only annotations)

// Live patch — merge metadata / style into an existing shape and
// re-render. Use this when server-side state (comment count, author,
// etc.) changes and `phx-update="ignore"` is blocking a remount.
layer.patchShape("uuid-…", {
  metadata: { comment_count: 3, comment_author: "Alice" },
  style:    { color: "#fca5a5" }
});
```

### Lifecycle DOM events

Etcher dispatches bubbling `CustomEvent`s on the layer's host element so consumer JS can react without reaching into the hook. Listen on the host or any ancestor:

```js
document.addEventListener("etcher:tooltip-show", (e) => {
  console.log("Tooltip showing for", e.detail.uuid, "at", e.detail.anchor);
});
```

| Event | `detail` | When |
|-------|----------|------|
| `etcher:tooltip-show`  | `{ uuid, anchor: {x, y} }`  | Tooltip rendered (hover or pin) |
| `etcher:tooltip-hide`  | `{ uuid }`                  | Tooltip closes (hover-away timeout or pin dismissed) |
| `etcher:tooltip-pin`   | `{ uuid }`                  | User clicked a shape to pin its tooltip |
| `etcher:tooltip-unpin` | `{ uuid }`                  | User clicked elsewhere / re-clicked to unpin |
| `etcher:mode-changed`       | `{ annotationMode: bool }`     | User (or API) toggled annotation mode |
| `etcher:tool-changed`       | `{ tool: string \| null }`     | Drawing tool changed (null = cursor) |
| `etcher:color-changed`      | `{ color: string }`            | Active color changed |
| `etcher:visibility-changed` | `{ visible: bool }`            | Annotations hidden / shown |
| `etcher:history-changed`    | `{ canUndo: bool, canRedo: bool }` | Undo/redo stack updated — useful for keeping a custom toolbar in sync |

### `window.Etcher.escapeHtml(value)` — escape helper

Stable helper exposed for use inside consumer slot functions. HTML-escapes `&`, `<`, `>`, `"`, `'`.

## How it fits with Fresco

Etcher 0.3 uses Fresco 0.5's `handle.appendNavButton/3` (for the pencil button) and `handle.getExtension/1` (to hydrate annotations from `extensions.etcher` on mount). Drawing input is delivered as plain `pointerdown` / `pointermove` / `pointerup` events on an SVG overlay anchored to Fresco's canvas-pixel coordinate space, so shapes stay locked to the image through pan and zoom. No OpenSeadragon, no canvas redraw — Fresco 0.5 dropped both.

## Out of scope (for now)

- Custom tools beyond the eight built-in kinds. The geometry kind is just a string, so the canvas extension blob doesn't care, but the toolbar + drawing-loop wiring isn't pluggable yet — adding a kind today means a fork.
- Touch + pinch gesture coexistence with Fresco's pan/zoom — annotation mode currently disables Fresco's drag-to-pan; refinement comes later.
- Annotation export / import in W3C Web Annotation Data Model JSON-LD.

## License

MIT. See [LICENSE](LICENSE).
