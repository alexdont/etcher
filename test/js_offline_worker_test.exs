defmodule Etcher.JsOfflineWorkerTest do
  @moduledoc """
  Runs `test/js/offline_worker_test.js`: Etcher's offline service worker
  against a fake cache and network — what it keeps, network-first answers,
  deep-zoom tiles kept as they load, and offline answers. Skipped when node
  isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/offline_worker_test.js", __DIR__)

  test "the offline worker keeps pages, files and tiles and serves them offline" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher offline worker checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "offline worker checks failed:\n\n#{output}"
    end
  end
end
