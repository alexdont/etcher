defmodule Etcher.JsTooltipActionsBadgeTest do
  @moduledoc """
  Runs `test/js/tooltip_actions_badge_test.js`, which pins the 0.13 host
  surface: tooltip action buttons re-dispatched as `etcher:tooltip-action`,
  `api.editLabel/1`, and the `metadata.badge` count bubble's lifecycle.
  Shelled out to node like the other JS checks; skipped when node is absent.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/tooltip_actions_badge_test.js", __DIR__)

  test "tooltip actions reach the host, editLabel exists, badges live and die with shapes" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js tooltip/badge checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "tooltip/badge checks failed:\n\n#{output}"
    end
  end
end
