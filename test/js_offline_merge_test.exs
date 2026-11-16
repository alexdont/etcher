defmodule Etcher.JsOfflineMergeTest do
  @moduledoc """
  Runs `test/js/offline_merge_test.js`: offline mode's three-way merge of
  what a device did offline with what the server has when it reconnects.
  Skipped when node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/offline_merge_test.js", __DIR__)

  test "offline edits merge with the server shape by shape" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js offline merge checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "offline merge checks failed:\n\n#{output}"
    end
  end
end
