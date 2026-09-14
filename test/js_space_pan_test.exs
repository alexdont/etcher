defmodule Etcher.JsSpacePanTest do
  @moduledoc """
  Runs `test/js/space_pan_test.js`, which pins hold-space-to-pan.

  The convention in every comparable tool, and worth having for the same
  reason they all do: reaching for the hand tool means losing your place in
  whatever you were drawing with. Hold space, pan, let go, carry on.

  Three things it must not do. Type: the handler's INPUT / TEXTAREA gate
  keeps a space typed into a label a space. Eat work: changing tools cancels
  a draft, so it refuses to engage while a shape is in flight. Override a
  choice: a tool picked mid-pan survives the release.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/space_pan_test.js", __DIR__)

  test "holding space pans and releasing restores the tool" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js space pan checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "space pan checks failed:\n\n#{output}"
    end
  end
end
