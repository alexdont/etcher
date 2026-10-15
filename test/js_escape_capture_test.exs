defmodule Etcher.JsEscapeCaptureTest do
  @moduledoc """
  Runs `test/js/escape_capture_test.js`.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/escape_capture_test.js", __DIR__)

  test "Escape is claimed ahead of the page when it cancels something" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js escape-capture checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "escape-capture checks failed:\n\n#{output}"
    end
  end
end
