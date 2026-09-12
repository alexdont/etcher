defmodule Etcher.JsStylePanelToolsTest do
  @moduledoc """
  Runs `test/js/style_panel_tools_test.js`, which pins the style panel's two
  host-facing behaviors: the `panel_offset` anchor (a host whose own chrome
  lives in the container's top-right corner moves the chevron + panel cluster
  through two CSS custom properties) and styleless-tool gating (the grabber
  takes no stroke or fill, so the panel hides while it is armed). Also holds
  the grabber icon to its four-path form — the coherent five-digit hand.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/style_panel_tools_test.js", __DIR__)

  test "panel anchor, styleless gating and the grabber icon behave as specified" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js style panel checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "style panel checks failed:\n\n#{output}"
    end
  end
end
