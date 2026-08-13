defmodule Etcher.JsShortcutsAndTogglesTest do
  @moduledoc """
  Runs `test/js/shortcuts_and_toggles_test.js`, which pins the Tier-2
  conveniences: single-key tool shortcuts (bare keys only, gated on the
  board's tool allowlist, no key for the file-picker image tool), alt-drag
  duplicate (the copy moves, the original stays, with a create-undo entry
  like ⌘D), and the snap toggle — off by default, resolved user pref >
  host `snap={true}` > off, sitting next to the grid and connector
  toggles, and consulted by the drag machinery.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/shortcuts_and_toggles_test.js", __DIR__)

  test "tool shortcuts, alt-drag duplicate and the snap toggle work" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js shortcut checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "shortcuts-and-toggles checks failed:\n\n#{output}"
    end
  end
end
