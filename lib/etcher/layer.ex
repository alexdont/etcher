defmodule Etcher.Layer do
  @moduledoc """
  Phoenix LiveView function component that attaches Etcher's annotation
  overlay to a named [Fresco](https://hex.pm/packages/fresco) viewer.

  The component renders a hidden host `<div>` with
  `phx-hook="EtcherLayer"`. The client-side hook:

    * Looks up the named Fresco viewer via `window.Fresco.onViewerReady/2`
    * Appends a pencil button to Fresco's nav column via
      `handle.appendNavButton/3` (added in Fresco 0.2)
    * On pencil click, opens a bottom toolbar with the configured
      drawing tools and toggles annotation mode
    * Draws shapes as SVG overlays locked to image coordinates
    * Fires LiveView events on each lifecycle moment (`etcher:created`,
      `:updated`, `:deleted`, `:selected`)

  ## Usage

      <Fresco.viewer id="photo" src={~p"/uploads/photo.jpg"} />

      <Etcher.layer
        fresco_id="photo"
        target_type="file"
        target_uuid={@file.uuid}
        initial_annotations={@annotations}
        tools={[:rectangle, :circle, :polygon, :freehand]}
      />

  ## Events the consumer's LiveView handles

  Required (Etcher always emits these on user interaction):

      def handle_event("etcher:created", %{
        "target_type" => t,
        "target_uuid" => u,
        "kind" => kind,
        "geometry" => geometry,
        "tmp_id" => tmp_id     # client-side stand-in until you confirm save
      }, socket) do
        {:ok, ann} = Etcher.create_annotation(%{
          target_type: t, target_uuid: u, kind: kind, geometry: geometry,
          creator_uuid: socket.assigns.current_user.uuid
        })
        # Reflect the persisted UUID back to the client so the shape
        # element gets re-keyed for subsequent updates / deletes.
        {:noreply, push_event(socket, "etcher:annotation-saved",
          %{tmp_id: tmp_id, uuid: ann.uuid})}
      end

      def handle_event("etcher:updated", %{"uuid" => uuid, "geometry" => geometry}, socket), do: ...
      def handle_event("etcher:deleted", %{"uuid" => uuid}, socket), do: ...
      def handle_event("etcher:selected", %{"uuid" => uuid}, socket), do: ...

  ## Initial annotations

  The `:initial_annotations` attr is a list of maps with at least
  `:uuid`, `:kind`, `:geometry`. Any extra fields are passed through to
  the client untouched. The hook renders each as an SVG overlay on
  mount.

  ## Tools

  Configure which drawing tools appear in the bottom toolbar. Defaults
  to all four:

      tools={[:rectangle, :circle, :polygon, :freehand]}

  Subsetting hides specific tools (e.g. only `:rectangle, :freehand`).
  """

  use Phoenix.Component

  attr(:fresco_id, :string,
    required: true,
    doc: "DOM id of the `<Fresco.viewer>` this layer attaches to."
  )

  attr(:target_type, :string,
    required: true,
    doc: """
    The kind of resource the annotation is on (e.g. `\"file\"`,
    `\"document\"`, `\"product\"`). Echoed back in every event payload
    so the consumer's event handler knows what's being annotated.
    """
  )

  attr(:target_uuid, :string,
    required: true,
    doc: "UUID of the resource being annotated."
  )

  attr(:initial_annotations, :list,
    default: [],
    doc:
      "Pre-existing annotations to render on mount. Each entry needs at least `:uuid`, `:kind`, and `:geometry`."
  )

  attr(:tools, :list,
    default: [:rectangle, :circle, :polygon, :freehand, :callout, :text, :eraser],
    doc: "Subset of drawing tools to show in the toolbar."
  )

  attr(:id, :string,
    default: nil,
    doc: "Optional DOM id for the layer host element; defaults to `\"etcher-layer-<fresco_id>\"`."
  )

  attr(:rest, :global)

  @doc """
  Mounts an Etcher annotation layer onto a named Fresco viewer.

  Renders a hidden `<div phx-hook="EtcherLayer">` that hosts the JS
  engine; the visible UI (pencil nav button + bottom toolbar + SVG
  shapes) is created by the hook on top of the Fresco viewer.
  """
  def layer(assigns) do
    initial_json = Jason.encode!(assigns.initial_annotations)
    tools_json = Jason.encode!(Enum.map(assigns.tools, &Atom.to_string/1))

    layer_id =
      case assigns.id do
        nil -> "etcher-layer-" <> assigns.fresco_id
        id -> id
      end

    assigns =
      assigns
      |> assign(:initial_json, initial_json)
      |> assign(:tools_json, tools_json)
      |> assign(:layer_id, layer_id)

    ~H"""
    <div
      id={@layer_id}
      phx-hook="EtcherLayer"
      data-fresco-id={@fresco_id}
      data-target-type={@target_type}
      data-target-uuid={@target_uuid}
      data-tools={@tools_json}
      data-initial-annotations={@initial_json}
      class="hidden"
      aria-hidden="true"
      {@rest}
    >
    </div>
    """
  end
end
