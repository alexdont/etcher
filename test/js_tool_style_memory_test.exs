defmodule Etcher.JsToolStyleMemoryTest do
  @moduledoc """
  Runs `test/js/tool_style_memory_test.js`: each shape tool keeps its own
  colour and line params, and a tool armed for the first time starts from the
  board's base style rather than the previous tool's. Skipped without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/tool_style_memory_test.js", __DIR__)

  test "each shape tool remembers its own style" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js tool style memory checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "tool style memory checks failed:\n\n#{output}"
    end
  end
end
