defmodule Etcher.JsLabelEditorPositionTest do
  @moduledoc """
  Runs `test/js/label_editor_position_test.js`, which pins where the label
  editor opens when a shape is double-clicked.

  A brand-new label lands centered in its shape, but the editor used to
  open at the float-above default — you typed above the rectangle and the
  text jumped into the middle on commit. The editor now opens where the
  label will land; existing labels keep their editor wherever the label
  actually is.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/label_editor_position_test.js", __DIR__)

  test "the label editor opens centered in a label-less shape" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js label-editor checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "label-editor-position checks failed:\n\n#{output}"
    end
  end
end
