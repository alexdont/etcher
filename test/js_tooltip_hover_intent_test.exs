defmodule Etcher.JsTooltipHoverIntentTest do
  @moduledoc """
  Runs `test/js/tooltip_hover_intent_test.js`, which pins the tooltip's
  manners: the cursor has to settle on a shape before one appears
  (crossing a drawing used to flash one per shape), the box fades
  instead of popping, the dwell is short, and every deliberate path —
  pinning, the re-show after a handle drag — still shows at once.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/tooltip_hover_intent_test.js", __DIR__)

  test "the tooltip waits for intent, fades, and does not overstay" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js tooltip checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "tooltip hover intent checks failed:\n\n#{output}"
    end
  end
end
