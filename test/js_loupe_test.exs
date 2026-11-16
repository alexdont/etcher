defmodule Etcher.JsLoupeTest do
  @moduledoc """
  Runs `test/js/loupe_test.js`: the placing loupe that comes up when a
  dragged point is held still — the dwell, finger slack, following, release,
  placement at the edges and which drags feed it.

  Shelled out to node like the other JS checks. Skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/loupe_test.js", __DIR__)

  test "holding a dragged point still brings up the placing loupe" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js loupe checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "loupe checks failed:\n\n#{output}"
    end
  end
end
