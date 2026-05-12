defmodule Etcher do
  @moduledoc """
  Etcher is the annotation layer for [Fresco](https://hex.pm/packages/fresco)-based
  image viewers in Phoenix.

  An *etcher* is the tool that incises marks into a surface — Etcher the
  library does the same digitally: users draw shapes (rectangle, circle,
  polygon, freehand) on top of any Fresco viewer; the LiveView fires
  events with the resulting geometry; the consumer decides what to
  persist.

  ## Two pieces

    * **Client side**: an `<Etcher.layer>` component that attaches to a
      named Fresco viewer, adds a pencil button to its nav, opens a
      bottom toolbar with drawing tools when active. Built from scratch
      — no Annotorious dependency.
    * **Server side**: a pluggable storage adapter (`Etcher.Storage`
      behaviour) with a sensible default (`Etcher.Storage.Default`)
      backed by a bundled `etcher_annotations` table. Consumers with
      custom needs implement their own adapter.

  ## Quick start

  Install (in your `mix.exs`):

      def deps do
        [
          {:fresco, "~> 0.2"},
          {:etcher, "~> 0.1"}
        ]
      end

  Generate the default schema:

      mix etcher.gen.migration
      mix ecto.migrate

  Configure (in `config/config.exs`):

      config :etcher, repo: MyApp.Repo

  Wire the JS hook (in `assets/js/app.js`):

      import "../../deps/fresco/priv/static/fresco.js"
      import "../../deps/etcher/priv/static/etcher.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.FrescoHooks, ...window.EtcherHooks, ...colocatedHooks }
      })

  Drop in a LiveView:

      <Fresco.viewer id="demo" src={~p"/uploads/photo.jpg"} class="w-full h-[80vh]" />
      <Etcher.layer fresco_id="demo" target_type="file" target_uuid={@file.uuid} />

  Then handle the `etcher:created` event in your LiveView:

      def handle_event("etcher:created", attrs, socket) do
        case Etcher.create_annotation(attrs) do
          {:ok, annotation} ->
            {:noreply, push_event(socket, "etcher:annotation-saved", annotation)}
          {:error, changeset} ->
            {:noreply, put_flash(socket, :error, "Failed to save annotation")}
        end
      end

  ## Custom storage

  Skip the bundled schema and implement your own adapter:

      defmodule MyApp.AnnotationStorage do
        @behaviour Etcher.Storage

        def create(attrs), do: # your insert logic
        def list_for(target_type, target_uuid), do: # your query
        def update(uuid, attrs), do: # your update
        def delete(uuid), do: # your delete
      end

  Then from your event handler:

      MyApp.AnnotationStorage.create(attrs)

  Etcher's component doesn't run any persistence itself — it fires
  events and lets the consumer decide what happens. The bundled
  `Etcher.create_annotation/1` etc. are just shortcuts for consumers
  who want the default backend.

  See `Etcher.Layer` for the component reference, `Etcher.Storage` for
  the behaviour, and `Etcher.Annotation` for the bundled schema.
  """

  defdelegate layer(assigns), to: Etcher.Layer

  defdelegate create_annotation(attrs), to: Etcher.Storage.Default, as: :create

  defdelegate list_annotations_for(target_type, target_uuid),
    to: Etcher.Storage.Default,
    as: :list_for

  defdelegate update_annotation(uuid, attrs), to: Etcher.Storage.Default, as: :update
  defdelegate delete_annotation(uuid), to: Etcher.Storage.Default, as: :delete
end
