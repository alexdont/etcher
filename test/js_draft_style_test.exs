defmodule Etcher.JsDraftStyleTest do
  @moduledoc """
  Runs `test/js/draft_style_test.js`, which pins that a draft looks like the
  shape it is about to become.

  The preview used to be drawn in its own look — orange, `stroke-dasharray:
  5 4`, orange body — and only on release did the shape snap to the
  thickness / line type / opacity / fill set in the style panel. So a solid
  8px line previewed as a thin dashed one, and a marker stroke previewed
  dotted whatever the user had chosen.

  Two halves, both pinned there: `_styleForNewShape/1` is the single answer
  to "what does a new shape of this kind look like" (the draft is drawn with
  it, `_finalizeShape` commits it, so they cannot drift), and
  `.etcher-shape.is-draft` no longer repaints — its dasharray outranked the
  presentation attribute `_applyLineParams` writes, which is why every
  preview came out dashed.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/draft_style_test.js", __DIR__)

  test "a draft is drawn with the style it will commit with" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js draft style checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "draft style checks failed:\n\n#{output}"
    end
  end
end
