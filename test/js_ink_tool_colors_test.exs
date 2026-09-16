defmodule Etcher.JsInkToolColorsTest do
  @moduledoc """
  Runs `test/js/ink_tool_colors_test.js`, which pins per-tool ink
  colours: the marker and the highlighter each remember their own
  colour, apart from the palette colour the shapes share. Arming banks
  the shared selection and loads the tool's colour (first-time
  highlighter: yellow), picks while armed store under the tool without
  touching the palette slots, and disarming restores the bank.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/ink_tool_colors_test.js", __DIR__)

  test "each ink tool keeps its own colour, apart from the shared palette" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js ink colour checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "ink tool colour checks failed:\n\n#{output}"
    end
  end
end
