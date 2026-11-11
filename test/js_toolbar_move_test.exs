defmodule Etcher.JsToolbarMoveTest do
  @moduledoc """
  Runs `test/js/toolbar_move_test.js`: the tool bar's grip moves it, the move
  is kept as an offset preference and clamped inside the container. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/toolbar_move_test.js", __DIR__)

  test "the tool bar can be moved off what it covers" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js toolbar move checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "toolbar move checks failed:\n\n#{output}"
    end
  end
end
