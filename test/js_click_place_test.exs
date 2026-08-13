defmodule Etcher.JsClickPlaceTest do
  @moduledoc """
  Runs `test/js/click_place_test.js`, which pins what a bare click with a
  drawing tool produces.

  User-testing feedback: a click either placed nothing (the tool reads as
  broken) or, with a pixel of jitter, placed a shape whose corners all sat
  within those pixels — a speck nothing can grab. Rectangle and circle now
  click-place a default-sized shape centered on the cursor, pen taps cancel
  instead of committing a speck, and both thresholds are judged in screen
  px so a click is the same gesture at every zoom.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/click_place_test.js", __DIR__)

  test "a bare click places a usable centered shape, never a speck" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js click-place checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "click-place checks failed:\n\n#{output}"
    end
  end
end
