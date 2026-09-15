defmodule Etcher.JsLabelFocusParamsTest do
  @moduledoc """
  Runs `test/js/label_focus_params_test.js`, which pins which style rows
  appear when the focus carries no stroke.

  "No targets" is two situations the panel used to conflate: nothing
  focused at all (the popup edits the authoring defaults — every stroke
  row belongs) versus a focus with no stroke (a text shape, a focused
  label), which fell into the same branch — so clicking a label box made
  the infill buttons and sliders appear for a thing with neither fill nor
  stroke, silently wired to the authoring defaults underneath.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_focus_params_test.js", __DIR__)

  test "a strokeless focus hides the stroke rows instead of showing the defaults" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label focus checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label focus params checks failed:\n\n#{output}"
    end
  end
end
