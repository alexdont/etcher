defmodule Mix.Tasks.Etcher.Gen.Migration do
  @shortdoc "Generate the etcher_annotations migration"

  @moduledoc """
  Generates a migration that creates the `etcher_annotations` table used by
  `Etcher.Storage.Default`.

      mix etcher.gen.migration

  The migration is written into the consumer's `priv/repo/migrations/`
  directory with a timestamped filename, just like `mix ecto.gen.migration`.

  ## Options

    * `-r`, `--repo` — the Repo module to target. Defaults to the first repo
      in your Mix project's `:ecto_repos` config.

  ## After running

      mix ecto.migrate

  Consumers who roll their own annotation schema can skip this generator
  entirely and implement the `Etcher.Storage` behaviour against their own
  table.
  """

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    {opts, _argv, _} =
      OptionParser.parse(args, switches: [repo: :string], aliases: [r: :repo])

    repo = resolve_repo(opts[:repo])
    migrations_dir = Path.join([source_repo_priv(repo), "migrations"])
    File.mkdir_p!(migrations_dir)

    timestamp = format_timestamp(NaiveDateTime.utc_now())
    name = "create_etcher_annotations"
    filename = "#{timestamp}_#{name}.exs"
    path = Path.join(migrations_dir, filename)

    if Enum.any?(File.ls!(migrations_dir), &String.ends_with?(&1, "_#{name}.exs")) do
      Mix.shell().info("[etcher] Skipping — migration already exists: #{name}")
    else
      module = Module.concat([app_module(repo), "Repo", "Migrations", Macro.camelize(name)])
      File.write!(path, migration_template(module))
      Mix.shell().info("[etcher] Created #{Path.relative_to_cwd(path)}")
    end
  end

  defp resolve_repo(nil) do
    case Mix.Project.config()[:app] |> Application.get_env(:ecto_repos) do
      [repo | _] -> repo
      _ -> Mix.raise("No Ecto repos configured. Pass --repo MyApp.Repo.")
    end
  end

  defp resolve_repo(name) when is_binary(name) do
    Module.concat([name])
  end

  defp source_repo_priv(repo) do
    config = repo.config()
    priv = config[:priv] || "priv/#{repo |> Module.split() |> List.last() |> Macro.underscore()}"
    Path.join(File.cwd!(), priv)
  rescue
    UndefinedFunctionError ->
      # Repo isn't loaded (e.g., generator run before deps compile). Fall
      # back to the conventional default.
      Path.join([File.cwd!(), "priv", "repo"])
  end

  defp app_module(repo) do
    repo |> Module.split() |> List.first()
  end

  defp format_timestamp(%NaiveDateTime{} = ts) do
    [ts.year, ts.month, ts.day, ts.hour, ts.minute, ts.second]
    |> Enum.map_join("", fn n -> n |> Integer.to_string() |> String.pad_leading(2, "0") end)
  end

  defp migration_template(module) do
    """
    defmodule #{inspect(module)} do
      use Ecto.Migration

      def up do
        execute(\"\"\"
        CREATE TABLE IF NOT EXISTS etcher_annotations (
          uuid uuid PRIMARY KEY,
          target_type varchar(64) NOT NULL,
          target_uuid uuid NOT NULL,
          creator_uuid uuid,
          kind varchar(32) NOT NULL,
          geometry jsonb NOT NULL,
          style jsonb,
          metadata jsonb,
          position integer NOT NULL DEFAULT 0,
          inserted_at timestamp(0) NOT NULL,
          updated_at timestamp(0) NOT NULL
        )
        \"\"\")

        execute(\"\"\"
        CREATE INDEX IF NOT EXISTS etcher_annotations_target_index
          ON etcher_annotations (target_type, target_uuid)
        \"\"\")
      end

      def down do
        execute("DROP INDEX IF EXISTS etcher_annotations_target_index")
        execute("DROP TABLE IF EXISTS etcher_annotations")
      end
    end
    """
  end
end
