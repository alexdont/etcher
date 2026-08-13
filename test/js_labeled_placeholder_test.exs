defmodule Etcher.JsLabeledPlaceholderTest do
  @moduledoc """
  Runs `test/js/labeled_placeholder_test.js`, which pins how the dimension
  and callout tools complete a gesture.

  Both used a hidden two-click mode — release armed the draft and only the
  next click placed the far end, which testers read as the first click
  doing nothing. Now pointerup ends the gesture like every other tool: a
  bare click places a default-sized placeholder, a drag places exactly what
  was dragged, and both kinds drop straight into label editing (selected,
  inline input open). Lines share the machinery but stay label-silent —
  consumers collect line titles via their own composer.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/labeled_placeholder_test.js", __DIR__)

  test "dimension and callout place placeholders and open their label" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js labeled-placeholder checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "labeled-placeholder checks failed:\n\n#{output}"
    end
  end
end
