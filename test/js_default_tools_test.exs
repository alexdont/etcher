defmodule Etcher.JsDefaultToolsTest do
  @moduledoc """
  Runs `test/js/default_tools_test.js`, which pins which tools a first-time
  user finds on the toolbar.

  Two lists, which had drifted apart. `:tools` on the component says which
  tools the board OFFERS; `ESSENTIAL_TOOLS` says which of those get a button
  on the bar, the rest living one press of `⋯` away.

  `line` and `image` were on the bar list but were not offered by default,
  so they could never appear — dead entries. Meanwhile rectangle, circle and
  arrow, the three shapes people actually draw on a picture, were all in the
  overflow grid.

  The test keeps the two lists consistent (nothing on the bar that isn't
  offered), keeps the common tools on it and the specialised ones off, and
  caps its length — a bar that holds everything is not a bar.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/default_tools_test.js", __DIR__)

  test "the default toolbar holds the common tools and nothing niche" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js default tool checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "default tool checks failed:\n\n#{output}"
    end
  end
end
