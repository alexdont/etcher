defmodule Etcher.JsLongPressTest do
  @moduledoc """
  A slow stroke is a drawing, not a long press.

  Reported from an iPhone: holding down and drawing a long line slowly brings
  up the copy / find / selection / look-up bar, as if the canvas were text
  being selected. The drawing itself is fine — the bar lands on top of it.

  `user-select: none` does not stop it, and neither does
  `-webkit-touch-callout: none`; both are already on the viewer and on the
  page. iOS decides what a press MEANS at `touchstart`, before any pointer
  event runs, and once it has classified a slow press as a selection gesture
  the CSS is moot. Etcher already carries the same ordering problem elsewhere:
  `touch-action: none` has to be set in CSS on the handles because the iOS
  scroll classifier claims the drag before `pointerdown` can call
  `preventDefault`.

  So the default is refused at the only moment that works — on `touchstart`,
  on the overlay, which only catches touches while a drawing tool is armed.
  Presses that land on a label editor are left alone: there a press is meant
  to place a cursor and select words.

  None of this is observable from a desktop browser — Chrome does not
  implement the long-press UI and does not even report
  `-webkit-touch-callout` through `getComputedStyle` — so what is asserted
  here is the rule itself.
  """
  use ExUnit.Case, async: true

  @source Path.expand("../priv/static/etcher.js", __DIR__)

  defp source, do: File.read!(@source)

  defp handler(name) do
    [_, body] = String.split(source(), ~s|wrapper.addEventListener("#{name}"|, parts: 2)
    [body, _] = String.split(body, "\n      });", parts: 2)
    body
  end

  defp css_rule(selector) do
    [_, body] = String.split(source(), ~s|"#{selector} {",|, parts: 2)
    [body, _] = String.split(body, ~s|"}",|, parts: 2)
    body
  end

  describe "the press that iOS would call a selection" do
    test "is refused on touchstart, where iOS makes up its mind" do
      body = handler("touchstart")

      assert body =~ "e.preventDefault();",
             "by `pointerdown` the gesture has already been classified"
    end

    test "and the listener can actually refuse it" do
      [_, tail] = String.split(source(), ~s|wrapper.addEventListener("touchstart"|, parts: 2)

      assert String.slice(tail, 0, 1800) =~ "{ passive: false }",
             "a passive listener's `preventDefault` is ignored, silently"
    end

    test "unless the press is on a label editor, which owns its own cursor" do
      body = handler("touchstart")

      assert body =~ ~s|closest("input, textarea, [contenteditable]")|
      assert body =~ "return;"
    end

    test "and never where the default was not ours to refuse" do
      assert handler("touchstart") =~ "if (!e.cancelable) return;"
    end

    test "a selection made before the tool was armed is dropped" do
      # The bar renders from a selection. With none, there is nothing to show
      # — and nothing on a canvas was selectable to begin with.
      assert handler("touchstart") =~ "self._dropStraySelection();"

      [_, helper] = String.split(source(), "_dropStraySelection: function", parts: 2)
      helper = String.slice(helper, 0, 400)

      assert helper =~ "removeAllRanges"

      assert helper =~ "!sel.isCollapsed",
             "an empty selection is every ordinary press — leave the caret alone"
    end
  end

  describe "the drawing surface says it for itself" do
    test "no selection, no callout, on the overlay" do
      rule = css_rule(".etcher-overlay")

      assert rule =~ "-webkit-user-select: none"
      assert rule =~ "user-select: none"

      assert rule =~ "-webkit-touch-callout: none",
             "etcher also hangs off hosts with no viewer above it to inherit from"
    end

    test "but text being edited is still text" do
      [_, rule] = String.split(source(), ".etcher-overlay [contenteditable] {", parts: 2)
      rule = String.slice(rule, 0, 300)

      assert rule =~ "user-select: text",
             "selecting inside a label is how anyone fixes a typo"

      assert rule =~ "-webkit-user-select: text",
             "and the prefixed one is the half iOS reads"
    end
  end

  describe "what refusing the default must not cost" do
    test "the touches still reach the viewer, so two fingers still pan" do
      # `preventDefault` on a touch does not stop pointer events — they are
      # dispatched separately. This pins the press handler that depends on
      # that: a touch travels on to Fresco, which counts the fingers.
      assert handler("pointerdown") =~ ~s|if (e.pointerType !== "touch") e.stopPropagation();|
    end

    test "and drawing still starts from the same press" do
      assert handler("pointerdown") =~ "self._onPointerDown(e);"
    end
  end
end
