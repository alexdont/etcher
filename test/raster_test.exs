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

      # The fillable kinds carry the body the canvas paints on them (semi by
      # default); a shaft has no inside, so it draws bare.
      assert "fill-opacity 0.18 rectangle 10,20 40,60" in draws
      assert "fill-opacity 0.18 circle 50,60 50,55" in draws
      assert "fill-opacity 0.18 polygon 0,0 10,0 10,10" in draws
      assert "fill-opacity 0.18 polyline 0,0 5,5" in draws
      assert "line 0,0 10,10" in draws

      # A dimension is its shaft plus a V at each end — that pair is what
      # tells it apart from a plain line at a glance.
      assert "line 1,1 2,2" in draws

      heads =
        Enum.filter(draws, &String.starts_with?(&1, "polyline 1")) ++
          Enum.filter(draws, &String.starts_with?(&1, "polyline 2"))

      assert length(heads) == 2, "expected a head at each end, got: #{inspect(draws)}"
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
      assert prim =~ ~r/^fill-opacity [\d.]+ polyline 0,0 /
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

      assert "fill-opacity 0.18 circle 2,2 2,0" in for(
               ["-draw", v] <- Enum.chunk_every(args, 2, 1),
               do: v
             )
    end
  end

  describe "a dimension reads as a measurement" do
    test "shaft plus a V at each end, both opening back along the line" do
      args = Raster.to_draw_args([shape("dimension", %{"a" => [0, 0], "b" => [100, 0]})])
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v

      assert "line 0,0 100,0" in draws

      heads = Enum.filter(draws, &String.starts_with?(&1, "polyline"))
      assert length(heads) == 2, "a dimension has two ends"

      # Each V has its point ON an endpoint, with its two wings set back
      # toward the other end — which is what makes the pair read as arrows
      # rather than as ticks.
      tips =
        Enum.map(heads, fn head ->
          ["polyline", _wing_a, tip, _wing_b] = String.split(head, " ")
          tip
        end)

      assert Enum.sort(tips) == ["0,0", "100,0"]

      # Wings set back along the shaft — both at the same distance, on
      # either side of it.
      for head <- heads do
        ["polyline", a, _tip, b] = String.split(head, " ")
        [ax, ay] = String.split(a, ",") |> Enum.map(&String.to_float/1)
        [bx, by] = String.split(b, ",") |> Enum.map(&String.to_float/1)
        assert_in_delta ax, bx, 0.001, "the wings sit level along the line"
        assert_in_delta ay, -by, 0.001, "and symmetrically across it"
        assert abs(ay) > 1, "a head with no width is a tick, not an arrow"
      end
    end

    test "a line is still a bare line — the heads are the difference" do
      args = Raster.to_draw_args([shape("line", %{"a" => [0, 0], "b" => [100, 0]})])
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert draws == ["line 0,0 100,0"]
    end

    test "a degenerate dimension draws no spike in an arbitrary direction" do
      args = Raster.to_draw_args([shape("dimension", %{"a" => [5, 5], "b" => [5, 5]})])
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      refute Enum.any?(draws, &String.starts_with?(&1, "polyline"))
    end
  end

  describe "the label a shape carries" do
    test "a dimension's measurement rides the middle of its line" do
      dim = %{
        "kind" => "dimension",
        "geometry" => %{"a" => [0, 500], "b" => [1000, 500]},
        "metadata" => %{"title" => "7cm"}
      }

      args = Raster.to_draw_args([dim], canvas_width: 1000, canvas_height: 1000)
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      text = Enum.find(draws, &String.starts_with?(&1, "text "))

      assert text, "the measurement is the point of a dimension"
      assert text =~ "'7cm'"

      [x, y] = Regex.run(~r/^text (\d+),(\d+)/, text, capture: :all_but_first)
      {x, y} = {String.to_integer(x), String.to_integer(y)}
      # Centred on the shaft's midpoint, give or take the box's own padding.
      assert abs(x - 500) < 60, "expected the label near the middle, got x=#{x}"
      assert abs(y - 500) < 30, "expected the label on the line, got y=#{y}"
    end

    test "title_offset slides it along the line" do
      near_start = %{
        "kind" => "dimension",
        "geometry" => %{"a" => [0, 0], "b" => [1000, 0]},
        "metadata" => %{"title" => "x", "title_offset" => 0.1}
      }

      args = Raster.to_draw_args([near_start], canvas_width: 1000, canvas_height: 1000)
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      text = Enum.find(draws, &String.starts_with?(&1, "text "))
      [x] = Regex.run(~r/^text (\d+),/, text, capture: :all_but_first)
      assert String.to_integer(x) < 200
    end

    test "title_align centres a label inside its shape" do
      rect = %{
        "kind" => "rectangle",
        "geometry" => %{"x" => 0, "y" => 0, "w" => 1000, "h" => 1000},
        "metadata" => %{"title" => "door", "title_align" => %{"h" => "center", "v" => "middle"}}
      }

      args = Raster.to_draw_args([rect], canvas_width: 1000, canvas_height: 1000)
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      text = Enum.find(draws, &String.starts_with?(&1, "text "))
      [x, y] = Regex.run(~r/^text (\d+),(\d+)/, text, capture: :all_but_first)

      assert abs(String.to_integer(x) - 500) < 80
      assert abs(String.to_integer(y) - 500) < 40
    end

    test "a title stored beside the annotation is read too" do
      # PhoenixKit keeps it in its own column rather than inside `metadata`;
      # a renderer that only looked in one place silently dropped every
      # label such a host had.
      args =
        Raster.to_draw_args(
          [
            %{
              "kind" => "rectangle",
              "geometry" => %{"x" => 0, "y" => 0, "w" => 100, "h" => 100},
              "title" => "from the column"
            }
          ],
          canvas_width: 1000,
          canvas_height: 1000
        )

      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert Enum.any?(draws, &(&1 =~ "'from the column'"))
    end

    test "label size follows the canvas, like every other ink measure" do
      shape = %{
        "kind" => "rectangle",
        "geometry" => %{"x" => 0, "y" => 0, "w" => 100, "h" => 100},
        "metadata" => %{"title" => "hi"}
      }

      small = Raster.to_draw_args([shape], canvas_width: 1000, canvas_height: 1000)
      big = Raster.to_draw_args([shape], canvas_width: 5000, canvas_height: 3000)

      size = fn args ->
        [_, v] = Enum.find(Enum.chunk_every(args, 2, 1), &match?(["-pointsize", _], &1))
        String.to_integer(v)
      end

      assert size.(big) > size.(small) * 4,
             "a label on a 5000px photo must not bake at the size it takes on a 1000px one"
    end

    test "an untitled shape draws no label" do
      args = Raster.to_draw_args([shape("rectangle", %{"x" => 0, "y" => 0, "w" => 1, "h" => 1})])
      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      refute Enum.any?(draws, &String.starts_with?(&1, "text "))
    end

    test "the label takes its own colour when it has one, else the shape's" do
      base = %{"kind" => "rectangle", "geometry" => %{"x" => 0, "y" => 0, "w" => 10, "h" => 10}}

      own =
        Raster.to_draw_args([
          Map.merge(base, %{
            "style" => %{"color" => "#111111"},
            "metadata" => %{"title" => "t", "title_color" => "#00ff00"}
          })
        ])

      inherited =
        Raster.to_draw_args([
          Map.merge(base, %{"style" => %{"color" => "#111111"}, "metadata" => %{"title" => "t"}})
        ])

      assert "#00ff00" in own
      refute "#00ff00" in inherited
      assert "#111111" in inherited
    end
  end

  describe "the body a shape is filled with" do
    test "semi by default, solid when asked, damped by the shape's opacity" do
      draw = fn style ->
        args =
          Raster.to_draw_args([
            shape("rectangle", %{"x" => 0, "y" => 0, "w" => 1, "h" => 1}, style)
          ])

        for(["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v) |> hd()
      end

      assert draw.(nil) =~ "fill-opacity 0.18 "
      assert draw.(%{"fill" => "semi"}) =~ "fill-opacity 0.18 "
      assert draw.(%{"fill" => "solid"}) =~ "fill-opacity 1.0 "
      assert draw.(%{"fill" => "solid", "opacity" => 0.5}) =~ "fill-opacity 0.5 "
      assert draw.(%{"fill" => "none"}) == "rectangle 0,0 1,1"

      # The hatch has no counterpart at this scale; it bakes as the tint it
      # would read as anyway.
      assert draw.(%{"fill" => "pattern"}) =~ "fill-opacity 0.18 "
    end

    test "the kinds with no inside are never filled" do
      for kind <- ["line", "dimension", "arrow", "marker"] do
        geom =
          case kind do
            "marker" -> %{"points" => [[0, 0], [5, 5]]}
            _ -> %{"a" => [0, 0], "b" => [10, 10]}
          end

        args = Raster.to_draw_args([shape(kind, geom, %{"fill" => "solid"})])
        draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v

        refute Enum.any?(draws, &String.contains?(&1, "fill-opacity")),
               "#{kind} has no body to fill"
      end
    end

    test "the fill colour is the shape's colour" do
      args =
        Raster.to_draw_args([
          shape("circle", %{"cx" => 1, "cy" => 1, "r" => 1}, %{"color" => "#00ff00"})
        ])

      pairs = Enum.chunk_every(args, 2, 1)
      assert ["-fill", "#00ff00"] in pairs
      assert ["-stroke", "#00ff00"] in pairs
    end
  end

  describe "labels — glyphs, not boxes" do
    defp labeled(kind, geometry, title) do
      %{"kind" => kind, "geometry" => geometry, "metadata" => %{"title" => title}}
    end

    test "a titled text shape bakes as drawn text, with no rectangle" do
      args =
        Raster.to_draw_args([
          labeled("text", %{"x" => 100, "y" => 200, "w" => 300, "h" => 40}, "hello world")
        ])

      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      assert ["text " <> _] = draws
      assert hd(draws) =~ "'hello world'"
      refute Enum.any?(draws, &String.starts_with?(&1, "rectangle"))
      # Font tracks the box height (65% of 40 = 26) and the draw origin sits
      # inside the box, not on its corner.
      assert ["-pointsize", "26"] in Enum.chunk_every(args, 2, 1)
      assert hd(draws) =~ ~r/^text 105,230 /
    end

    test "text draws are filled with the shape colour and the fill is reset after" do
      args =
        Raster.to_draw_args([
          labeled("text", %{"x" => 0, "y" => 0, "w" => 10, "h" => 10}, "a"),
          shape("rectangle", %{"x" => 1, "y" => 1, "w" => 2, "h" => 2})
        ])

      pairs = Enum.chunk_every(args, 2, 1)
      # The label sets a real fill…
      assert ["-fill", "#ef4444"] in pairs
      # …and hands `none` back before the rectangle outline draws, so the
      # rectangle isn't silently filled with the label's colour.
      fill_none_count = Enum.count(pairs, &(&1 == ["-fill", "none"]))
      assert fill_none_count >= 2
    end

    test "quotes and backslashes cannot escape the IM draw string; whitespace collapses" do
      # Title carries a quote, a real backslash, a newline and a tab:
      #   it's a\two   +  "\nline"
      title = "it's a" <> "\\" <> "two\nline"

      args =
        Raster.to_draw_args([
          labeled("text", %{"x" => 0, "y" => 0, "w" => 10, "h" => 10}, title)
        ])

      [draw] = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      # The quote and the backslash are escaped, the newline collapses to a
      # space — one drawable line, still inside one quoted IM argument.
      assert draw =~ "'it" <> "\\'" <> "s a" <> "\\\\" <> "two line'"
    end

    test "a titled callout bakes leader + underline + glyphs, and no box" do
      args =
        Raster.to_draw_args([
          labeled(
            "callout",
            %{
              "anchor" => [10, 100],
              "text_box" => %{"x" => 50, "y" => 20, "w" => 80, "h" => 20}
            },
            "check this"
          )
        ])

      draws = for ["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v
      refute Enum.any?(draws, &String.starts_with?(&1, "rectangle"))
      # leader: anchor to the box's bottom-left corner
      assert "line 10,100 50,40" in draws
      # underline along the bottom edge
      assert "line 50,40 130,40" in draws
      assert Enum.any?(draws, &(&1 =~ "'check this'"))
    end

    test "an untitled label still falls back to its box" do
      args = Raster.to_draw_args([shape("text", %{"x" => 1, "y" => 2, "w" => 3, "h" => 4})])
      assert "rectangle 1,2 4,6" in for(["-draw", v] <- Enum.chunk_every(args, 2, 1), do: v)

      blank = %{
        "kind" => "text",
        "geometry" => %{"x" => 1, "y" => 2, "w" => 3, "h" => 4},
        "metadata" => %{"title" => "   "}
      }

      args2 = Raster.to_draw_args([blank])
      assert "rectangle 1,2 4,6" in for(["-draw", v] <- Enum.chunk_every(args2, 2, 1), do: v)
    end

    test "to_svg renders a <text> element with markup escaped and a font floor" do
      svg =
        Raster.to_svg(
          [labeled("text", %{"x" => 5, "y" => 5, "w" => 40, "h" => 4}, "<b>&yo</b>")],
          width: 100,
          height: 100
        )

      assert svg =~ "<text "
      assert svg =~ "&lt;b&gt;&amp;yo&lt;/b&gt;"
      refute svg =~ "<rect"
      # h=4 would give a 2.6px font; the floor keeps it legible.
      assert svg =~ ~s(font-size="8")
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
