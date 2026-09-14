defmodule Etcher.JsLabelBgTest do
  @moduledoc """
  Runs `test/js/label_bg_test.js`, which pins the plate behind a label.

  A label written straight onto a photograph is often unreadable — the
  colour that works over the sky is invisible over the roof. A label can now
  sit on a plate: a filled rect behind its text, off by default, stored as
  `style.label_bg` and painted onto the rect all three label paths already
  draw (a shape's label, a text shape, a callout).

  The controls are split the way the settings are: the on/off toggle sits
  with the label SIZE, since both describe the label, and the colour sits
  beside the label's own colour — contrast is a property of the pair, so
  the two swatches share a row and the plate chip previews both together.
  In the narrow panel they stack into one column.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_bg_test.js", __DIR__)

  test "a label can sit on a plate, toggled with its size and coloured beside it" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label background checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label background checks failed:\n\n#{output}"
    end
  end
end
