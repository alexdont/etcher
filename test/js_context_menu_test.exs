defmodule Etcher.JsContextMenuTest do
  @moduledoc """
  Runs `test/js/context_menu_test.js`: the right-click menu on a shape and
  on empty board, and where it is left to the browser. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/context_menu_test.js", __DIR__)

  test "right-click opens the board menu" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js context menu checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "context menu checks failed:\n\n#{output}"
    end
  end
end
