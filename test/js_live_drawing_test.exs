defmodule Etcher.JsLiveDrawingTest do
  @moduledoc """
  Runs `test/js/live_drawing_test.js`, which pins the shape a peer can watch
  being drawn.

  A shape is emitted when it is finished, so on a shared canvas everyone else
  watched nothing happen for the length of a stroke and then a finished
  stroke appeared. In-flight MOVES were already reported for exactly that
  reason (`onShapesMoving`); this is the same idea one step earlier.

  Drawing is the harder half: there is no uuid until `_finalizeShape`, so
  nothing exists for a peer to patch against. The draft travels whole and the
  host says which peer it came from — one person draws one shape at a time.
  What the peer shows is a GHOST: built through the same factory a stored
  annotation goes through, so it looks like the shape that will replace it,
  and kept out of `shapes` so it cannot be selected, emitted, undone, saved
  or hit-tested.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/live_drawing_test.js", __DIR__)
  @source Path.expand("../priv/static/etcher.js", __DIR__)

  test "a stroke is reported while it is drawn, and a peer's is a ghost" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js live drawing checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "live drawing checks failed:\n\n#{output}"
    end
  end

  describe "the hand-over is wired to the shape being built" do
    test "a real shape retires the ghost of itself, before it is interactive" do
      # Where it sits matters as much as that it happens: inside the factory,
      # in the same task that builds the replacement. A frame boundary between
      # the two is the flash, whichever side of it the gap falls on.
      src = File.read!(@source)

      [_, tail] = String.split(src, "if (ghost) return shape;", parts: 2)
      tail = String.slice(tail, 0, 400)

      assert tail =~ "this._handOverGhost(shape);"

      assert String.split(tail, "_handOverGhost") |> hd() |> String.contains?("_attachShapeInteractions") ==
               false,
             "the hand-over comes first — a ghost still on screen while its " <>
               "replacement is being wired up is two copies of the line"
    end

    test "letting go retires the ghost rather than taking it away" do
      src = File.read!(@source)

      [_, body] = String.split(src, "applyDrawingEnd: function", parts: 2)
      body = String.slice(body, 0, 200)

      assert body =~ "_retireGhostDraw",
             "dropping it here is the flash: the stroke vanishes and comes " <>
               "back when the edit lands"

      refute body =~ "_dropGhostDraw"
    end
  end
end
