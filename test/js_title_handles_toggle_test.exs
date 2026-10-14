defmodule Etcher.JsTitleHandlesToggleTest do
  @moduledoc """
  Runs `test/js/title_handles_toggle_test.js`: a label's corner dots always
  show, and the ⋯ label-dots toggle is gone. Skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/title_handles_toggle_test.js", __DIR__)

  test "label dots always show, with no toggle" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js title handles checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "title handles toggle checks failed:\n\n#{output}"
    end
  end
end
