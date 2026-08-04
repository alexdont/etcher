defmodule Etcher.JsConnectorTest do
  @moduledoc """
  Runs `test/js/connector_test.js`, which pins the geometry behind connectors
  — the arrows that bind to a shape's anchor points and follow it.

  Covers the eight-anchor table (whose ids are persisted inside every saved
  arrow, so a rename detaches them) and the arrowhead's orientation.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/connector_test.js", __DIR__)

  test "connector anchors and arrowheads resolve as specified" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js connector checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "connector checks failed:\n\n#{output}"
    end
  end
end
