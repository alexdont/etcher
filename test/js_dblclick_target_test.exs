defmodule Etcher.JsDblclickTargetTest do
  @moduledoc """
  Runs `test/js/dblclick_target_test.js`.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/dblclick_target_test.js", __DIR__)

  test "a double-click edits the selected shape and armed drafts show no dots" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js dblclick-target checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "dblclick-target checks failed:\n\n#{output}"
    end
  end
end
