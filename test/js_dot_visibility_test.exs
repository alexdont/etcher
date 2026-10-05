defmodule Etcher.JsDotVisibilityTest do
  @moduledoc """
  Runs `test/js/dot_visibility_test.js`, and pins the render that uses it.

  Two reports, a day apart, the second correcting the first. Dots placed with
  the marker could not be seen zoomed out; the first fix gave them a floor — a
  minimum size on screen — which made them phantoms: "when I zoom out the dots
  never change size, they get bigger relative to the other lines". Quite
  right. A dot drawn on a board is a mark ON the board, and pulling away from
  it makes it smaller, exactly as it does the stroke beside it.

  So there is no dot floor. A dot's size is its round cap, which is the stroke
  width, which scales with the zoom and stops at the same hairline floor every
  marker stroke stops at.

  What a dot does need is a PATH the renderer believes in. `_commitFreehand`
  stores it a hundredth of an image px long so the browser has a hit region;
  at 0.007 zoom that is seven hundred-thousandths of a screen px. Measured
  through the same rasteriser the SVG uses, that path paints one pixel at
  64/255 where a real segment gives 0/255 — and WebKit drops degenerate
  subpaths outright, which is why an iPhone placed dots it never drew until
  you zoomed in far enough to lend the thing some length. It is drawn one
  DEVICE pixel long instead: the least that always paints, the least that can
  be seen, and nothing anyone looks at — the cap is.

  The length is applied at render, not stored. `_renderShape` runs on every
  pan and zoom frame, so this fixes dots already sitting on a board, and
  changes nothing about what is on disk.
  """

  use ExUnit.Case, async: true

  @script Path.expand("js/dot_visibility_test.js", __DIR__)
  @source Path.expand("../priv/static/etcher.js", __DIR__)

  test "a dot keeps a visible size at any zoom" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js dot visibility checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "dot visibility checks failed:\n\n#{output}"
    end
  end

  describe "the ink scales, on every frame" do
    test "the marker re-styles as the zoom changes, with no dot in the question" do
      # `_renderShape` runs on every pan and zoom frame, and the width is
      # recomputed there — which is what makes a stroke behave like ink on the
      # board. The styling is not told whether it is drawing a dot, because a
      # dot is not a different size: it is this width, seen end-on.
      src = File.read!(@source)

      assert src =~
               "self._applyMarkerStyle(el, shape.style || self._currentMarkerStyle(),\n" <>
                 "                                   self._markerScale());"
    end

    test "and no stroke styling anywhere takes a dot flag" do
      src = File.read!(@source)

      for [text] <- Regex.scan(~r/_apply(?:LineParams|MarkerStyle)\(.*?\);/s, src) do
        refute text =~ "_strokeIsDot",
               "the size of a dot is the size of the stroke: #{text}"
      end
    end
  end

  describe "the path a dot is drawn with" do
    test "is its own short segment, not the hair of one that is stored" do
      # `DOT_LENGTH` is a hundredth of an IMAGE px — at 0.007 zoom that is
      # seven hundred-thousandths of a screen px, a subpath so short that
      # engines disagree about whether it is there at all. Chrome paints it as
      # a partly-covered smudge; WebKit drops degenerate subpaths, which is
      # why an iPhone placed dots it never drew until you zoomed in far
      # enough to give the thing some length.
      src = File.read!(@source)

      [_, branch] = String.split(src, "if (mp.length && self._strokeIsDot(g)) {", parts: 2)
      # The dot's branch alone — what follows the `else` is the ordinary
      # stroke, which is still a spline and should be.
      [branch, _] = String.split(branch, "} else {", parts: 2)

      assert branch =~ ~s|" L " + (dc.x + dlen)|,
             "drawn at its own length, taken from `_dotRenderLength()`"

      assert branch =~ "self._dotRenderLength()"

      refute branch =~ "_catmullRomPathD",
             "the spline through two coincident points is the degenerate path"
    end

    test "and the same for a legacy freehand polyline" do
      src = File.read!(@source)

      [_, branch] =
        String.split(src, "if ((g.points || []).length && self._strokeIsDot(g)) {", parts: 2)

      assert String.slice(branch, 0, 400) =~ "self._dotRenderLength()"
    end

    test "a whole device pixel, and measured in them" do
      src = File.read!(@source)

      [_, v] = String.split(src, "var DOT_RENDER_DEVICE_PX = ", parts: 2)
      [v, _] = String.split(v, ";", parts: 2)

      assert String.to_integer(String.trim(v)) >= 1,
             "below a device pixel the segment can be rounded away again"

      assert src =~ "DOT_RENDER_DEVICE_PX / (dpr > 0 ? dpr : 1)",
             "device px, not CSS px: on a phone at 3x, a whole CSS px of " <>
               "length would be three device pixels of tail on a dot"
    end

    test "what is STORED is untouched — this is how a dot is painted" do
      # The hair of length exists so the browser has a hit region. Rendering
      # it longer must not rewrite the shape, or every dot would drift a
      # pixel further each time it was drawn.
      src = File.read!(@source)

      assert src =~ "var DOT_LENGTH = 0.01;"

      [_, commit] = String.split(src, "_commitFreehand: function", parts: 2)
      commit = String.slice(commit, 0, 3000)

      assert commit =~ "[at[0] + DOT_LENGTH, at[1]]",
             "the stored dot is still the stored dot"

      refute commit =~ "_dotRenderLength",
             "the render length has no business in what gets saved"
    end
  end

  describe "the floor" do
    test "there is one, and it is the same one for every stroke" do
      # A dot with a floor of its own was the phantom: it held its size while
      # everything around it shrank.
      src = File.read!(@source)

      refute src =~ "DOT_MIN_SCREEN_PX",
             "a dot is the cap on a stroke of that width, and it is the same ink"

      assert src =~ "var MARKER_MIN_SCREEN_PX = 0.4;"
    end

    test "the marker reads it, where it used to have no floor at all" do
      src = File.read!(@source)

      [_, body] = String.split(src, "_applyMarkerStyle: function", parts: 2)
      body = String.slice(body, 0, 900)

      assert body =~ "Math.max(MARKER_MIN_SCREEN_PX, w)"
    end

    test "and so do the outline kinds, which is where the number came from" do
      # It was written as a bare 0.4 inside `_applyLineParams`. Both read the
      # same constant now, so they cannot drift apart.
      src = File.read!(@source)

      refute src =~ "Math.max(0.4, w * scale)",
             "the literal is gone — the floor has a name now"

      assert src =~ "Math.max(MARKER_MIN_SCREEN_PX, w * scale)"
    end
  end
end
