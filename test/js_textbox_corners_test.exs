defmodule Etcher.JsTextboxCornersTest do
  @moduledoc """
  Runs `test/js/textbox_corners_test.js`: a text box's corner types,
  their reach in canvas units (resizing the box never grows them), and the
  padding that keeps the words inside the cut. Skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/textbox_corners_test.js", __DIR__)

  test "a text box has shaped corners that keep their size and keep the words inside" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js textbox corner checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "textbox corner checks failed:\n\n#{output}"
    end
  end
end
