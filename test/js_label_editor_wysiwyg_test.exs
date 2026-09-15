defmodule Etcher.JsLabelEditorWysiwygTest do
  @moduledoc """
  Runs `test/js/label_editor_wysiwyg_test.js`, which pins the label
  editor's WYSIWYG dress.

  The editor used to be a white box with a dashed border and 14px black
  text — nothing like what commit would draw, so every edit was typed
  blind into a form control. The input now wears exactly what the
  rendered label wears: its font at its rendered size, its own ink, its
  plate (or nothing) behind it, centred where the committed text will
  centre, and shrinking as the user types past the box the way the
  render's width-fit cap does (pinned sizes exempt, as in the render).

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_editor_wysiwyg_test.js", __DIR__)

  test "editing a label looks exactly like the label" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label editor checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label editor wysiwyg checks failed:\n\n#{output}"
    end
  end
end
