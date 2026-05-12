defmodule EtcherTest do
  use ExUnit.Case, async: true
  use Phoenix.Component

  describe "Etcher.Annotation changeset" do
    alias Etcher.Annotation

    test "accepts a valid rectangle" do
      changeset =
        Annotation.changeset(%Annotation{}, %{
          target_type: "file",
          target_uuid: Ecto.UUID.generate(),
          kind: "rectangle",
          geometry: %{"x" => 10, "y" => 20, "w" => 100, "h" => 50}
        })

      assert changeset.valid?
    end

    test "rejects unknown kinds" do
      changeset =
        Annotation.changeset(%Annotation{}, %{
          target_type: "file",
          target_uuid: Ecto.UUID.generate(),
          kind: "spiral",
          geometry: %{}
        })

      refute changeset.valid?
      assert %{kind: ["is invalid"]} = errors_on(changeset)
    end

    test "requires target_type, target_uuid, kind, geometry" do
      changeset = Annotation.changeset(%Annotation{}, %{})
      refute changeset.valid?
      errors = errors_on(changeset)
      assert errors[:target_type]
      assert errors[:target_uuid]
      assert errors[:kind]
      assert errors[:geometry]
    end

    test "caps target_type length at 64" do
      changeset =
        Annotation.changeset(%Annotation{}, %{
          target_type: String.duplicate("x", 65),
          target_uuid: Ecto.UUID.generate(),
          kind: "circle",
          geometry: %{}
        })

      refute changeset.valid?
      assert errors_on(changeset)[:target_type]
    end

    defp errors_on(changeset) do
      Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
        Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
          opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
        end)
      end)
    end
  end

  describe "Etcher.Storage.Default without a configured Repo" do
    setup do
      previous = Application.get_env(:etcher, :repo)
      Application.delete_env(:etcher, :repo)

      on_exit(fn ->
        if previous, do: Application.put_env(:etcher, :repo, previous), else: :ok
      end)
    end

    test "create/1 returns :no_repo_configured" do
      assert Etcher.Storage.Default.create(%{kind: "rectangle"}) ==
               {:error, :no_repo_configured}
    end

    test "list_for/2 returns an empty list rather than crashing" do
      assert Etcher.Storage.Default.list_for("file", Ecto.UUID.generate()) == []
    end

    test "update/2 returns :no_repo_configured" do
      assert Etcher.Storage.Default.update(Ecto.UUID.generate(), %{}) ==
               {:error, :no_repo_configured}
    end

    test "delete/1 returns :no_repo_configured" do
      assert Etcher.Storage.Default.delete(Ecto.UUID.generate()) ==
               {:error, :no_repo_configured}
    end
  end

  describe "Etcher.Layer component" do
    import Phoenix.LiveViewTest

    test "renders the hidden host with hook + data attributes" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer
          fresco_id="photo"
          target_type="file"
          target_uuid="abc-123"
          initial_annotations={[%{uuid: "u1", kind: "rectangle", geometry: %{x: 0, y: 0, w: 1, h: 1}}]}
          tools={[:rectangle, :freehand]}
        />
        """)

      assert html =~ ~s(id="etcher-layer-photo")
      assert html =~ ~s(phx-hook="EtcherLayer")
      assert html =~ ~s(data-fresco-id="photo")
      assert html =~ ~s(data-target-type="file")
      assert html =~ ~s(data-target-uuid="abc-123")
      assert html =~ ~s(class="hidden")
      assert html =~ ~s(aria-hidden="true")
      assert html =~ "rectangle"
      assert html =~ "freehand"
    end

    test "honors a custom id" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer
          id="my-layer"
          fresco_id="photo"
          target_type="file"
          target_uuid="abc"
        />
        """)

      assert html =~ ~s(id="my-layer")
    end
  end
end
