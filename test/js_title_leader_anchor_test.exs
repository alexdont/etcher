defmodule Etcher.JsTitleLeaderAnchorTest do
  @moduledoc """
  Runs `test/js/title_leader_anchor_test.js`, which pins where a label's
  leader line attaches on both ends.

  The label end was hardcoded to the box's bottom-center — right for the
  float-above default, and exactly wrong for a label dragged below its
  shape, where the leader left from the far side and crossed the text.
  Each end now anchors at the point facing the other: the parent's nearest
  perimeter point, clamped into the label rect. Directly above, that
  degenerates to the old bottom-center, so the default layout is
  unchanged.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/title_leader_anchor_test.js", __DIR__)

  test "the leader anchors on the label edge facing the shape" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js leader-anchor checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "title-leader-anchor checks failed:\n\n#{output}"
    end
  end
end
