defmodule Etcher.JsTooltipAnchorTest do
  @moduledoc """
  Runs `test/js/tooltip_anchor_test.js`, which pins where a tooltip hangs
  from.

  It anchored to the top-centre of the shape's bounding box — right for a
  rectangle, wrong for anything diagonal. A line drawn corner to corner has
  a bbox whose top-centre is out in empty canvas, so the tooltip floated far
  off the line it described. Open strokes (line, dimension, arrow, marker,
  freehand) now anchor to the middle of the line itself, measured along it
  by arc length so a hesitant stroke doesn't anchor wherever the sampling
  bunched up.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/tooltip_anchor_test.js", __DIR__)

  test "a diagonal stroke's tooltip sits on the line, not above its box" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js tooltip anchor checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "tooltip anchor checks failed:\n\n#{output}"
    end
  end
end
