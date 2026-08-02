defmodule Etcher.JsReorderTest do
  @moduledoc """
  Runs `test/js/reorder_test.js`, which pins the z-order array maths in
  `priv/static/etcher.js`.

  The JS bundle has no test harness of its own, and standing up a DOM one to
  exercise a pure array transform would be more machinery than the code under
  test. Shelling out to node keeps the coverage inside `mix test` — where it
  will actually be run — without adding a JS toolchain to the project.

  Skipped when node isn't on PATH, so the suite still passes on a machine
  without it (CI included, until node is added there).
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/reorder_test.js", __DIR__)

  test "z-order reordering behaves" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js z-order checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)

        assert status == 0, """
        etcher.js z-order checks failed:

        #{output}
        """

        assert output =~ "checks passed"
    end
  end
end
