defmodule Etcher.JsModeSwitchTest do
  @moduledoc """
  Runs `test/js/mode_switch_test.js`: the View / Annotate switch in the viewer nav,
  asked for by name. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/mode_switch_test.js", __DIR__)

  test "the viewer nav switches between View and Annotate" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js mode switch checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "mode switch checks failed:\n\n#{output}"
    end
  end
end
