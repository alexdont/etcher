defmodule Etcher.JsArmedFocusTest do
  @moduledoc """
  Runs `test/js/armed_focus_test.js`: with a tool armed, the shape being
  worked on holds the focus until a click away; shift gathers past it.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/armed_focus_test.js", __DIR__)

  test "the worked-on shape holds the focus while a tool is armed" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js armed-focus checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "armed-focus checks failed:\n\n#{output}"
    end
  end
end
