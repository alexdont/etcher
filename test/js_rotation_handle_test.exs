defmodule Etcher.JsRotationHandleTest do
  @moduledoc """
  Runs `test/js/rotation_handle_test.js`: shape rotation by the knob above a
  shape (box shapes carry style.rotation, point shapes turn their points)
  and the text box scale-as-one dot. Skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/rotation_handle_test.js", __DIR__)

  test "shapes turn by their knob and text boxes scale as one" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js rotation checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "rotation checks failed:\n\n#{output}"
    end
  end
end
