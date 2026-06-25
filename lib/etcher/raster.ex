defmodule Etcher.Raster do
  @moduledoc """
  Server-side, dependency-free rendering of Etcher annotations to static output.

  Etcher renders shapes live (SVG) on the Fresco canvas in the browser. This
  module is the *server* counterpart: it turns the same annotation geometry into
  either **ImageMagick `convert -draw` arguments** (to bake shapes into a raster
  — e.g. an annotated thumbnail) or a standalone **SVG string** (to overlay
  shapes on an image without JS).

  It is the single source of truth for "Etcher geometry → drawn shape" on the
  server, mirroring the wire format documented in the README. Pure functions, no
  system dependencies — the caller owns rasterization (running `convert`,
  embedding the SVG, …).

  ## Input

  A list of annotation maps as they travel in `etcher:annotations-changed` /
  the `extensions.etcher` blob — `%{"kind" => ..., "geometry" => ..., "style" =>
  ...}` (string keys; atom keys are also accepted). Unknown or malformed shapes
  are skipped, so one bad row never breaks a render.

  ## Examples

      iex> rect = [%{"kind" => "rectangle", "geometry" => %{"x" => 10, "y" => 20, "w" => 30, "h" => 40}}]
      iex> Etcher.Raster.to_draw_args(rect, stroke_width: 4)
      ["-fill", "none", "-stroke", "#ef4444", "-strokewidth", "4", "-draw", "rectangle 10,20 40,60"]

      iex> rect = [%{"kind" => "rectangle", "geometry" => %{"x" => 10, "y" => 20, "w" => 30, "h" => 40}}]
      iex> Etcher.Raster.to_svg(rect, width: 100, height: 100)
      ~s(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none"><rect x="10" y="20" width="30" height="40" stroke="#ef4444" stroke-width="2"/></svg>)
  """

  @default_color "#ef4444"
  @default_stroke 2

  @type annotation :: map()
  @type opts :: keyword()

  @doc """
  Builds ImageMagick `convert` arguments that draw the annotations' outlines.

  Returns a flat arg list to splice into a `convert` invocation *before* any
  resize/crop, so shapes are drawn in the source image's pixel space (Etcher
  geometry is in canvas/image pixels) and scale with the image.

  Returns `[]` when there is nothing drawable.

  ## Options

    * `:stroke_width` — outline width in source pixels (default `#{@default_stroke}`)
    * `:default_color` — colour for shapes without a `style` colour (default `#{@default_color}`)
  """
  @spec to_draw_args([annotation()], opts()) :: [String.t()]
  def to_draw_args(annotations, opts \\ []) when is_list(annotations) do
    sw = to_string(Keyword.get(opts, :stroke_width, @default_stroke))
    default = Keyword.get(opts, :default_color, @default_color)

    draws =
      annotations
      |> primitives()
      |> Enum.flat_map(fn {prim, color} ->
        ["-stroke", color || default, "-strokewidth", sw, "-draw", im_draw(prim)]
      end)

    if draws == [], do: [], else: ["-fill", "none"] ++ draws
  end

  @doc """
  Renders the annotations as a standalone `<svg>` string (outlines only).

  Suitable as an absolutely-positioned overlay on an image. With
  `preserveAspectRatio="xMidYMid slice"` the SVG crops identically to CSS
  `object-cover`, so shapes line up with a cover-fit thumbnail.

  Returns `""` when there is nothing drawable.

  ## Options

    * `:width` / `:height` — the source image dimensions for the `viewBox`
      (required for correct positioning; default `100`)
    * `:stroke_width` — outline width in viewBox units (default `#{@default_stroke}`)
    * `:default_color` — colour fallback (default `#{@default_color}`)
    * `:class` — extra class on the `<svg>` element
  """
  @spec to_svg([annotation()], opts()) :: String.t()
  def to_svg(annotations, opts \\ []) when is_list(annotations) do
    w = Keyword.get(opts, :width, 100)
    h = Keyword.get(opts, :height, 100)
    sw = Keyword.get(opts, :stroke_width, @default_stroke)
    default = Keyword.get(opts, :default_color, @default_color)
    class = Keyword.get(opts, :class)

    elements =
      annotations
      |> primitives()
      |> Enum.map_join("", fn {prim, color} -> svg_element(prim, color || default, sw) end)

    case elements do
      "" ->
        ""

      svg ->
        class_attr = if class, do: ~s( class="#{class}"), else: ""

        ~s(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 #{w} #{h}") <>
          ~s( preserveAspectRatio="xMidYMid slice" fill="none"#{class_attr}>) <>
          svg <> "</svg>"
    end
  end

  @doc """
  Normalises annotations into drawing primitives + colour.

  Each entry is `{primitive, color}` where `primitive` is one of:
  `{:rect, x, y, w, h}`, `{:circle, cx, cy, r}`, `{:polygon, points}`,
  `{:polyline, points}`, `{:line, x1, y1, x2, y2}` (coords are numbers, `points`
  is a list of `{x, y}`). Exposed so callers can add their own backend.
  """
  @spec primitives([annotation()]) :: [{tuple(), String.t() | nil}]
  def primitives(annotations) when is_list(annotations) do
    Enum.flat_map(annotations, fn ann ->
      kind = get(ann, "kind")
      geometry = get(ann, "geometry") || %{}
      color = color(get(ann, "style"))

      kind
      |> shape_primitives(geometry)
      |> Enum.map(&{&1, color})
    end)
  end

  # ── kind → primitive(s) (mirrors the README geometry table) ──────────────

  defp shape_primitives("rectangle", %{} = g), do: rect(g)
  defp shape_primitives("text", %{} = g), do: rect(g)

  defp shape_primitives("circle", g),
    do: with_keys(g, ["cx", "cy", "r"], &[{:circle, &1, &2, &3}])

  defp shape_primitives("polygon", %{"points" => p}) when is_list(p), do: poly(:polygon, p)

  defp shape_primitives(k, g) when k in ["freehand", "marker"],
    do: poly(:polyline, stroke_points(g))

  defp shape_primitives(k, g) when k in ["line", "dimension"], do: ab_line(g)

  defp shape_primitives("callout", g) do
    box = rect(get(g, "text_box") || %{})

    case {get(g, "anchor"), box} do
      {anchor, [{:rect, x, y, _w, _h}]} when not is_nil(anchor) ->
        {ax, ay} = pt(anchor)
        box ++ [{:line, num(ax), num(ay), x, y}]

      {_, box} ->
        box
    end
  end

  # callout/text/eraser/unknown/malformed → nothing
  defp shape_primitives(_kind, _geometry), do: []

  defp rect(%{} = g) do
    with_keys(g, ["x", "y", "w", "h"], fn x, y, w, h -> [{:rect, x, y, w, h}] end)
  end

  defp ab_line(g) do
    case {get(g, "a"), get(g, "b")} do
      {a, b} when not is_nil(a) and not is_nil(b) ->
        {ax, ay} = pt(a)
        {bx, by} = pt(b)
        [{:line, num(ax), num(ay), num(bx), num(by)}]

      _ ->
        []
    end
  end

  defp poly(_tag, []), do: []
  defp poly(tag, points), do: [{tag, Enum.map(points, &pt/1)}]

  # freehand/marker → a flat list of polyline points. Markers and legacy
  # freehand store raw `points`; vector freehand stores cubic-bezier `nodes`
  # (`%{"p" => [x, y], "hOut" => [dx, dy], "hIn" => [dx, dy]}`). Flatten the
  # latter the same way the canvas does (mirrors Etcher's `_freehandFlatten`),
  # so a curvy stroke reads as a curve in the baked output, not a chord.
  defp stroke_points(g) do
    case {get(g, "points"), get(g, "nodes")} do
      {points, _} when is_list(points) and points != [] -> points
      {_, nodes} when is_list(nodes) and nodes != [] -> flatten_nodes(nodes)
      _ -> []
    end
  end

  @flatten_steps 16

  defp flatten_nodes([only]), do: [xy(get(only, "p"))]

  defp flatten_nodes([first | _] = nodes) do
    curve =
      nodes
      |> Enum.chunk_every(2, 1, :discard)
      |> Enum.flat_map(fn [prev, cur] ->
        p0 = xy(get(prev, "p"))
        p3 = xy(get(cur, "p"))
        p1 = add(p0, xy(get(prev, "hOut")))
        p2 = add(p3, xy(get(cur, "hIn")))
        for s <- 1..@flatten_steps, do: cubic(p0, p1, p2, p3, s / @flatten_steps)
      end)

    [xy(get(first, "p")) | curve]
  end

  defp add({ax, ay}, {bx, by}), do: {ax + bx, ay + by}

  defp cubic({x0, y0}, {x1, y1}, {x2, y2}, {x3, y3}, t) do
    mt = 1 - t
    a = mt * mt * mt
    b = 3 * mt * mt * t
    c = 3 * mt * t * t
    d = t * t * t
    {a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3}
  end

  # ── primitive → ImageMagick `-draw` ──────────────────────────────────────

  defp im_draw({:rect, x, y, w, h}), do: "rectangle #{x},#{y} #{x + w},#{y + h}"
  # IM circle = centre point + a point on the perimeter.
  defp im_draw({:circle, cx, cy, r}), do: "circle #{cx},#{cy} #{cx},#{cy - r}"
  defp im_draw({:polygon, points}), do: "polygon " <> points_str(points)
  defp im_draw({:polyline, points}), do: "polyline " <> points_str(points)
  defp im_draw({:line, x1, y1, x2, y2}), do: "line #{x1},#{y1} #{x2},#{y2}"

  defp points_str(points), do: Enum.map_join(points, " ", fn {x, y} -> "#{x},#{y}" end)

  # ── primitive → SVG element ──────────────────────────────────────────────

  defp svg_element({:rect, x, y, w, h}, color, sw),
    do: ~s(<rect x="#{x}" y="#{y}" width="#{w}" height="#{h}" #{stroke(color, sw)}/>)

  defp svg_element({:circle, cx, cy, r}, color, sw),
    do: ~s(<circle cx="#{cx}" cy="#{cy}" r="#{r}" #{stroke(color, sw)}/>)

  defp svg_element({:polygon, points}, color, sw),
    do: ~s(<polygon points="#{svg_points(points)}" #{stroke(color, sw)}/>)

  defp svg_element({:polyline, points}, color, sw),
    do: ~s(<polyline points="#{svg_points(points)}" #{stroke(color, sw)}/>)

  defp svg_element({:line, x1, y1, x2, y2}, color, sw),
    do: ~s(<line x1="#{x1}" y1="#{y1}" x2="#{x2}" y2="#{y2}" #{stroke(color, sw)}/>)

  defp svg_points(points), do: Enum.map_join(points, " ", fn {x, y} -> "#{x},#{y}" end)
  defp stroke(color, sw), do: ~s(stroke="#{color}" stroke-width="#{sw}")

  # ── helpers ──────────────────────────────────────────────────────────────

  # Pull the listed numeric keys from a geometry map; if any is missing, the
  # shape is skipped. Coordinates are rounded to integers.
  defp with_keys(g, keys, build) do
    values = Enum.map(keys, &get(g, &1))

    if Enum.any?(values, &is_nil/1) do
      []
    else
      apply(build, Enum.map(values, &num/1))
    end
  end

  # A point, rounded to integers for output: `[x, y]`, `{x, y}`, or
  # `%{"x" =>, "y" =>}` → `{xi, yi}`.
  defp pt(p) do
    {x, y} = xy(p)
    {num(x), num(y)}
  end

  # The same point parse, but keeping float precision — used for bezier math
  # where intermediate rounding would visibly kink the flattened curve.
  defp xy([x, y]), do: {x, y}
  defp xy({x, y}), do: {x, y}
  defp xy(%{"x" => x, "y" => y}), do: {x, y}
  defp xy(%{x: x, y: y}), do: {x, y}
  defp xy(_), do: {0, 0}

  defp num(v) when is_number(v), do: round(v)
  defp num(_), do: 0

  defp color(%{"color" => c}) when is_binary(c) and c != "", do: c
  defp color(%{"stroke" => c}) when is_binary(c) and c != "", do: c
  defp color(%{color: c}) when is_binary(c) and c != "", do: c
  defp color(_), do: nil

  # String-or-atom key access (annotations may arrive with either).
  defp get(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, v} -> v
      :error -> safe_atom_fetch(map, key)
    end
  end

  defp get(_map, _key), do: nil

  defp safe_atom_fetch(map, key) when is_binary(key) do
    Map.get(map, String.to_existing_atom(key))
  rescue
    ArgumentError -> nil
  end

  defp safe_atom_fetch(_map, _key), do: nil
end
