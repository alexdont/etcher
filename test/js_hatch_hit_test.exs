defmodule Etcher.JsHatchHitTest do
  @moduledoc """
  Runs `test/js/hatch_hit_test.js`, which pins what a hatch-filled shape's
  click target is.

  The hatch fill ("lines") is mostly gaps — a region drawn with it is a
  window, not a surface. But the hit-test treated its whole interior as a
  target, so one big hatched annotation swallowed every click inside it,
  including on the shapes underneath that the user can plainly see and is
  reaching for. Hatched shapes are now grabbed by their outline, with the
  same grab tolerance a line or an arrow uses.

  Every other fill is unchanged, `"none"` included: outline-only shapes have
  taken a body hit since the beginning and are often a big empty box drawn
  around something.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/hatch_hit_test.js", __DIR__)

  test "a hatched shape is grabbed by its outline, not through its stripes" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js hatch hit-target checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "hatch hit-target checks failed:\n\n#{output}"
    end
  end
end
