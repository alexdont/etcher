defmodule Etcher.JsFreshShapeDefaultsTest do
  @moduledoc """
  Runs `test/js/fresh_shape_defaults_test.js`, which pins the fresh-shape
  default mirroring.

  A just-drawn shape comes up selected; while that creation selection
  lasts, panel edits restyle the shape AND become the tool's defaults,
  so the next one comes out identical. Clicking off ends freshness for
  good — re-selecting later is a one-time edit that leaves the defaults
  alone. Covers the predicate, the thickness mirror end to end (with the
  global-default persistence event), and the wiring for colour, label
  ink, plate and size.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/fresh_shape_defaults_test.js", __DIR__)

  test "tuning a just-drawn shape tunes the tool; re-editing later does not" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js fresh shape checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "fresh shape defaults checks failed:\n\n#{output}"
    end
  end
end
