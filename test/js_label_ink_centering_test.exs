defmodule Etcher.JsLabelInkCenteringTest do
  @moduledoc """
  Runs `test/js/label_ink_centering_test.js`, which pins the label's ink
  centring: SVG places text by its baseline, so a line of digits sat low
  in its em box — slack above, overhanging the rect's bottom edge, and
  the error scaled with the font, so a shaft label appeared to shift as
  the board zoomed out. The render measures the painted extents and
  centres them on the rect.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_ink_centering_test.js", __DIR__)

  test "a label's painted ink is centred on its box" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js ink centring checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "ink centring checks failed:\n\n#{output}"
    end
  end
end
