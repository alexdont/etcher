defmodule Etcher.Annotation do
  @moduledoc """
  Ecto schema for the bundled `etcher_annotations` table.

  Used by `Etcher.Storage.Default`. Consumers who implement their own
  `Etcher.Storage` adapter against a custom table can ignore this
  schema entirely.

  ## Fields

    * `:uuid` — UUIDv7 primary key
    * `:target_type` — string identifying the kind of resource the
      annotation is on (e.g. `"file"`, `"document"`, `"product"`)
    * `:target_uuid` — UUID of the resource
    * `:creator_uuid` — UUID of the user who drew it (nullable)
    * `:kind` — `"rectangle"` | `"circle"` | `"polygon"` | `"freehand"`
    * `:geometry` — JSONB; shape-specific coordinates in image pixels
        * rectangle: `%{"x" => x, "y" => y, "w" => w, "h" => h}`
        * circle: `%{"cx" => cx, "cy" => cy, "r" => r}`
        * polygon: `%{"points" => [[x1, y1], [x2, y2], ...]}`
        * freehand: `%{"points" => [[x1, y1], [x2, y2], ...]}`
    * `:style` — JSONB; optional stroke color / line width
    * `:metadata` — JSONB; consumer-defined extension point (link to
      external systems, tags, etc.)
    * `:position` — integer; ordering on the same target
    * `:inserted_at` / `:updated_at` — timestamps
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:uuid, Ecto.UUID, autogenerate: true}
  @foreign_key_type Ecto.UUID

  @kinds ~w(rectangle circle polygon freehand)

  schema "etcher_annotations" do
    field(:target_type, :string)
    field(:target_uuid, Ecto.UUID)
    field(:creator_uuid, Ecto.UUID)
    field(:kind, :string)
    field(:geometry, :map)
    field(:style, :map)
    field(:metadata, :map)
    field(:position, :integer, default: 0)

    timestamps(type: :utc_datetime)
  end

  @cast_fields ~w(target_type target_uuid creator_uuid kind geometry style metadata position)a
  @required_fields ~w(target_type target_uuid kind geometry)a

  @doc false
  def changeset(annotation, attrs) do
    annotation
    |> cast(attrs, @cast_fields)
    |> validate_required(@required_fields)
    |> validate_inclusion(:kind, @kinds)
    |> validate_length(:target_type, min: 1, max: 64)
  end
end
