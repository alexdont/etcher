defmodule Etcher.JsFontSizeTest do
  @moduledoc """
  Runs `test/js/font_size_test.js`, which pins the label font size.

  A label's size came from the box dragged around it and only from there, so
  making a set of labels agree meant eyeballing every box. There is now a
  size control beside thickness and opacity — a slider to find a size, a
  number box to match one — storing `style.font_size` in canvas units so a
  pinned size holds against the drawing rather than against the screen.

  Both ways stay: blank means "size it from the box", and dragging a box
  releases the pin, so the drag can never be the gesture that does nothing.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/font_size_test.js", __DIR__)

  test "a label's font size can be pinned, and dragging its box releases it" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js font size checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "font size checks failed:\n\n#{output}"
    end
  end
end
