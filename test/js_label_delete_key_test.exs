defmodule Etcher.JsLabelDeleteKeyTest do
  @moduledoc """
  Runs `test/js/label_delete_key_test.js`, which pins the Delete key
  against a focused label.

  Delete removed the selected shape, the edit-mode shape, even a scoped
  polygon vertex — but a focused label fell through every one of those
  checks and did nothing. The new branch clears the label (text, box,
  alignment, offset, colour — one undo entry) and keeps the shape; on a
  text-kind (text, callout, dimension) the text IS the shape, so it
  deletes the shape the way selecting it would. Typing in an input is
  still exempt.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_delete_key_test.js", __DIR__)

  test "Delete on a focused label removes the label" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label delete checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label delete key checks failed:\n\n#{output}"
    end
  end
end
