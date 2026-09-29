defmodule Etcher.JsTouchReleaseTest do
  @moduledoc """
  Runs `test/js/touch_release_test.js`, and pins the listener that uses it.

  Reported from an iPhone: the marker draws lines but will not place a dot —
  the one under a question mark, the one on an i. Tapping does nothing at all.

  The dot itself is not missing; it is committed on release, from a press with
  no drag behind it (`_commitFreehand`, where a click with a pen in hand is a
  dot rather than a mistake). What is missing is the release. iOS stops
  sending pointer events part-way through a gesture whenever its own
  classifier claims the touch — the same classifier that makes
  `touch-action` a CSS property here rather than something `pointerdown` can
  ask for — and a press whose `pointerup` never arrives leaves its draft
  uncommitted. Every other gesture has samples behind it and survives. The
  press that never moves has nothing but its release, so it is the one that
  vanishes.

  `touchend` is the model iOS actually implements, and it fires on the element
  the touch started on. So the release is taken from there as well, and does
  nothing at all when the pointer events did arrive.

  Not reproducible in a desktop browser, which finishes what it starts — so
  the test dispatches the shape of the failure rather than waiting for it.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/touch_release_test.js", __DIR__)
  @source Path.expand("../priv/static/etcher.js", __DIR__)

  test "a stranded draft is committed, and the tracking cannot leak" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js touch release checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "touch release checks failed:\n\n#{output}"
    end
  end

  describe "the touch's own release" do
    defp listener do
      src = File.read!(@source)
      [_, body] = String.split(src, "var onTouchRelease = function(e) {", parts: 2)
      [body, _] = String.split(body, "\n      };", parts: 2)
      body
    end

    test "is listened for, ended and cancelled alike" do
      src = File.read!(@source)

      assert src =~ ~s|wrapper.addEventListener("touchend", onTouchRelease);|

      assert src =~ ~s|wrapper.addEventListener("touchcancel", onTouchRelease);|,
             "a cancelled gesture still has to clear the finger count"
    end

    test "waits for the last finger, not the first" do
      assert listener() =~ "if (e.touches && e.touches.length) return;",
             "a finger lifting out of a two-finger pan is not the end of anything"
    end

    test "clears the tracking whatever the pointer stream did" do
      assert listener() =~ "self._resetTouchTracking();"
    end

    test "but only an ended gesture places anything" do
      body = listener()

      assert body =~ ~s|if (e.type !== "touchend") return;|,
             "`touchcancel` is the gesture being taken away, not finished — " <>
               "committing from it would draw something the user let go of"

      assert body =~ "self._commitStrandedDraft(e, drawId);"
    end

    test "the finger that owned the stroke is read before the tracking is cleared" do
      body = listener()

      assert body =~ "var drawId = self._drawPointerId;"

      [before, _] = String.split(body, "self._resetTouchTracking();", parts: 2)

      assert before =~ "var drawId",
             "read afterwards it is always null, and the release would carry " <>
               "no pointer at all"
    end
  end
end
