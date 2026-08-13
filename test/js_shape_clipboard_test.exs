defmodule Etcher.JsShapeClipboardTest do
  @moduledoc """
  Runs `test/js/shape_clipboard_test.js`, which pins the shape clipboard:
  ⌘C serializes the selection onto the DOM copy event (custom MIME +
  text/plain, uuid stripped so a same-board paste can't collide), ⌘X also
  deletes, and ⌘V rebuilds the shapes offset 16px with fresh uuids and
  selects them — routed ahead of the image/text paste paths, capped
  against hostile payloads, and deferring to real text selections and
  form fields.

  Shelled out to node for the same reason as the other JS checks: it keeps
  the coverage inside `mix test` without adding a JS toolchain. Skipped when
  node isn't on PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/shape_clipboard_test.js", __DIR__)

  test "shapes copy, cut and paste across boards" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js clipboard checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "shape-clipboard checks failed:\n\n#{output}"
    end
  end
end
