defmodule Etcher.JsArrowCurveTest do
  @moduledoc """
  Runs `test/js/arrow_curve_test.js`, which pins the bent arrow's smooth
  curve.

  Grabbing an arrow's bend used to fold it into sharp corners; it now
  draws a centripetal Catmull-Rom curve through its bends, like the
  marker's stroke — and the hit test, bbox, label position and drag, and
  add-bend dots all sample the same curve, so what is hit and labelled is
  what is seen. A straight arrow stays exactly its two points.

  Shelled out to node like the other JS checks; skipped when node isn't
  on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/arrow_curve_test.js", __DIR__)

  test "a bent arrow draws and measures as a smooth curve" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js arrow curve checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "arrow curve checks failed:\n\n#{output}"
    end
  end
end
