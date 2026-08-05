defmodule Etcher.JsAudioTest do
  @moduledoc """
  Runs `test/js/audio_test.js`, which pins the audio card's pure logic: how a
  timecode is formatted, when a client corrects its playback position to match
  the room, and which files become audio cards rather than images.

  The drift rule is the one that most needs guarding. Transport state arrives
  continuously while something is playing, so correcting on every message
  would stutter audibly — corrections only happen past a threshold, and that
  threshold is a constant with no local explanation for why it isn't smaller.

  Shelled out to node for the same reason as the other JS checks: it keeps the
  coverage inside `mix test` without adding a JS toolchain. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/audio_test.js", __DIR__)

  test "audio timecodes, drift correction and file routing behave as specified" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js audio checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "audio checks failed:\n\n#{output}"
    end
  end
end
