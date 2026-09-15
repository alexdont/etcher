defmodule Etcher.JsTitleHandlesToggleTest do
  @moduledoc """
  Runs `test/js/title_handles_toggle_test.js`, which pins the label corner
  dots' opt-in toggle.

  The Label size input is the primary way to size a label; the four
  corner dots are the freehand alternative, off unless the user switches
  them on in the ⋯ menu. The preference persists with the rest, the gate
  sits at handle creation so every entry point respects it, and flipping
  the switch takes effect on a label focused right now.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/title_handles_toggle_test.js", __DIR__)

  test "the label resize dots are a persisted opt-in" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js title handles checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "title handles toggle checks failed:\n\n#{output}"
    end
  end
end
