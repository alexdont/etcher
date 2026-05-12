defmodule Etcher.Storage.Default do
  @moduledoc """
  Default `Etcher.Storage` implementation backed by the bundled
  `etcher_annotations` table.

  Reads the consumer's Repo from `config :etcher, repo: MyApp.Repo`.
  If `:etcher, :repo` is missing, `create/1` / `update/2` / `delete/1`
  return `{:error, :no_repo_configured}` rather than crashing.

  Consumers with custom schemas should implement their own
  `Etcher.Storage` adapter instead of using this one.
  """

  @behaviour Etcher.Storage

  import Ecto.Query, only: [from: 2]

  alias Etcher.Annotation

  @impl true
  def create(attrs) do
    with {:ok, repo} <- repo() do
      %Annotation{}
      |> Annotation.changeset(normalize(attrs))
      |> repo.insert()
    end
  end

  @impl true
  def list_for(target_type, target_uuid) do
    case repo() do
      {:ok, repo} ->
        repo.all(
          from(a in Annotation,
            where: a.target_type == ^target_type and a.target_uuid == ^target_uuid,
            order_by: [asc: a.position, asc: a.inserted_at]
          )
        )

      {:error, _} ->
        []
    end
  end

  @impl true
  def update(uuid, attrs) do
    with {:ok, repo} <- repo(),
         %Annotation{} = annotation <- repo.get(Annotation, uuid) do
      annotation
      |> Annotation.changeset(normalize(attrs))
      |> repo.update()
    else
      nil -> {:error, :not_found}
      {:error, _} = err -> err
    end
  end

  @impl true
  def delete(uuid) do
    with {:ok, repo} <- repo(),
         %Annotation{} = annotation <- repo.get(Annotation, uuid) do
      case repo.delete(annotation) do
        {:ok, _} -> :ok
        {:error, _} = err -> err
      end
    else
      nil -> {:error, :not_found}
      {:error, _} = err -> err
    end
  end

  # ---------------------------------------------------------------------------

  defp repo do
    case Application.get_env(:etcher, :repo) do
      nil -> {:error, :no_repo_configured}
      repo -> {:ok, repo}
    end
  end

  # Accept both string-keyed (from LiveView events) and atom-keyed maps.
  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> Enum.into(%{}, fn
      {k, v} when is_binary(k) -> {String.to_existing_atom(k), v}
      {k, v} -> {k, v}
    end)
  rescue
    ArgumentError -> attrs
  end
end
