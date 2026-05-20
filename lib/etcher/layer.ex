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

  Strip-mode annotations carry `image_idx` (which page they're on); the
  consumer stores them inside the `:extensions` map the same way.

      def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
        extensions =
          Map.put(socket.assigns.reader_extensions, "etcher", %{
            "version" => "1",
            "annotations" => annotations
          })

        {:noreply, assign(socket, reader_extensions: extensions)}
      end

  UUIDs are generated client-side (UUIDv7) in both modes, so there's no
  tmp_id ⇄ real-uuid round-trip — the server never has to assign ids.

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

  ## Programmatic API

  Each mounted layer registers a handle on `window.Etcher.layerFor(id)`:

      var layer = window.Etcher.layerFor("reader");
      layer.setMode(true);                       // enter annotation mode
      layer.selectTool("rectangle");
      layer.revealShape("01HXY...");             // scroll to a shape
      layer.deleteShape("01HXY...");

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
    default: [:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :eraser],
    doc: "Subset of drawing tools to show in the toolbar."
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

    assigns =
      assigns
      |> assign(:tools_json, tools_json)
      |> assign(:layer_id, layer_id)

    ~H"""
    <div
      id={@layer_id}
      phx-hook="EtcherLayer"
      data-fresco-id={@fresco_id}
      data-tools={@tools_json}
      class="hidden"
      aria-hidden="true"
      {@rest}
    >
    </div>
    """
  end
end
