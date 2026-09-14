defmodule Etcher.JsBoxSelectPreviewTest do
  @moduledoc """
  Runs `test/js/box_select_preview_test.js`, which pins the live preview on
  a box-select.

  Dragging a marquee used to be a guess — nothing changed on screen until
  the release, and only then did the user find out whether they had caught
  the shapes they meant. Now the shapes a release would take light up as
  the marquee sweeps over them (wearing the same `is-multi-selected` paint
  the committed selection uses), and one high-contrast box is drawn around
  the whole prospective group, growing as shapes join.

  The load-bearing part: `_shapesInBox/1` answers for both the preview and
  the commit, so what lit up is exactly what gets selected.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/box_select_preview_test.js", __DIR__)

  test "a box-select shows what it will take before the release" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js box-select preview checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "box-select preview checks failed:\n\n#{output}"
    end
  end
end
