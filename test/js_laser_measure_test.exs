defmodule Etcher.JsLaserMeasureTest do
  @moduledoc """
  Runs `test/js/laser_measure_test.js`: the laser measure tool. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/laser_measure_test.js", __DIR__)

  test " where a reading goes and the label each kind gets:a reading becomes a shape's label" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js laser measure checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "laser measure checks failed:\n\n#{output}"
    end
  end
end
