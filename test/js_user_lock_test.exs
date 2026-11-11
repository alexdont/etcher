defmodule Etcher.JsUserLockTest do
  @moduledoc """
  Runs `test/js/user_lock_test.js`: the user's own lock (metadata.locked):
  saved, undoable, apart from the host's lock. Skipped
  without node.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/user_lock_test.js", __DIR__)

  test "a shape locks and unlocks" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js user lock checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "user lock checks failed:\n\n#{output}"
    end
  end
end
