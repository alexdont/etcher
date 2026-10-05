defmodule Etcher.JsLabelStepperTest do
  @moduledoc """
  Three things a phone cannot do that a desktop can, and what was done about
  each.

  **A new text box asks for its text.** `_commitText` has always dropped
  straight into the editor, and on a desktop that is what happens. On a phone
  the editor opened and the keyboard did not: the focus was deferred by a
  `setTimeout`, and WebKit raises the on-screen keyboard only for a focus that
  happens inside the user gesture that asked for it. What you got was a box
  with a placeholder in it and no way to type — until you tapped it again,
  which is a gesture of its own. Focused synchronously now, and again on the
  next tick as before.

  **The label size has buttons.** It is an `<input type="number">`, which a
  desktop browser draws spinner arrows inside and a phone draws nothing
  inside. The only way to change a label's size on a phone was to type a
  number. Now there is a minus and a plus, on both.

  **Two fingers pan under the select tool.** The marquee is drawn from
  document-level pointer handlers, because in cursor mode the drawing overlay
  takes no events at all — so the multi-touch rule that the drawing tools
  learned never reached it. Each finger opened a marquee and both dragged it:
  "it starts creating a lot of select boxes between the two fingers,
  selecting and deselecting non-stop".
  """
  use ExUnit.Case, async: true

  @source Path.expand("../priv/static/etcher.js", __DIR__)

  defp source, do: File.read!(@source)

  defp fn_body(name, len) do
    [_, body] = String.split(source(), name, parts: 2)
    String.slice(body, 0, len)
  end

  describe "a text box you have just drawn" do
    test "takes the caret inside the gesture that made it" do
      body =
        fn_body(
          "document.addEventListener(\"pointerdown\", self._textEditOutsideDown, true);",
          1800
        )

      # On the CALL, not the word: the comment beside it explains why a
      # `setTimeout` is the wrong place for this focus.
      [immediate, _] = String.split(body, "setTimeout(function()", parts: 2)

      assert immediate =~ "input.focus();",
             "a focus deferred by even a tick is outside the gesture, and " <>
               "WebKit opens no keyboard for it"
    end

    test "and again on the next tick, as it always did" do
      body =
        fn_body(
          "document.addEventListener(\"pointerdown\", self._textEditOutsideDown, true);",
          1800
        )

      assert body =~
               "setTimeout(function() { try { input.focus(); input.select(); } catch (_) {} }, 0);",
             "the foreignObject is attached by then — a browser that ignored " <>
               "the first focus takes this one"
    end

    test "the editor is opened by the tool, not by a second tap" do
      # This was already true, and is what made the phone's behaviour read as
      # a bug rather than a missing feature.
      assert fn_body("_commitText: function", 3000) =~ "self._startTextEdit(shape);"
    end
  end

  describe "typing into a text box does not zoom the page" do
    test "the editor's font is floored where a phone would zoom" do
      # Mobile Safari zooms the PAGE when an input under 16px takes focus.
      # On a canvas that is a trap: the pinch that would undo it belongs to
      # the board, so the page stays zoomed and there is no way back short of
      # a reload. Reported as "every single time I start creating text, it
      # zooms me in… eventually I can no longer zoom out".
      body = fn_body("_editorFontPx: function", 700)

      assert body =~ "px >= INPUT_PAGE_ZOOM_PX) return px;"

      assert body =~ ~s|window.matchMedia("(pointer: coarse)")|,
             "a desktop browser does no such thing, and there the editor " <>
               "should look exactly like the result"

      assert body =~ "return coarse ? INPUT_PAGE_ZOOM_PX : px;"
      assert File.read!(@source) =~ "var INPUT_PAGE_ZOOM_PX = 16;"
    end

    test "and every place the editor's font is set goes through it" do
      src = source()

      # Three: the editor opening, the board zooming under an open one, and
      # a panel edit landing on it. One of them left out is one route back to
      # a page that zooms.
      assert src =~ "edFontSize = this._editorFontPx(edFontSize);"

      for [line] <- Regex.scan(~r/^.*input\.style\.fontSize = .*$/m, src) do
        assert line =~ "size + \"px\"",
               "an editor font set from anything but the floored size: #{line}"
      end

      assert length(Regex.scan(~r/size = this\._editorFontPx\(size\);/, src)) == 2,
             "the two later ones — zoom, and a panel edit"
    end

    test "what the shape keeps is its own size" do
      # The floor is the box being typed into, not the text. Nothing about
      # it is stored, or a phone would mint bigger text than a desktop.
      src = File.read!(@source)

      [_, commit] = String.split(src, "_commitTextEdit: function", parts: 2)
      commit = String.slice(commit, 0, 4000)

      refute commit =~ "_editorFontPx"
      refute commit =~ "font_size"
    end
  end

  describe "a text box minted by a tap" do
    test "is floored at the size it would be at 1:1" do
      body = fn_body("_newTextBoxPx: function", 600)

      assert body =~ "var ink = this._textDefaultBoxInkPx();",
             "ink is still the rule — this only stops it disappearing"

      assert body =~ "readable = NEW_TEXT_MIN_SCREEN_PX / scale;"
      assert body =~ "return readable > ink ? readable : ink;"
    end

    test "and the tap path uses it" do
      assert fn_body("_commitText: function", 1400) =~ "var boxPx = this._newTextBoxPx();"
    end

    test "a drawn box is left alone" do
      # They said how big by drawing it; only the minted default is floored.
      body = fn_body("_commitText: function", 1400)

      assert body =~ "var drewBox = geom.h >= minImagePx;"

      assert body =~ "if (geom.w < minImagePx) geom.w = boxPx * 4;",
             "the default size is only reached when nothing was drawn"
    end
  end

  describe "label size" do
    test "has a button either side of the number" do
      src = source()

      assert src =~ ~s|self._makeStepButton("−", "Smaller", "etcher-step-down")|
      assert src =~ ~s|self._makeStepButton("+", "Larger", "etcher-step-up")|
      assert src =~ "fontStep.appendChild(fontDown);"
      assert src =~ "fontStep.appendChild(fontUp);"
    end

    test "and stacks in the compact strip, plus on top" do
      # The strip is one column — that is what it is for, giving the board
      # back its width. A row of three made it three controls wide.
      src = source()

      [_, rule] = String.split(src, ~s|[data-size=\\"compact\\"] .etcher-stepper {|, parts: 2)
      rule = String.slice(rule, 0, 200)

      assert rule =~ "flex-direction: column"
      assert rule =~ "width: auto"

      # All three, or the number falls below the pair: ordering only the plus
      # leaves minus and number in DOM order behind it, which reads "+ − 16".
      assert src =~ ~s|[data-size=\\"compact\\"] .etcher-step-up { order: 1; }|
      assert src =~ ~s|[data-size=\\"compact\\"] .etcher-stepper .etcher-num { order: 2; }|
      assert src =~ ~s|[data-size=\\"compact\\"] .etcher-step-down { order: 3; }|

      refute src =~ "column-reverse",
             "ordered rather than reversed, so reading and tab order still " <>
               "follow the DOM"
    end

    test "and they step the same setting typing does" do
      body = fn_body("function stepFont(by) {", 600)

      assert body =~ "self._setFontSize(next, true);",
             "not a second path into the same setting — the same one"

      assert body =~ "clampFont(n + by)",
             "clamped like a typed number, or a step walks past the limits"
    end

    test "stepping an empty box starts from the size in use" do
      body = fn_body("function stepFont(by) {", 600)

      assert body =~ "if (!isFinite(n)) n = Math.round(self._defaultLabelFontSize());",
             "a box-sized label shows no number; the first press should nudge " <>
               "what is on screen, not jump to something nobody chose"
    end

    test "a press on one does not reach the canvas underneath" do
      body = fn_body("_makeStepButton: function", 900)

      assert body =~
               ~s|btn.addEventListener("pointerdown", function(e) { e.stopPropagation(); });|,
             "an empty-canvas press clears the selection — the selection whose " <>
               "size is being changed"

      assert body =~ "mousedown",
             "and the number box must keep focus, or a phone closes the " <>
               "keyboard between every step"
    end

    test "big enough to hit with a finger" do
      src = source()

      assert src =~ "\"@media (pointer: coarse) {\","
      assert src =~ "\"  .etcher-step { width: 36px; height: 36px; font-size: 17px; }\","
    end
  end

  describe "the select tool and two fingers" do
    defp doc_handler(name) do
      [_, body] = String.split(source(), "self.#{name} = function(e) {", parts: 2)
      [body, _] = String.split(body, "\n      };", parts: 2)
      body
    end

    test "the press counts fingers, the way the drawing overlay does" do
      body = doc_handler("_docPointerDown")

      assert body =~ "self._trackTouch(e, true);",
             "in cursor mode the overlay takes no events — these handlers are " <>
               "the whole interaction, so the counting has to happen here too"
    end

    test "two of them abandon the marquee and leave the gesture to the canvas" do
      body = doc_handler("_docPointerDown")

      assert body =~ "if (self._multiTouch) {"
      assert body =~ "self._cancelBoxSelect();"
      assert body =~ "self._pendingTap = null;"
    end

    test "and only the finger that opened a marquee may drag it" do
      body = doc_handler("_docPointerMove")

      assert body =~ "if (bs.pointerId != null && e.pointerId !== bs.pointerId) return;",
             "both fingers reporting into one box is the flicker that was reported"
    end

    test "nothing is selected on the way out of a pinch" do
      body = doc_handler("_docPointerUp")

      assert body =~ "if (self._multiTouch) {"
    end

    test "abandoning takes the marquee off screen and selects nothing" do
      body = fn_body("_cancelBoxSelect: function", 400)

      assert body =~ "this._boxSelect = null;"
      assert body =~ "parentNode.removeChild(bs.el)"

      assert body =~ "this._clearBoxSelectPreview(bs);",
             "the shapes it was touching go back to normal rather than " <>
               "keeping a selected look"

      refute body =~ "_commitBoxSelect",
             "a gesture that turned into a pan selected nothing"
    end
  end
end
