defmodule Etcher.JsLaserDriverTest do
  @moduledoc """
  Runs `test/js/laser_driver_test.js`: the laser meter driver (CRC, frames, decoding, connect) against the captured Bosch frames. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/laser_driver_test.js", __DIR__)

  test "the driver reads the captured frames" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js laser driver checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "laser driver checks failed:\n\n#{output}"
    end
  end
end
