defmodule Etcher.JsTwoFingerPanTest do
  @moduledoc """
  Runs `test/js/two_finger_pan_test.js`, and pins the handlers that use what
  it counts.

  Two fingers move the canvas whichever tool is armed. Reported from a phone:
  with the marker out, a second finger made the line whip back and forth
  between the two fingers for as long as they both moved. The overlay claims
  pointer input, so the viewer had been told to ignore the first finger,
  leaving the second nothing to pinch WITH — it fed the same stroke instead.
  Moving around a board meant switching to the pan tool and back.

  The viewer's half is `Fresco.OverlayPinchTest`: a claimed finger is counted,
  a second one is a pinch. This is the overlay's half — stop drawing at two
  fingers, and do not resume in the middle of someone's pan.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/two_finger_pan_test.js", __DIR__)
  @source Path.expand("../priv/static/etcher.js", __DIR__)

  test "fingers are counted, and an abandoned erase deletes nothing" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js two-finger checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "two-finger checks failed:\n\n#{output}"
    end
  end

  describe "the press handler" do
    # One handler's body alone — cut at its own closing brace, so an
    # assertion cannot pass on a line that belongs to the handler below it.
    defp handler(name) do
      src = File.read!(@source)
      [_, body] = String.split(src, ~s|wrapper.addEventListener("#{name}"|, parts: 2)
      [body, _] = String.split(body, "\n      });", parts: 2)
      body
    end

    test "a touch travels on to the viewer; a mouse press stops here" do
      # The viewer cannot count fingers it never sees. A mouse has no second
      # pointer coming, and a drag that draws must not also pan.
      assert handler("pointerdown") =~ ~s|if (e.pointerType !== "touch") e.stopPropagation();|
    end

    test "two fingers down abandons the stroke AND the erase" do
      body = handler("pointerdown")

      assert body =~ "self._trackTouch(e, true);"
      assert body =~ "if (self._multiTouch) {"
      assert body =~ "self._cancelDraft();"

      assert body =~ "self._cancelErase();",
             "the eraser commits on release, not from a draft — an erase left " <>
               "armed would delete the greyed shapes when the pan ended"
    end

    test "only the finger that started the stroke moves it" do
      body = handler("pointermove")

      assert body =~ "if (self._multiTouch) return;"

      assert body =~ "e.pointerId !== self._drawPointerId",
             "the line jumped between the fingers because both of them drew it"
    end

    test "…and a mouse is not held to a finger's id" do
      # Nothing reports a mouse coming off the way a finger does, so the id
      # left behind by the last touch stroke would sit there blocking every
      # mouse move after it — and hover is what the tooltips and the handles
      # live on.
      assert handler("pointermove") =~ ~s|e.pointerType === "touch" &&|
    end

    test "a finger coming off a pinch does not finish a drawing" do
      assert handler("pointerup") =~ "if (self._multiTouch) return;",
             "`_onPointerUp` is where the eraser commits, which is the one " <>
               "thing that must not happen on the way out of a two-finger gesture"
    end
  end

  describe "the lock that frees the drag" do
    test "pan is locked for every tool but the grabber" do
      # Etcher tells the viewer to ignore a one-pointer drag while a tool is
      # armed — that drag is the drawing. The pinch is exempt from the lock
      # by the viewer's own design, which is what makes two fingers work
      # while a tool is out; the grabber hands the drag back deliberately.
      src = File.read!(@source)
      [_, body] = String.split(src, "_applyPanLock: function", parts: 2)
      body = String.slice(body, 0, 700)

      assert body =~ "setPanLocked("
      assert body =~ ~s|this.activeTool !== "grabber"|
      assert body =~ "this.annotationMode"
    end
  end
end
