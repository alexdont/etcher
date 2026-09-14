defmodule Etcher.JsDimHeadHitTest do
  @moduledoc """
  Runs `test/js/dim_head_hit_test.js`, which pins that a dimension's
  V-arrowheads are part of the shape you can hover and click.

  The hit-test measured distance to the shaft and nothing else, so only the
  thin line answered. The heads scale with the stroke — that is what stops
  them being hairlines on a heavy line — so on a fat dimension they reach
  well outside the shaft's grab pad, and aiming at the chevron landed on
  empty canvas.

  The widening is local to the ends (the middle of a dimension is not a
  wide target just because its ends are), measured on screen like every
  other grab tolerance, and its 10x / 5x constants mirror the render's — a
  copy that drifts would draw the chevrons in one place and make them
  clickable in another, which the test guards against.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/dim_head_hit_test.js", __DIR__)

  test "a dimension's arrowheads can be hovered and clicked" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js dimension head hit checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "dimension head hit checks failed:\n\n#{output}"
    end
  end
end
