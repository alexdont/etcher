defmodule Etcher.Layer do
  @moduledoc """
  Phoenix LiveView function component that attaches Etcher's annotation
  overlay to a named `<Fresco.canvas>`.

  The component renders a hidden host `<div phx-hook="EtcherLayer">`. The
  client-side hook:

    * Looks up the named Fresco canvas via `window.Fresco.onReady/2`
    * Appends a pencil button to Fresco's nav column via
      `handle.appendNavButton/3`
    * On pencil click, opens a bottom toolbar with the configured
      drawing tools and toggles annotation mode
    * Draws shapes as SVG overlays locked to canvas-pixel coordinates
    * Hydrates initial annotations from `handle.getExtension("etcher")`
    * Pushes `etcher:annotations-changed` events to the consumer's
      LiveView with the full annotations array on every commit / edit
      / delete

  ## Usage

      <Fresco.canvas id="board" canvas={@canvas} class="w-full h-screen" />

      <Etcher.layer
        fresco_id="board"
        tools={[:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :eraser]}
      />

  ## The event your LiveView must handle

      def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
        new_canvas =
          Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", %{
            "version" => "1",
            "annotations" => annotations
          })

        {:noreply, assign(socket, canvas: new_canvas)}
      end

  That's the only required wiring. UUIDs are generated client-side
  (UUIDv7), so there's no tmp_id ⇄ real-uuid round-trip — the server
  never has to assign ids.

  ## Tools

  Configure which drawing tools appear in the bottom toolbar. The default
  exposes all seven drawing kinds plus the eraser:

      tools={[:rectangle, :circle, :polygon, :freehand, :callout, :text, :dimension, :eraser]}

  Subsetting hides specific tools (e.g. only `:rectangle, :freehand`).
  Drop `:eraser` if you don't want users deleting from the toolbar.

  ## Annotation hydration

  Initial annotations come from the canvas's `extensions.etcher` map.
  The consumer's `mount/3` typically reads a `.fresco` file:

      canvas = Fresco.Canvas.read!("/path/to/scene.fresco")
      {:ok, assign(socket, canvas: canvas)}

  …or builds the canvas with pre-loaded annotations:

      etcher_data = %{
        "version" => "1",
        "annotations" => [
          %{"uuid" => "01HXY...", "kind" => "rectangle",
            "geometry" => %{"x" => 100, "y" => 100, "w" => 200, "h" => 150}}
        ]
      }
      canvas = Fresco.Canvas.new(width: 1000, height: 1000)
               |> Fresco.Canvas.put_extension("etcher", etcher_data)

  Either way `<Etcher.layer>` reads the annotations through Fresco's
  handle at mount time and renders each shape.
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
