defmodule Etcher.JsArrowToolTest do
  @moduledoc """
  Runs `test/js/arrow_tool_test.js`, which pins the single-arrow tool.

  A dimension is a measurement: two heads, and a label it drops the user
  into writing because it is unfinished without one. The arrow is the other
  thing people reach a line-with-an-end for — pointing — so it has one head
  and no label unless asked for, the way every other shape does.

  It reuses the `arrow` kind connectors are made of rather than inventing a
  second one: same render, same handles, same bend-dropping, same stroke
  params, with no bindings — which is all a connector's `from` / `to` ever
  were. It draws by drag or by click-click like the other two-ended tools,
  since it shares their commit path.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/arrow_tool_test.js", __DIR__)

  test "the arrow tool draws a one-headed line with no label editor" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js arrow tool checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "arrow tool checks failed:\n\n#{output}"
    end
  end
end
