defmodule Etcher.JsTypedWeightTest do
  @moduledoc """
  Runs `test/js/typed_weight_test.js`.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/typed_weight_test.js", __DIR__)

  test "the thickness readout takes a typed size, within the range" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js typed-weight checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "typed-weight checks failed:\n\n#{output}"
    end
  end
end
