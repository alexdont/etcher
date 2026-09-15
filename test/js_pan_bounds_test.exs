defmodule Etcher.JsPanBoundsTest do
  @moduledoc """
  Runs `test/js/pan_bounds_test.js`, which pins the pan bounds following
  the ink.

  Fresco clamps panning to the canvas, so a stroke drawn above a wide
  image was visible at fit zoom and unreachable zoomed in. Whenever
  annotations change (edit, hydration, re-hydration, undo/redo), etcher
  hands Fresco pan bounds covering the union of the canvas and everything
  drawn — labels included — padded on the spilled sides only, and hands
  the stock clamp back exactly once when the last outside shape goes.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/pan_bounds_test.js", __DIR__)

  test "pan reaches ink drawn outside the picture" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js pan bounds checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "pan bounds checks failed:\n\n#{output}"
    end
  end
end
