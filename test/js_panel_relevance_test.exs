defmodule Etcher.JsPanelRelevanceTest do
  @moduledoc """
  Runs `test/js/panel_relevance_test.js`: the style panel shows only the
  rows that apply to what is focused, grouped with rules between groups.
  Skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/panel_relevance_test.js", __DIR__)

  test "the style panel shows only what applies to the focus" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js panel relevance checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "panel relevance checks failed:\n\n#{output}"
    end
  end
end
