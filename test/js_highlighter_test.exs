defmodule Etcher.JsHighlighterTest do
  @moduledoc """
  Runs `test/js/highlighter_test.js`, which pins the highlighter tool.

  Exactly the marker in every way that matters — same capture, spline and
  committed kind (persistence and hit test come free; no new server
  migration) — at a fixed half opacity. A separate tool rather than a
  setting, so writing and highlighting never fight over one opacity
  slider.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/highlighter_test.js", __DIR__)

  test "the highlighter is the marker at a fixed half opacity" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js highlighter checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "highlighter checks failed:\n\n#{output}"
    end
  end
end
