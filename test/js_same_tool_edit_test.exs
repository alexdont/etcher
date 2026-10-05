defmodule Etcher.JsSameToolEditTest do
  @moduledoc """
  Runs `test/js/same_tool_edit_test.js`, which pins same-tool editing:
  the shapes a tool draws stay grabbable while it is armed — a
  rectangle's edge moves it under the rectangle tool, a stationary
  press selects it, a double-click opens its label — while the filled
  kinds keep their interiors as canvas (a rectangle can still be drawn
  inside a rectangle), the ink and image tools stay pure drawing tools,
  and a committed shape's handles stay live under `.is-drawing` where
  draft dots stay inert.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/same_tool_edit_test.js", __DIR__)

  test "a tool edits the shapes of its own kind without a trip to the cursor" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js same-tool-edit checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "same-tool-edit checks failed:\n\n#{output}"
    end
  end
end
