defmodule Etcher.JsSnapGuidesTest do
  @moduledoc """
  Runs `test/js/snap_guides_test.js`, which pins the snap & alignment
  guides: a dragged shape's edges and centers magnetize to every other
  shape's within a screen-px threshold, cyan guide lines connect what
  aligned with what (spanning to the farthest aligned shape), ⌘/Ctrl
  bypasses the snap, a shift-locked axis is never nudged off its lock,
  strip mode snaps within its own page only, and the guides vanish when
  the drag ends.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/snap_guides_test.js", __DIR__)

  test "dragged shapes magnetize to neighbours with visible guides" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js snap checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "snap-guide checks failed:\n\n#{output}"
    end
  end
end
