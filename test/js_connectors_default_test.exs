defmodule Etcher.JsConnectorsDefaultTest do
  @moduledoc """
  Runs `test/js/connectors_default_test.js`: shapes are connected by the
  arrow tool, which snaps its ends to anchors as it draws; the cursor's
  hover dots and the connector toggle are retired, and only a host's
  `connectors={:off}` turns snapping off. Skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/connectors_default_test.js", __DIR__)

  test "the arrow tool connects shapes; only a host turns anchors off" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js connectors checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "connectors-default checks failed:\n\n#{output}"
    end
  end
end
