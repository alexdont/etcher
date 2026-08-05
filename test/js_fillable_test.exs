defmodule Etcher.JsFillableTest do
  @moduledoc """
  Runs `test/js/fillable_test.js`, which pins which SVG elements take a fill —
  i.e. which shapes have a body rather than only an outline.

  Guards a regression that passed unnoticed once: narrowing the list to
  rect/circle/polygon dropped the tint from every closed freehand loop while
  the stroke kept drawing, so nothing looked broken enough to fail.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/fillable_test.js", __DIR__)

  test "freehand takes a fill and markers stay hollow" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js fillable checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "fillable checks failed:\n\n#{output}"
    end
  end
end
