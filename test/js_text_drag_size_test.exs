defmodule Etcher.JsTextDragSizeTest do
  @moduledoc """
  Runs `test/js/text_drag_size_test.js`, which pins the text tool's
  drag-to-size.

  A drawn box is a size request — its height pins the font at the
  box-drives-font 0.65, clamped like the Label size input, beating the
  remembered default that otherwise made every new text one size. A
  plain click keeps the default and its usable minimum box.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/text_drag_size_test.js", __DIR__)

  test "dragging a text box sizes the text to it" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js text drag size checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "text drag size checks failed:\n\n#{output}"
    end
  end
end
