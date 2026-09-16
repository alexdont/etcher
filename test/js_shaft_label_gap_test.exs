defmodule Etcher.JsShaftLabelGapTest do
  @moduledoc """
  Runs `test/js/shaft_label_gap_test.js`, which pins the shaft-label
  gap: a dimension's or arrow's riding label breaks the line around
  itself (a per-shape mask on the shaft group — honouring curves, dash
  patterns and arrowheads), sized to the rendered label plus a
  proportional margin, turned with the board, and removed when the
  label goes away.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/shaft_label_gap_test.js", __DIR__)

  test "a shaft-riding label breaks the line around itself" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js shaft gap checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "shaft label gap checks failed:\n\n#{output}"
    end
  end
end
