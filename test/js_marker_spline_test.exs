defmodule Etcher.JsMarkerSplineTest do
  @moduledoc """
  Runs `test/js/marker_spline_test.js`, which pins the curve a marker stroke
  is drawn as.

  A marker stores sparse samples and the spline turns them back into a stroke,
  so how it interpolates is the drawing quality. The checks measure that the
  curve passes through every sample and doesn't bulge past a sharp corner —
  the artefact uniform Catmull-Rom spacing produces wherever samples bunch,
  which is exactly what a hand slowing into a turn does.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/marker_spline_test.js", __DIR__)

  test "the marker spline interpolates its samples without overshooting" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js marker-spline checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "marker spline checks failed:\n\n#{output}"
    end
  end
end
