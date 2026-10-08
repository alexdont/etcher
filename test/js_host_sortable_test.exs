defmodule Etcher.JsHostSortableTest do
  @moduledoc """
  Runs `test/js/host_sortable_test.js`: `window.Etcher.sortableUrl` (an
  authoritative SortableJS URL, no CDN after it fails) and
  `window.Etcher.loadSortableFromCdn = false` (no request at all), so a
  strict-CSP, offline or no-third-party host can keep the Customise dialog
  from ever requesting the CDN. Checked against attempted script URLs, not
  just successful loads. Skipped when node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/host_sortable_test.js", __DIR__)

  test "a host can supply SortableJS, or turn the CDN load off" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js host sortable checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "host sortable checks failed:\n\n#{output}"
    end
  end
end
