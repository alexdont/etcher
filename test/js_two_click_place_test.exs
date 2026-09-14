defmodule Etcher.JsTwoClickPlaceTest do
  @moduledoc """
  Runs `test/js/two_click_place_test.js`, which pins how dimensions, lines
  and callouts get drawn.

  Press-drag-release still draws one in a single gesture. A click now ARMS
  the draft instead of committing a default-length stub: it keeps following
  the cursor, and the next click places the far end — which is how you draw
  one whose ends are further apart than a comfortable drag. And a second
  click landing on the first (a double-click, which people do) makes
  nothing, rather than leaving a trail of zero-length shapes.

  The preview is what makes the two-click flow workable: it was tried once
  without one and removed, because a first click that changes nothing on
  screen reads as the tool being broken.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/two_click_place_test.js", __DIR__)

  test "click-click and drag both draw one; a double-click draws nothing" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js two-click place checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "two-click place checks failed:\n\n#{output}"
    end
  end
end
