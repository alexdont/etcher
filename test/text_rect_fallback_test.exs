defmodule Etcher.TextRectFallbackTest do
  @moduledoc """
  Pins the stroke ATTRIBUTE on every `.etcher-text-rect` to `"transparent"`.

  The attribute is only the fallback for a context rendering these shapes
  without the injected stylesheet (the class rules override it everywhere the
  stylesheet is in effect), and the correct fallback is the at-rest look —
  invisible. It used to be `"currentColor"`, which cost nothing in the normal
  case but painted a solid shape-coloured box around every label the moment
  anything rendered them CSS-less (reported live from a board page). The
  hover/draft/selected borders all come from class rules, so pinning the
  attribute costs no interactive state.
  """
  use ExUnit.Case, async: true

  @src File.read!(Path.expand("../priv/static/etcher.js", __DIR__))

  test "every .etcher-text-rect creation site sets a transparent stroke attribute" do
    marker = ~s[classList.add("etcher-text-rect")]
    sites = :binary.matches(@src, marker)

    # One per creation path: shape title group, callout draft, text draft,
    # rebuilt text, rebuilt callout. A new site must be audited here too.
    assert length(sites) == 5

    for {pos, _len} <- sites do
      from = max(pos - 400, 0)
      window = binary_part(@src, from, pos - from)

      # The rect's own attribute block sits between the last `svgEl("rect"`
      # and the classList.add — scoped so the callout's genuinely-stroked
      # sibling lines (leader, underline) don't leak into the assertion.
      {rect_at, _} = :binary.matches(window, ~s[svgEl("rect"]) |> List.last()
      rect_block = binary_part(window, rect_at, byte_size(window) - rect_at)

      assert rect_block =~ ~s[stroke: "transparent"],
             "text-rect creation at byte #{pos} lost its transparent stroke attribute"

      refute rect_block =~ ~s[stroke: "currentColor"],
             "text-rect creation at byte #{pos} regressed to a currentColor stroke attribute"
    end
  end
end
