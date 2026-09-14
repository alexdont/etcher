defmodule Etcher.JsCalloutParamsTest do
  @moduledoc """
  Runs `test/js/callout_params_test.js`, which pins that a callout is a line
  like any other line.

  Three things were wrong. The thickness and line-type controls did nothing
  with a callout selected — it wasn't in `_paramsTargetShapes`, so the
  sliders silently edited the global default for new shapes instead. Its
  render never read the params even when they were set. And the leader (the
  line joining the dot to the label) wasn't clickable: the hit-test knew
  about the text box and the anchor dot and nothing in between.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/callout_params_test.js", __DIR__)

  test "a callout takes thickness and line type, and all of it is clickable" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js callout param checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "callout param checks failed:\n\n#{output}"
    end
  end
end
