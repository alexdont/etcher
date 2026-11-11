defmodule Etcher.JsExportLayerTest do
  @moduledoc """
  Runs `test/js/export_layer_test.js`: the board's shapes in Fresco's PDF export,
  whole and in image px, with the screen put back. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/export_layer_test.js", __DIR__)

  test "every shape goes into the PDF and the screen comes back" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js export layer checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "export layer checks failed:\n\n#{output}"
    end
  end
end
