defmodule Etcher.JsArrowLabelShaftTest do
  @moduledoc """
  Runs `test/js/arrow_label_shaft_test.js`, which pins the arrow's label to
  its shaft.

  A dimension's label has always ridden its line — centred at
  `metadata.title_offset`, dragged along the shaft, no leader. The arrow's
  label used to float anywhere like an ordinary title; it now rides too
  (head dev's call — the label names the pointing), while the plain line
  keeps its free label. The test drives `_shapeTitleBoxImage` for the
  centred-and-slid position, the size-only role of the stored box, and the
  line's unchanged freedom, and pins that every riding site routes through
  `_labelRidesShaft`.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/arrow_label_shaft_test.js", __DIR__)

  test "an arrow's label rides its shaft like a dimension's" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js arrow label checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "arrow label shaft checks failed:\n\n#{output}"
    end
  end
end
