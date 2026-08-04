defmodule Etcher.JsImageRadiusTest do
  @moduledoc """
  Runs `test/js/image_radius_test.js`, which pins the corner radius image
  shapes are drawn with.

  The radius is a fraction of the rendered box rather than a fixed number of
  pixels, so that a photo looks the same at every zoom level; the checks cover
  the ratio and both clamps.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/image_radius_test.js", __DIR__)

  test "image corner radius scales with the box and stays inside its clamps" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js image-radius checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "image radius checks failed:\n\n#{output}"
    end
  end
end
