defmodule Etcher.JsLabelTextColorTest do
  @moduledoc """
  Runs `test/js/label_text_color_test.js`, which pins the label text-colour
  chip against the selection.

  The label swatch row is split into text ink and plate. The plate half
  always worked on the selection; the text half silently edited the
  new-labels default instead, so with a shape selected a pick did nothing
  visible while the chip claimed to describe "this label". `_setLabelColor`
  is the missing write half, shaped like `_setLabelBg`: selection first,
  default only when nothing is selected.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_text_color_test.js", __DIR__)

  test "picking a label colour recolours the selected labels, not the default" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label text colour checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label text colour checks failed:\n\n#{output}"
    end
  end
end
