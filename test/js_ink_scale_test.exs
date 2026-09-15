defmodule Etcher.JsInkScaleTest do
  @moduledoc """
  Runs `test/js/ink_scale_test.js`, which pins the ink-sizing policy.

  By default a panel value is document px — every stroke drawn at 3 is
  the same thickness whatever the zoom was when it was drawn. The old
  draw-what-you-see behaviour (a value means screen px at draw time,
  making strokes from different zooms different real thicknesses) lives
  on behind the ⋯ toggle. One conversion, `_inkScale`, serves every
  panel read and write, and rendering is untouched either way.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/ink_scale_test.js", __DIR__)

  test "ink is one thickness by default; zoom-anchoring is the opt-in" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js ink scale checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "ink scale checks failed:\n\n#{output}"
    end
  end
end
