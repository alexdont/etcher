defmodule Etcher.JsLiveDraftStyleTest do
  @moduledoc """
  Runs `test/js/live_draft_style_test.js`, which pins that a shape being
  drawn follows the style panel live.

  A draft takes its style once, when it is created. That was fine while a
  draft only lived for the length of a drag — but a click now arms one, and
  it sits following the cursor until the second click. Setting the thickness
  or line type during that window did nothing until the placing click, at
  which point the shape appeared in the style chosen a moment earlier: the
  right answer, arriving too late to judge it by.

  `_restyleDrafts/0` re-derives a live draft from `_styleForNewShape/1` —
  the same function the commit uses — so the preview cannot promise
  something the committed shape won't honour. It hangs off the branch that
  edits the global default, so an edit aimed at a selected shape is
  unaffected.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/live_draft_style_test.js", __DIR__)

  test "thickness, line type, colour and label size reach the shape being drawn" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js live draft style checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "live draft style checks failed:\n\n#{output}"
    end
  end
end
