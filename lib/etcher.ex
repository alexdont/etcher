defmodule Etcher do
  @moduledoc """
  Etcher is the annotation overlay for [Fresco](https://hex.pm/packages/fresco)
  canvases in Phoenix.

  An *etcher* is the tool that incises marks into a surface — Etcher the
  library does the same digitally: users draw shapes (rectangle, circle,
  polygon, freehand, callout, text, dimension) on top of a `<Fresco.canvas>`;
  the LiveView fires events with the resulting annotations; the consumer
  stores them inside the canvas's `extensions.etcher` blob and saves
  the whole canvas to a `.fresco` file.

  ## Architecture

  Etcher has two pieces:

    * **Client side**: an `<Etcher.layer>` component that attaches to a
      named `<Fresco.canvas>`, adds a pencil button to its nav, opens a
      bottom toolbar with drawing tools when active. Built from scratch
      — no Annotorious dependency.
    * **Server side**: passive. Etcher pushes a single
      `etcher:annotations-changed` event with the full annotations array
      whenever the user edits. The consumer's LiveView pipes that into
      `Fresco.Canvas.put_extension/3` and re-assigns the canvas; saving
      the file is a separate `Fresco.Canvas.write!/2` call when the
      consumer is ready.

  No Ecto schema, no migration, no adapter pattern. The `.fresco` file
  IS the storage; Etcher annotations live inside its `extensions.etcher`
  map alongside the image layout.

  ## Quick start

  Install (in your `mix.exs`):

      def deps do
        [
          {:fresco, "~> 0.5"},
          {:etcher, "~> 0.3"}
        ]
      end

  Wire the JS hook (in `assets/js/app.js`):

      import "../../deps/fresco/priv/static/fresco.js"
      import "../../deps/etcher/priv/static/etcher.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.FrescoHooks, ...window.EtcherHooks, ...colocatedHooks }
      })

  Drop in a LiveView. Build the canvas in `mount/3`, render `<Fresco.canvas>`
  alongside `<Etcher.layer>`, handle the `etcher:annotations-changed` event:

      @impl true
      def mount(_params, _session, socket) do
        canvas =
          Fresco.Canvas.new(width: 4000, height: 3000)
          |> Fresco.Canvas.add_image(%{src: "/uploads/a.jpg", x: 0, y: 0, width: 2000})

        {:ok, assign(socket, canvas: canvas)}
      end

      @impl true
      def render(assigns) do
        ~H\"\"\"
        <Fresco.canvas id="board" canvas={@canvas} class="w-full h-screen" />
        <Etcher.layer fresco_id="board" />
        <button phx-click="save">Save canvas</button>
        \"\"\"
      end

      @impl true
      def handle_event("etcher:annotations-changed", %{"annotations" => annotations}, socket) do
        new_canvas =
          Fresco.Canvas.put_extension(socket.assigns.canvas, "etcher", %{
            "version" => "1",
            "annotations" => annotations
          })

        {:noreply, assign(socket, canvas: new_canvas)}
      end

      def handle_event("save", _params, socket) do
        :ok = Fresco.Canvas.write!("/tmp/scene.fresco", socket.assigns.canvas)
        {:noreply, socket}
      end

  Re-mounting later with `Fresco.Canvas.read!/1` re-hydrates the canvas
  + annotations in one shot — `<Etcher.layer>` reads its initial state
  from `handle.getExtension("etcher")` at mount time.

  ## Storage flexibility

  The `.fresco` file isn't the only target. `Fresco.Canvas.to_json!/1`
  yields a JSON string you can stash anywhere: a Postgres `:jsonb` column,
  an S3 object, a Redis key, a file. Etcher annotations travel with the
  canvas wherever it goes.

  See `Etcher.Layer` for the component reference.
  """

  defdelegate layer(assigns), to: Etcher.Layer
end
