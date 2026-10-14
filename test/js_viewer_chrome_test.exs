defmodule Etcher.JsViewerChromeTest do
  @moduledoc """
  Runs `test/js/viewer_chrome_test.js`: a press on Fresco's nav or zoom
  control, or on a host's own button laid over the picture, is never also a
  press on the shape underneath. Before, a zoom button over a shape selected
  it, and a quick second press opened its label editor instead of zooming.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/viewer_chrome_test.js", __DIR__)

  test "the viewer's controls and a host's buttons are not the canvas" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js viewer chrome checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "viewer chrome checks failed:\n\n#{output}"
    end
  end
end
