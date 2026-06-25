defmodule Etcher.RasterTest do
  use ExUnit.Case, async: true
  doctest Etcher.Raster

  alias Etcher.Raster

  defp shape(kind, geometry, style \\ nil) do
    base = %{"kind" => kind, "geometry" => geometry}
    if style, do: Map.put(base, "style", style), else: base
  end

  describe "to_draw_args/2 — per kind" do
    test "rectangle / circle / line / polygon / freehand map to IM primitives" do
      shapes = [
        shape("rectangle", %{"x" => 10, "y" => 20, "w" => 30, "h" => 40}),
        shape("circle", %{"cx" => 50, "cy" => 60, "r" => 5}),
        shape("line", %{"a" => [0, 0], "b" => [10, 10]}),
        shape("dimension", %{"a" => [1, 1], "b" => [2, 2]}),
        shape("polygon", %{"points" => [[0, 0], [10, 0], [10, 10]]}),
        shape("freehand", %{"points" => [[0, 0], [5, 5]]})
      ]

      args = Raster.to_draw_args(shapes)

      assert hd(args) == "-fill"
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert "rectangle 10,20 40,60" in draws
      assert "circle 50,60 50,55" in draws
      assert "line 0,0 10,10" in draws
      assert "line 1,1 2,2" in draws
      assert "polygon 0,0 10,0 10,10" in draws
      assert "polyline 0,0 5,5" in draws
    end

    test "honours per-shape style colour, else the default" do
      colored =
        shape("rectangle", %{"x" => 0, "y" => 0, "w" => 1, "h" => 1}, %{"color" => "#00ff00"})

      plain = shape("circle", %{"cx" => 1, "cy" => 1, "r" => 1})

      args = Raster.to_draw_args([colored, plain], default_color: "#000")
      assert "#00ff00" in args
      assert "#000" in args
    end

    test "stroke_width is applied" do
      args =
        Raster.to_draw_args([shape("circle", %{"cx" => 1, "cy" => 1, "r" => 1})], stroke_width: 7)

      assert "7" in args
    end

    test "marker strokes (point-based) render as a polyline" do
      args = Raster.to_draw_args([shape("marker", %{"points" => [[0, 0], [4, 6], [8, 2]]})])
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert "polyline 0,0 4,6 8,2" in draws
    end

    test "vector freehand (cubic-bezier nodes) is flattened to a polyline through its anchors" do
      # A straight two-node stroke (no handles) flattens to a polyline whose
      # endpoints are the node anchors.
      nodes = [%{"p" => [0, 0]}, %{"p" => [30, 0]}]
      args = Raster.to_draw_args([shape("freehand", %{"nodes" => nodes})])
      [prim] = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert prim =~ ~r/^polyline 0,0 /
      assert prim =~ "30,0"
    end

    test "unknown / unsupported / malformed shapes are skipped" do
      assert Raster.to_draw_args([shape("eraser", %{})]) == []
      assert Raster.to_draw_args([shape("text", %{"x" => 1})]) == []
      assert Raster.to_draw_args([shape("mystery", %{"foo" => 1})]) == []
      assert Raster.to_draw_args([]) == []
    end

    test "accepts atom-keyed annotations too" do
      args = Raster.to_draw_args([%{kind: "circle", geometry: %{"cx" => 2, "cy" => 2, "r" => 2}}])
      assert "circle 2,2 2,0" in for(["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v)
    end
  end

  describe "to_svg/2" do
    test "renders a sized viewBox with object-cover-matching slice" do
      svg =
        Raster.to_svg([shape("rectangle", %{"x" => 0, "y" => 0, "w" => 10, "h" => 10})],
          width: 200,
          height: 100
        )

      assert svg =~ ~s(viewBox="0 0 200 100")
      assert svg =~ ~s(preserveAspectRatio="xMidYMid slice")
      assert svg =~ ~s(<rect x="0" y="0" width="10" height="10")
    end

    test "empty when nothing drawable" do
      assert Raster.to_svg([shape("eraser", %{})]) == ""
    end
  end
end
