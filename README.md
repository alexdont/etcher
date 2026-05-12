# Etcher

[![Hex.pm](https://img.shields.io/hexpm/v/etcher.svg)](https://hex.pm/packages/etcher)
[![Hex Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/etcher)
[![License](https://img.shields.io/hexpm/l/etcher.svg)](LICENSE)

**Etcher** is the annotation layer for [Fresco](https://hex.pm/packages/fresco)-based image viewers in Phoenix.

Users draw shapes (rectangle, circle, polygon, freehand) on top of any Fresco viewer; your LiveView receives geometry events; you decide what to persist. A bundled Ecto schema + migration generator covers the common case; consumers with richer needs implement a behaviour and plug in their own storage.

An *etcher* is the tool that incises marks into a surface — Etcher does the same digitally.

```
┌─────────────────────────────────────────────────────┐
│  <Fresco.viewer id="photo" src="/uploads/img.jpg"/> │
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
│         [⌖] [▭] [○] [⬡] [〰] [×]   ← bottom toolbar  │
└─────────────────────────────────────────────────────┘
```

## Installation

Add `:fresco` (the viewer) and `:etcher` to your `mix.exs`:

```elixir
def deps do
  [
    {:fresco, "~> 0.2"},
    {:etcher, "~> 0.1"}
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

If you want the bundled `etcher_annotations` table, run:

```bash
mix etcher.gen.migration
mix ecto.migrate
```

And point Etcher at your Repo in `config/config.exs`:

```elixir
config :etcher, repo: MyApp.Repo
```

(You can skip both steps if you're implementing custom storage — see below.)

## Quick start

```elixir
defmodule MyAppWeb.PhotoLive do
  use MyAppWeb, :live_view

  def render(assigns) do
    ~H"""
    <Fresco.viewer id="photo" src={~p"/uploads/photo.jpg"} class="w-full h-[80vh]" />

    <Etcher.layer
      fresco_id="photo"
      target_type="file"
      target_uuid={@file.uuid}
      initial_annotations={@annotations}
    />
    """
  end

  def handle_event("etcher:created", attrs, socket) do
    case Etcher.create_annotation(Map.put(attrs, "creator_uuid", socket.assigns.current_user.uuid)) do
      {:ok, annotation} ->
        # Reflect the persisted uuid back to the client so subsequent
        # updates/deletes can reference the saved row.
        {:noreply,
         push_event(socket, "etcher:annotation-saved", %{
           tmp_id: attrs["tmp_id"],
           uuid: annotation.uuid
         })}

      {:error, _changeset} ->
        {:noreply, put_flash(socket, :error, "Could not save annotation")}
    end
  end

  def handle_event("etcher:selected", %{"uuid" => uuid}, socket) do
    {:noreply, assign(socket, :selected_annotation_uuid, uuid)}
  end
end
```

Open the page, click the pencil in Fresco's nav column → the bottom toolbar appears with the four drawing tools. Pick rectangle, drag on the image, release — `handle_event("etcher:created", …)` fires with the geometry in image pixel coordinates.

## The component

```heex
<Etcher.layer
  fresco_id="photo"
  target_type="file"
  target_uuid={@file.uuid}
  initial_annotations={@annotations}
  tools={[:rectangle, :circle, :polygon, :freehand]}
/>
```

| Attr | Required | Notes |
|------|----------|-------|
| `fresco_id` | yes | DOM id of the `<Fresco.viewer>` this layer attaches to. |
| `target_type` | yes | What the annotation is on — `"file"`, `"document"`, `"product"`, etc. Echoed back in every event. |
| `target_uuid` | yes | UUID of the resource being annotated. |
| `initial_annotations` | no | Pre-existing annotations to render on mount. Each needs at least `:uuid`, `:kind`, `:geometry`. |
| `tools` | no | Subset of drawing tools to expose. Defaults to all four. |
| `id` | no | DOM id of the layer host element. Defaults to `"etcher-layer-<fresco_id>"`. |

## Events

The component emits four LiveView events. The consumer's LiveView handles whichever ones it cares about.

```elixir
def handle_event("etcher:created", attrs, socket), do: ...
def handle_event("etcher:updated", %{"uuid" => uuid, "geometry" => geom}, socket), do: ...
def handle_event("etcher:deleted", %{"uuid" => uuid}, socket), do: ...
def handle_event("etcher:selected", %{"uuid" => uuid}, socket), do: ...
```

The `etcher:created` payload includes:

```elixir
%{
  "target_type" => "file",
  "target_uuid" => "...",
  "kind" => "rectangle" | "circle" | "polygon" | "freehand",
  "geometry" => %{ ... },              # shape-specific, image-pixel coords
  "tmp_id" => "tmp-abc123-..."          # client-side temp id
}
```

After persisting, push back the saved uuid so the client can adopt it:

```elixir
push_event(socket, "etcher:annotation-saved", %{tmp_id: tmp_id, uuid: annotation.uuid})
```

Geometry shapes:

| kind | geometry |
|------|----------|
| `rectangle` | `%{"x" => x, "y" => y, "w" => w, "h" => h}` |
| `circle`    | `%{"cx" => cx, "cy" => cy, "r" => r}` |
| `polygon`   | `%{"points" => [[x1, y1], [x2, y2], ...]}` |
| `freehand`  | `%{"points" => [[x1, y1], [x2, y2], ...]}` |

All coordinates are in image pixels — Fresco's pan/zoom rescales them automatically.

## Custom storage

`Etcher.Storage` is a behaviour. The default implementation is fine for most consumers, but you can swap in your own — useful when annotations need to be linked to other tables (comments, notifications, audit trails) inside the same transaction.

```elixir
defmodule MyApp.AnnotationStorage do
  @behaviour Etcher.Storage

  alias MyApp.Repo
  alias MyApp.{Annotation, Comment}

  def create(attrs) do
    Repo.transaction(fn ->
      {:ok, comment} = %Comment{}
                       |> Comment.changeset(%{kind: "annotation", author_uuid: attrs.creator_uuid})
                       |> Repo.insert()

      {:ok, annotation} = %Annotation{}
                          |> Annotation.changeset(Map.put(attrs, :comment_uuid, comment.uuid))
                          |> Repo.insert()

      annotation
    end)
  end

  def list_for(target_type, target_uuid), do: ...
  def update(uuid, attrs), do: ...
  def delete(uuid), do: ...
end
```

Then in your LiveView:

```elixir
def handle_event("etcher:created", attrs, socket) do
  {:ok, annotation} = MyApp.AnnotationStorage.create(attrs)
  # ...
end
```

Etcher's component doesn't run any persistence itself — it fires events and trusts the consumer. The bundled `Etcher.create_annotation/1` is just a shortcut for `Etcher.Storage.Default.create/1`.

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

If you don't register custom slots but want a meaningful tooltip, populate these on each annotation's `metadata` (server-side, in `initial_annotations`):

| Slot   | Read from              | Fallback                          |
|--------|------------------------|-----------------------------------|
| header | `metadata.title`       | capitalized `shape.kind`          |
| body   | `metadata.body`        | (none — row omitted)              |
| footer | `metadata.subtitle`    | (none — row omitted)              |

### Styling primitives

Etcher's stylesheet ships a handful of opt-in classes consumers can use inside their slot HTML for a layout consistent with the default look:

- `.etcher-tooltip-body` — flex row, thumbnail on the left, text column on the right (`gap: 8px`, `max-width: 260px`)
- `.etcher-tooltip-thumb` — 40×40 rounded box for an `<img>` or icon span
- `.etcher-tooltip-thumb-icon` — modifier that centers an SVG icon inside the thumb box (paperclip-style fallback)
- `.etcher-tooltip-text` — flex column container for the right-hand text
- `.etcher-tooltip-quote` — italic, two-line clamp for a quoted text preview

These are entirely optional. A slot that just returns `<p>plain text</p>` lays out fine without any of them.

### Lifecycle events

Slot APIs cover content. For interaction wiring the existing LiveView events still fire:

- `etcher:selected {uuid}` on click (also pins the tooltip)
- `etcher:deleted {uuid}` when the user hits the trash button

`etcher:tooltip-show` / `-hide` / `-pin` events would be a natural follow-up if a consumer needs them; not in v0.1.

## How it fits with Fresco

Etcher uses Fresco 0.2's `handle.appendNavButton/3` extension point to add the pencil button — no other extension surface required. Drawing input is delivered as plain `pointerdown` / `pointermove` / `pointerup` events on an SVG overlay anchored to Fresco's image coordinate space, so shapes stay locked to image pixels through pan and zoom.

## Out of scope (for now)

- Editing existing shapes after commit (drag handles, vertex move). v0.1 is draw-and-commit; to change a shape, delete and redraw.
- Touch + pinch gesture coexistence with Fresco's pan/zoom — annotation mode currently disables Fresco's drag-to-pan; refinement comes later.
- Custom tools beyond the four built-ins. The geometry kind is a string, so adding a new kind is straightforward; the toolbar wiring isn't pluggable yet.
- Annotation export / import in W3C Web Annotation Data Model JSON-LD.

## License

MIT. See [LICENSE](LICENSE).
