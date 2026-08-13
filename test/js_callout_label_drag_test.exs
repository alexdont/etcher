defmodule Etcher.JsCalloutLabelDragTest do
  @moduledoc """
  Runs `test/js/callout_label_drag_test.js`, which pins what dragging a
  callout moves.

  A callout is an anchor marking WHAT it points at plus a label saying
  something about it. Dragging the label used to translate both, dragging
  the pointer off its target. Now a grab on the text box moves only the
  box — anchor pinned, leader stretching — while a grab on the leader or
  anchor dot still moves the whole shape. Hit-tested against the
  shrunk-to-text rendered box, so the grab region matches what is drawn.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/callout_label_drag_test.js", __DIR__)

  test "dragging a callout's label moves the label, not the anchor" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js callout-drag checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "callout-label-drag checks failed:\n\n#{output}"
    end
  end
end
