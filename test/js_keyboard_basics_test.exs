defmodule Etcher.JsKeyboardBasicsTest do
  @moduledoc """
  Runs `test/js/keyboard_basics_test.js`, which pins the keyboard and
  gesture basics every comparable canvas tool honors: the Escape ladder
  (draft → armed tool → selection, one rung per press), arrow-key nudge
  (1 screen px, 10 with shift, one undo entry and one server emit per
  burst), ⌘D duplicate (consumed only on success — the browser owns the
  bookmark key otherwise), ⌘A select-all (editable shapes, cursor mode
  only), shift-constrained drawing (rect → square, shafts → 45°), and
  shift axis-lock while moving.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/keyboard_basics_test.js", __DIR__)

  test "escape ladder, nudge, cmd+d/a, and shift constraints all work" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js keyboard checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "keyboard-basics checks failed:\n\n#{output}"
    end
  end
end
