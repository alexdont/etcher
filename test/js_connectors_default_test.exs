defmodule Etcher.JsConnectorsDefaultTest do
  @moduledoc """
  Runs `test/js/connectors_default_test.js`, which pins who decides whether
  connector anchors are on.

  Three layers, most specific wins: the user's saved preference (either
  direction), else the host's `connectors={true}` default, else OFF. They
  used to default ON — an affordance for boards where people draw
  connectors that, everywhere else, was eight dots appearing under the
  cursor on every shape passed over.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/connectors_default_test.js", __DIR__)

  test "connector anchors resolve user pref > host default > off" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js connectors checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "connectors-default checks failed:\n\n#{output}"
    end
  end
end
