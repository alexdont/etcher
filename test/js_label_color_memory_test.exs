defmodule Etcher.JsLabelColorMemoryTest do
  @moduledoc """
  Runs `test/js/label_color_memory_test.js`, which pins the label-colour
  memory: recolouring a focused label saves the choice (`label_color` pref,
  persisted wherever the host stores prefs), and the next label the user
  creates starts in that colour. Creation only — re-editing text never
  repaints a label, explicit colours are never overwritten, and text /
  callout (whose text IS the shape) are never stamped.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_color_memory_test.js", __DIR__)

  test "the last label colour is remembered and stamped onto new labels" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label-colour checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label-colour-memory checks failed:\n\n#{output}"
    end
  end
end
