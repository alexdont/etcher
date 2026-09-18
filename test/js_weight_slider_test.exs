defmodule Etcher.JsWeightSliderTest do
  @moduledoc """
  Runs `test/js/weight_slider_test.js`, which pins the weight sliders'
  scale: they travel 0-100 and curve onto the weight range, so the
  weights people draw with (around 8, now that weights are relative to
  the canvas) sit mid-track instead of bunched in the first fifth.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/weight_slider_test.js", __DIR__)

  test "the weight sliders spread the useful range across the track" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js weight slider checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "weight slider checks failed:\n\n#{output}"
    end
  end
end
