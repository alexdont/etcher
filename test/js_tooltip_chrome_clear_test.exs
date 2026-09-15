defmodule Etcher.JsTooltipChromeClearTest do
  @moduledoc """
  Runs `test/js/tooltip_chrome_clear_test.js`, which pins the tooltip's
  respect for the style panel.

  Zoom and pan can park a shape underneath the panel; brushing its
  exposed edge on the way to a control then opened a tooltip on top of
  the very menu being aimed for. Placement now ends with a
  clear-of-chrome pass: the tooltip shifts left of the panel (and of any
  open popup), floored at the container's left edge so one covered
  control is not traded for an off-screen tooltip.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/tooltip_chrome_clear_test.js", __DIR__)

  test "tooltips yield to the style panel and open popups" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js tooltip chrome checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "tooltip chrome clear checks failed:\n\n#{output}"
    end
  end
end
