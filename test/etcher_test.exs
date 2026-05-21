defmodule EtcherTest do
  use ExUnit.Case, async: true
  use Phoenix.Component

  describe "Etcher.Layer component" do
    import Phoenix.LiveViewTest

    test "renders the hidden host with hook + fresco_id" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" />
        """)

      assert html =~ ~s(id="etcher-layer-board")
      assert html =~ ~s(phx-hook="EtcherLayer")
      assert html =~ ~s(data-fresco-id="board")
      assert html =~ ~s(class="hidden")
      assert html =~ ~s(aria-hidden="true")
    end

    test "default :tools list renders all seven shapes plus the eraser" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" />
        """)

      assert html =~ "rectangle"
      assert html =~ "circle"
      assert html =~ "polygon"
      assert html =~ "freehand"
      assert html =~ "callout"
      assert html =~ "text"
      assert html =~ "dimension"
      assert html =~ "eraser"
    end

    test "custom :tools list narrows the toolbar payload" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" tools={[:rectangle, :freehand]} />
        """)

      assert html =~ "rectangle"
      assert html =~ "freehand"
      refute html =~ "polygon"
      refute html =~ "dimension"
    end

    test "honors a custom :id" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer id="my-layer" fresco_id="board" />
        """)

      assert html =~ ~s(id="my-layer")
    end

    test "does NOT emit the dropped 0.2.x attrs" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" />
        """)

      # Annotations now hydrate from <Fresco.canvas>'s extensions.etcher
      # blob (via handle.getExtension at mount), not these legacy attrs.
      refute html =~ "data-target-type"
      refute html =~ "data-target-uuid"
      refute html =~ "data-initial-annotations"
    end

    test "passes global attrs through :rest" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" data-extra="yes" />
        """)

      assert html =~ ~s(data-extra="yes")
    end

    test "nav_buttons + toolbar default to omitted (all chrome on)" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" />
        """)

      refute html =~ "data-nav-buttons"
      refute html =~ "data-toolbar"
    end

    test "empty :nav_buttons list renders the `none` sentinel (hide all nav chrome)" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" nav_buttons={[]} />
        """)

      assert html =~ ~s(data-nav-buttons="none")
    end

    test ":nav_buttons subset renders the CSV allowlist" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" nav_buttons={[:pencil]} />
        """)

      assert html =~ ~s(data-nav-buttons="pencil")
    end

    test ":toolbar=false renders data-toolbar=\"false\"" do
      assigns = %{}

      html =
        rendered_to_string(~H"""
        <Etcher.Layer.layer fresco_id="board" toolbar={false} />
        """)

      assert html =~ ~s(data-toolbar="false")
    end
  end
end
