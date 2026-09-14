defmodule Etcher.JsWheelZoomTest do
  @moduledoc """
  Runs `test/js/wheel_zoom_test.js`, which pins that the scroll wheel still
  zooms while a drawing tool is held.

  Fresco bails out of its own wheel handler when the event comes from an
  element carrying `data-fresco-no-capture`. The drawing overlay carries it
  — that is how a press that draws doesn't also pan the canvas — but the
  attribute is read by the wheel handler too, and arming a tool switches the
  overlay to `pointer-events: auto`, which makes it the target of scrolls as
  well as presses. So zoom silently stopped working for as long as a tool
  was held, while panning kept working.

  The overlay now forwards the scroll to `handle.zoomAt/3` itself, mirroring
  Fresco's own rate and viewport-relative anchor. The test reads the rate out
  of Fresco's source and fails if the two ever diverge, since a zoom that
  changes speed depending on whether a tool is armed would be worse than the
  bug.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/wheel_zoom_test.js", __DIR__)

  test "the wheel zooms with a drawing tool armed, at Fresco's own rate" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js wheel zoom checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "wheel zoom checks failed:\n\n#{output}"
    end
  end
end
