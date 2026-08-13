defmodule Etcher.JsShaftParamsTest do
  @moduledoc """
  Runs `test/js/shaft_params_test.js`, which pins that the shaft kinds —
  line, arrow, dimension — carry real stroke params (thickness / opacity /
  line type), not just a color.

  Before this, `_paramsTargetShapes` excluded them (so the params popup
  silently edited the global default while a selected line stayed 2px
  solid), and their widths were recomputed from the board scale on every
  render frame, so no styled width could survive a pan anyway. Now the
  render cases read the shape's style, arrowheads scale with the shaft, dash
  lands on the shaft only, and a shape without a styled width renders
  exactly as before.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/shaft_params_test.js", __DIR__)

  test "line, arrow and dimension take thickness / opacity / line type" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js shaft param checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "shaft param checks failed:\n\n#{output}"
    end
  end
end
