defmodule Etcher.JsPrefsTest do
  @moduledoc """
  Runs `test/js/prefs_test.js`, which pins the preferences contract — the part
  a host builds against.

  Etcher doesn't know who anyone is, so it can't follow a user between
  devices. The host can, and the contract exists so it may: listen for the
  change event, store it wherever makes sense — a user record, a row keyed by
  user and board, a cookie — and hand it back on mount. Nothing in etcher may
  assume which of those it is.

  The failure modes are all quiet ones: blanking a host's stored keys because
  ours has more of them, echoing what the host just told us back at it as a
  fresh write, or writing on every frame of a dragged slider.

  Shelled out to node for the same reason as the other JS checks. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/prefs_test.js", __DIR__)

  test "preferences merge, don't echo, and don't write per frame" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js preferences checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "preferences checks failed:\n\n#{output}"
    end
  end
end
