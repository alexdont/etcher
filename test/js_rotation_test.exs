defmodule Etcher.JsRotationTest do
  @moduledoc """
  Runs `test/js/rotation_test.js`, which pins how the overlay behaves when the
  canvas is turned.

  Fresco rotates its stage; the annotation overlay hangs off the un-rotated
  container and inherits rotation only through the point transform. Anything
  etcher expresses as a single-axis scalar or an axis-aligned box therefore
  needs handling of its own, and both failure modes are silent — nothing
  raises, the numbers are just wrong. A scale probe that reads one axis of a
  projected unit vector returns ~0 at 90°/270°, and the `|| 1` guard behind it
  turns that into a scale of 1, which is how a 1.3px stroke came to render at
  18.6px on a rotated board.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/rotation_test.js", __DIR__)

  test "scale probes and oriented boxes survive a rotated canvas" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js rotation checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "rotation checks failed:\n\n#{output}"
    end
  end
end
