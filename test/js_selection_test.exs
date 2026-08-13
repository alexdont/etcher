defmodule Etcher.JsSelectionTest do
  @moduledoc """
  Runs `test/js/selection_test.js`, which pins what selecting a shape looks
  like and that a fresh shape is born selected.

  Both came from user feedback against tldraw-class tools: `.is-selected` /
  `.is-editing` forced `stroke-dasharray`, so selecting a solid line looked
  like it CHANGED the line to a dashed one (the orange stroke/fill overrides
  in the same rules were dead — inline styles beat them — making the dash the
  entire visible effect); and `_finalizeShape` dropped back to the cursor
  without selecting, so restyling a just-drawn stroke took a second click.

  Selection is now a blue outline that leaves the shape's own paint alone,
  and `_finalizeShape` enters edit mode on the shape it created — guarded
  against the click the browser synthesizes from the draw gesture itself.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/selection_test.js", __DIR__)

  test "selection outlines in blue and a fresh shape is born selected" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js selection checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "selection checks failed:\n\n#{output}"
    end
  end
end
