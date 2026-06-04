defmodule Etcher.Layer do
  @moduledoc """
  Phoenix LiveView function component that attaches Etcher's annotation
  overlay to a named `<Fresco.canvas>` or `<Fresco.scroll_strip>`.

  The component renders a hidden host `<div phx-hook="EtcherLayer">`. The
  client-side hook:

    * Looks up the named Fresco viewer via `window.Fresco.onReady/2`
    * Detects whether the handle is a `<Fresco.canvas>` (single canvas-
      pixel coordinate space, exposes `getCanvasSize`) or a
      `<Fresco.scroll_strip>` (per-image natural pixel coordinates,
      exposes `scrollTo` + `getImages`) and routes to the matching
      renderer
    * Appends a pencil button to Fresco's nav column via
      `handle.appendNavButton/3`
    * On pencil click, opens a bottom toolbar with the configured
      drawing tools and toggles annotation mode
    * Draws shapes as SVG overlays — one canvas-spanning SVG in canvas
      mode, one per-image SVG sibling in strip mode
    * Hydrates initial annotations from `handle.getExtension("etcher")`
    * Pushes `etcher:annotations-changed` events to the consumer's
      LiveView with the full annotations array on every commit / edit
      / delete

  ## Canvas mode

      <Fresco.canvas id="board" canvas={@canvas} class="w-full h-screen" />

      <Etcher.layer
        fresco_id="board"
        tools={[:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :eraser]}
      />

  ## Strip mode

      <Fresco.scroll_strip id="reader" sources={@pages} extensions={@reader_extensions} />

      <Etcher.layer fresco_id="reader" tools={[:rectangle, :freehand, :text]} />

  The component is identical in both cases — `fresco_id` is the only
  thing that changes. Strip-mode annotations carry an extra `image_idx`
  field on each shape identifying which image they live on.

  ## The event your LiveView must handle (canvas)

      def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
        new_canvas =
          Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", %{
            "version" => "1",
            "annotations" => annotations
          })

        {:noreply, assign(socket, canvas: new_canvas)}
      end

  ## The event your LiveView must handle (strip)

  Strip-mode annotations carry `image_idx` (which page they're on).
  Strip viewers don't have a `%Fresco.Canvas{}` struct or a
  `put_extension/3` helper — the consumer just maintains the
  `:extensions` map (a plain `%{}`) in socket assigns and threads it
  through the component:

      def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
        extensions =
          Map.put(socket.assigns.reader_extensions, "etcher", %{
            "version" => "1",
            "annotations" => annotations
          })

        {:noreply, assign(socket, reader_extensions: extensions)}
      end

  When a LiveView hosts multiple Etcher layers, the
  `"etcher:annotations-changed"` payload includes a `"fresco_id"` key
  so consumers can pattern-match on the source:

      def handle_event(
            "etcher:annotations-changed",
            %{"fresco_id" => "reader", "annotations" => annotations},
            socket
          ) do
        # ...
      end

  UUIDs are generated client-side (UUIDv7) in both modes, so there's no
  tmp_id ⇄ real-uuid round-trip — the server never has to assign ids.

  ## Color slots and the `etcher:colors-changed` hook

  The toolbar shows 5 fixed, editable color slots. Clicking a slot selects
  it; opening the hue picker and choosing a color overwrites the selected
  slot in place. Each committed edit reports the full palette through two
  channels (mirroring `etcher:annotations-changed` + the JS lifecycle
  events) — Etcher itself persists nothing:

    * a LiveView event your `handle_event/3` can store, and
    * a bubbling DOM `CustomEvent` for pure-JS consumers.

  Seed the slots with the `:colors` attr (per-user palette) or via
  `extensions["etcher"]["colors"]`; the save/load is generic so the same
  hook can target a `.fresco`/extension blob here or a per-user store
  (e.g. phoenix_kit `custom_fields`) in a host app.

      def handle_event(
            "etcher:colors-changed",
            %{"fresco_id" => "board", "colors" => colors},
            socket
          ) do
        # `colors` is a list of "#rrggbb" strings. Persist however you
        # like — alongside annotations in the canvas extension, or in the
        # current user's metadata. Round-trip it back through `:colors`
        # (or the extension) on the next mount.
        etcher = Map.put(socket.assigns.canvas.extensions["etcher"] || %{}, "colors", colors)
        {:noreply,
         assign(socket,
           canvas: Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", etcher)
         )}
      end

  Programmatic control mirrors the colors: `layer.getColors()`,
  `layer.setColors([...])`, `layer.setSlotColor(i, "#rrggbb")` on the
  `window.Etcher.layerFor(id)` handle.

  ## Tools

  Configure which drawing tools appear in the bottom toolbar. The default
  exposes all eight drawing kinds plus the eraser:

      tools={[:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :line, :eraser]}

  Subsetting hides specific tools (e.g. only `:rectangle, :freehand`).
  Drop `:eraser` if you don't want users deleting from the toolbar.

  ## Annotation hydration

  Initial annotations come from the viewer's `extensions.etcher` map.
  The consumer's `mount/3` typically reads a `.fresco` file (canvas mode):

      canvas = Fresco.Canvas.read!("/path/to/scene.fresco")
      {:ok, assign(socket, canvas: canvas)}

  …or assigns the strip's extension map directly (strip mode):

      extensions = %{
        "etcher" => %{
          "version" => "1",
          "annotations" => [
            %{"uuid" => "01HXY...", "kind" => "rectangle",
              "geometry" => %{"x" => 100, "y" => 200, "w" => 50, "h" => 50},
              "image_idx" => 2}
          ]
        }
      }
      {:ok, assign(socket, pages: @pages, reader_extensions: extensions)}

  Either way `<Etcher.layer>` reads the annotations through Fresco's
  handle at mount time and renders each shape on the matching page.

  ## Coordinate spaces

  Shape geometry is stored in the **same coordinate system the host
  Fresco component reports for that image**, never as a normalized
  fraction. Two cases:

    * **Strip mode** (`<Fresco.scroll_strip>` / `<FrescoStrip.viewer>`)
      — geometry is in **source-pixel space**: a circle's `cx, cy, r`,
      a polygon's `points[].x/y`, are integers in the image's own
      natural-pixel grid (e.g. a 720×9200 page uses 0..720 / 0..9200).
      Independent of the rendered display size, so shapes survive
      strip width changes without recomputation.
    * **Canvas mode** (`<Fresco.canvas>`) — geometry is in **canvas-
      pixel space**: a unified stage spanning all images in the scene,
      sized in canvas-internal pixels (the dimensions returned by the
      canvas handle's `getCanvasSize()`). A single coord pair can
      address any image since they're all laid out on the same stage.

  Consumers that scroll to a shape, render mini-maps, or persist
  shape positions outside of Etcher should know which space they're
  in. `layer.getShape(uuid)` returns the shape descriptor with
  either `image_idx` (strip) or `image_id` (canvas multi-image)
  attached so routing UI doesn't need to scrape DOM data-attrs.

  ## Programmatic API

  Each mounted layer registers a handle on `window.Etcher.layerFor(id)`:

      var layer = window.Etcher.layerFor("reader");
      layer.setMode(true);                       // enter annotation mode
      layer.selectTool("rectangle");
      layer.deleteShape("01HXY...");

      // Shape descriptors include image_idx (strip) / image_id (canvas):
      var shape = layer.getShape("01HXY...");
      // → { uuid, kind, geometry, style, metadata,
      //     image_idx?: 4,         // strip mode
      //     image_id?: "page-5" }  // canvas multi-image

      // Reveal a shape — Promise-returning, polls for late-mounted
      // shapes, optional pulse flash, fires `etcher:shape-revealed`.
      layer.revealShape("01HXY...", { pulse: true })
        .then(function (r) { console.log("revealed on image", r.image_idx); })
        .catch(function (e) { console.warn(e.reason); });

      // Hit-test a point against the current shapes. Returns the
      // top-most shape descriptor (uuid, kind, geometry, image_idx /
      // image_id, …) under `pt`, or null. Use when wiring custom
      // tap-zone navigation so the tap can be ignored when it lands
      // on an annotation:
      //   const hit = layer.shapeAt({ imageIdx: 2, x: 540, y: 920 });
      //   if (hit) return; // let etcher handle it
      // Strip handles: pt = { imageIdx, x, y } in source-pixel space.
      // Canvas handles: pt = { x, y } in canvas-pixel space.

  See `priv/static/etcher.js` for the full API surface.
  """

  use Phoenix.Component

  attr(:fresco_id, :string,
    required: true,
    doc: "DOM id of the `<Fresco.canvas>` this layer attaches to."
  )

  attr(:id, :string,
    default: nil,
    doc: "Optional DOM id for the layer host element; defaults to `\"etcher-layer-<fresco_id>\"`."
  )

  attr(:tools, :list,
    default: [:rectangle, :circle, :polygon, :freehand, :marker, :callout, :text, :dimension, :eraser],
    doc: "Subset of drawing tools to show in the toolbar."
  )

  attr(:colors, :list,
    default: nil,
    doc: """
    Optional seed for the toolbar's fixed, editable color slots — a list
    of `"#rrggbb"` strings (clamped/backfilled to 5). Supply the signed-in
    user's saved palette here for per-user colors.

    When omitted, the slots seed from `extensions["etcher"]["colors"]`
    (the same JSON the annotations ride in), then the preset palette.

    Edits are reported via the `etcher:colors-changed` event (see below);
    persist them wherever you keep per-user data and feed them back through
    this attr (or the extension) on the next mount.
    """
  )

  attr(:nav_buttons, :list,
    default: nil,
    doc: """
    Allowlist of Etcher's nav-column buttons (appended to Fresco's
    nav). Atom list: `[:pencil, :visibility]`.

    - `nil` (default) — both enabled.
    - `[]` — both hidden. Consumers shipping their own chrome wire
      `handle.toggleMode()` / `handle.toggleVisible()` (or
      `setMode(true|false)` / `setVisible(true|false)`) to their own
      buttons / shortcuts.
    - A subset list — only those buttons render.
    """
  )

  attr(:toolbar, :boolean,
    default: true,
    doc: """
    Whether to render the bottom toolbar (cursor + drawing tools +
    undo/redo + color picker + close). `false` hides it entirely;
    annotation mode still works programmatically — consumers wire
    their own toolbar UI to `handle.selectTool(...)` /
    `handle.selectColor(...)` / `handle.undo()` / `handle.redo()`
    / `handle.setMode(false)` (close).
    """
  )

  attr(:rest, :global)

  @doc """
  Mounts an Etcher annotation layer onto a named Fresco canvas.

  Renders a hidden `<div phx-hook="EtcherLayer">` that hosts the JS
  engine; the visible UI (pencil nav button + bottom toolbar + SVG
  shapes) is created by the hook on top of the Fresco canvas.
  """
  def layer(assigns) do
    tools_json = Jason.encode!(Enum.map(assigns.tools, &Atom.to_string/1))

    layer_id =
      case assigns.id do
        nil -> "etcher-layer-" <> assigns.fresco_id
        id -> id
      end

    colors_json = if assigns[:colors], do: Jason.encode!(assigns.colors), else: nil

    assigns =
      assigns
      |> assign(:tools_json, tools_json)
      |> assign(:layer_id, layer_id)
      |> assign(:nav_buttons_csv, nav_buttons_csv(assigns[:nav_buttons]))
      |> assign(:colors_json, colors_json)

    ~H"""
    <div
      id={@layer_id}
      phx-hook="EtcherLayer"
      data-fresco-id={@fresco_id}
      data-tools={@tools_json}
      data-nav-buttons={@nav_buttons_csv}
      data-toolbar={@toolbar == false && "false"}
      data-colors={@colors_json}
      class="hidden"
      aria-hidden="true"
      {@rest}
    >
    </div>
    """
  end

  # Allowlist encoding:
  #   nil  → omit attr (JS treats as "all enabled" — back-compat default)
  #   []   → "none" sentinel (JS seeds an empty Set → every button hidden)
  #   list → CSV of atom names (JS splits + intersects)
  defp nav_buttons_csv(nil), do: nil
  defp nav_buttons_csv([]), do: "none"

  defp nav_buttons_csv(list) when is_list(list),
    do: list |> Enum.map(&Atom.to_string/1) |> Enum.join(",")
end
