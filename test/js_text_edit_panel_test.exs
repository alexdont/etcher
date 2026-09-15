defmodule Etcher.JsTextEditPanelTest do
  @moduledoc """
  Runs `test/js/text_edit_panel_test.js`, which pins the open text
  editor's truce with the style panel.

  Reaching for the panel with a fresh text box open used to commit —
  and, the box being empty, discard — it. Chrome presses and
  focus-into-panel now leave the editor open, the panel's size/colour
  controls target the box being typed into, and the editor re-dresses in
  place (caret intact) so the user sees the change before typing.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/text_edit_panel_test.js", __DIR__)

  test "the style panel styles an open text editor instead of closing it" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js text edit panel checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "text edit panel checks failed:\n\n#{output}"
    end
  end
end
