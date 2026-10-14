defmodule Etcher.JsTextToolPointTest do
  @moduledoc """
  Runs `test/js/text_tool_point_test.js`: the text tool makes point text,
  Affinity-style — lines only where the author broke them, the box always
  exactly the text, corner handles that scale it evenly and edge handles
  that stretch it, all usable while typing, and nothing that changes when
  the edit is committed.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/text_tool_point_test.js", __DIR__)

  test "point text types, scales and stretches as specified" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js point text checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "point text checks failed:\n\n#{output}"
    end
  end
end
