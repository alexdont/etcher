defmodule Etcher.JsArmedInkPanelTest do
  @moduledoc """
  Runs `test/js/armed_ink_panel_test.js`, which pins which panel rows
  show while a pure-ink tool is armed.

  With the marker or highlighter armed, the panel offered label rows and
  fill buttons — settings about things the next stroke cannot produce.
  They hide while the tool is armed; a selected labelled shape brings
  every applicable row back regardless of the armed tool.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/armed_ink_panel_test.js", __DIR__)

  test "an armed ink tool shows only the settings its stroke can wear" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js armed ink checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "armed ink panel checks failed:\n\n#{output}"
    end
  end
end
