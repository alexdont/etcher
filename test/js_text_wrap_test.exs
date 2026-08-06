defmodule Etcher.JsTextWrapTest do
  @moduledoc """
  Runs `test/js/text_wrap_test.js`, which pins that a line of text breaks the
  same way at every zoom.

  Where a label wraps, and how far its font is shrunk to fit its box, are
  decisions about the label rather than about how closely it is being looked
  at. Both are made by measuring text, and text metrics are not linear in font
  size — hinting and rounding make small text proportionally wider, and
  browsers clamp very small sizes outright. Measuring at the size the text will
  actually be drawn at folds the zoom into the answer, and a label that sat on
  one line zoomed in broke onto two zoomed out.

  The stub in the JS file reproduces that non-linearity deliberately, so the
  checks fail against a measurement taken at the rendered size.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/text_wrap_test.js", __DIR__)

  test "text breaks the same way at every zoom" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js text-wrap checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "text wrap checks failed:\n\n#{output}"
    end
  end
end
