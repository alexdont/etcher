defmodule Etcher.JsTextboxTest do
  @moduledoc """
  Runs `test/js/textbox_test.js`, which pins the text box tool: a box
  drawn once that stays the size it was drawn — the text wraps and
  sizes inside it, corner drags resize the box without re-deriving the
  font, the corners show without the ⋯ opt-in (they are the only way
  to resize the box), and on the wire it is a plain `text` shape with
  `style.box: "fixed"`, so no consumer schema changes.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/textbox_test.js", __DIR__)

  test "the text box keeps its walls while the text lives inside them" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js textbox checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "textbox checks failed:\n\n#{output}"
    end
  end
end
