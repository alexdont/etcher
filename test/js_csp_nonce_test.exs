defmodule Etcher.JsCspNonceTest do
  @moduledoc """
  Runs `test/js/csp_nonce_test.js` (GitHub issue #2): under a nonce-based
  Content-Security-Policy the `<style>` etcher.js creates, and the `<script>`
  it adds for SortableJS, carry the page's nonce, or the browser drops them.

  Shelled out to node like the other JS checks; skipped when node isn't on
  PATH.
  """
  use ExUnit.Case, async: true

  @script Path.expand("js/csp_nonce_test.js", __DIR__)

  test "created <style> and <script> elements take the page's nonce" do
    case System.find_executable("node") do
      nil ->
        IO.puts("\n[skip] node not found — skipping etcher.js CSP nonce checks")
        assert true

      node ->
        {output, status} = System.cmd(node, [@script], stderr_to_stdout: true)
        assert status == 0, "CSP nonce checks failed:\n\n#{output}"
    end
  end
end
