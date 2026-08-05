defmodule Etcher.JsPopupPositionTest do
  @moduledoc """
  Runs `test/js/popup_position_test.js`, which pins which side of its trigger
  a popup opens on.

  Above by preference — most of these hang off the bottom toolbar — but the
  colour swatches sit in the style panel near the top of the canvas, where
  opening upward put the picker off-screen entirely.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/popup_position_test.js", __DIR__)

  test "popups flip below their trigger when there is no room above" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js popup-position checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "popup position checks failed:\n\n#{output}"
    end
  end
end
