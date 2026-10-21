defmodule Etcher.JsTransformBoxTest do
  @moduledoc """
  Runs `test/js/transform_box_test.js`: the frame round a selection (a
  group, or one hand-drawn stroke) that scales it from a corner and turns
  it from the knob above. Shelled out to node like the other JS checks;
  skipped when node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/transform_box_test.js", __DIR__)

  test "the selection frame scales and turns what it holds" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js transform box checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "transform box checks failed:\n\n#{output}"
    end
  end
end
