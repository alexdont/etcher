defmodule Etcher.JsPointerTest do
  @moduledoc """
  Runs `test/js/pointer_test.js`, which pins the red pointer's bookkeeping —
  the trail behind it, and when a pointer stops existing.

  The shared pointer is the one thing on the board that isn't a drawing:
  nothing is stored, nothing is undone, and it has to disappear on its own.
  That last part carries the risk. A pointer arrives as a stream of positions
  from someone else's machine, and the stream simply stops when they close the
  tab — there is no goodbye to rely on. Get the eviction wrong and everyone is
  left with a red dot stuck on a board they may be presenting from.

  Time is injected in the JS checks rather than read from the clock, so they
  are exact rather than sleep-and-hope.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/pointer_test.js", __DIR__)

  test "pointer trails age out and pointers evict themselves" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js pointer checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "pointer checks failed:\n\n#{output}"
    end
  end
end
