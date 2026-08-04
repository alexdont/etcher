defmodule Etcher.JsStripChromeTest do
  @moduledoc """
  Runs `test/js/strip_chrome_test.js`, which pins where the floating chrome
  lands in strip mode.

  Strip mode makes the action bar, style panel and style trigger `position:
  fixed`, because there the container is the scrolling element and absolute
  chrome scrolls away with the content. Their offsets therefore have to be
  viewport coordinates — and the bug this guards against is subtracting the
  container's rect anyway, which is invisible whenever the strip happens to
  sit at the viewport origin. Every case in the script puts it elsewhere.

  Shelled out to node for the same reason as the z-order checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/strip_chrome_test.js", __DIR__)

  test "strip-mode chrome is positioned in viewport coordinates" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js strip-chrome checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "strip chrome checks failed:\n\n#{output}"
    end
  end
end
