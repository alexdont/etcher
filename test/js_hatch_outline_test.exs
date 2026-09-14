defmodule Etcher.JsHatchOutlineTest do
  @moduledoc """
  Runs `test/js/hatch_outline_test.js`, which pins how a hatch-filled shape
  shows that it is selected.

  Selection is drawn by an SVG filter that rings every painted pixel. A
  hatch fill IS painted pixels — a tile of diagonal stripes — so selecting a
  hatched shape ringed each stripe individually: dozens of blue outlines
  through the middle of the shape where one around it was meant.

  Hatched shapes now opt out of that filter (`.etcher-hatched`) and get a
  traced perimeter instead — a copy of their own geometry, unfilled, stroked
  blue, sat behind the shape so only the edges of the band show.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/hatch_outline_test.js", __DIR__)

  test "a hatched shape is outlined around its perimeter, not stripe by stripe" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js hatch outline checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "hatch outline checks failed:\n\n#{output}"
    end
  end
end
