defmodule Etcher.JsInsertedImageSizeTest do
  @moduledoc """
  Runs `test/js/inserted_image_size_test.js`: a pasted, dropped or inserted image
  is drawn a share of what is visible, so it is usable at any zoom.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/inserted_image_size_test.js", __DIR__)

  test "an inserted image is sized to the visible area" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js inserted-image-size checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "inserted-image-size checks failed:\n\n#{output}"
    end
  end
end
