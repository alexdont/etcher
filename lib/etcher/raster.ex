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
      ["-fill", "none", "-fill", "#ef4444", "-stroke", "#ef4444", "-strokewidth", "4", "-draw", "fill-opacity 0.18 rectangle 10,20 40,60"]

      iex> outline = [%{"kind" => "rectangle", "geometry" => %{"x" => 10, "y" => 20, "w" => 30, "h" => 40}, "style" => %{"fill" => "none"}}]
      iex> Etcher.Raster.to_draw_args(outline, stroke_width: 4)
      ["-fill", "none", "-fill", "none", "-stroke", "#ef4444", "-strokewidth", "4", "-draw", "rectangle 10,20 40,60"]

      iex> rect = [%{"kind" => "rectangle", "geometry" => %{"x" => 10, "y" => 20, "w" => 30, "h" => 40}}]
      iex> Etcher.Raster.to_svg(rect, width: 100, height: 100)
      ~s(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none"><rect x="10" y="20" width="30" height="40" fill="#ef4444" fill-opacity="0.18" stroke="#ef4444" stroke-width="2"/></svg>)
  """

  @default_color "#ef4444"
  @default_stroke 2

  # Mirrors the canvas: label sizes (like ink weights) are quoted against a
  # 1000px reference canvas, and an unsized label is drawn at 16 on it.
  @reference_canvas_px 1000
  @default_label_font 16

  # Arrow head, in image px. Clamped to half the arrow's length at draw time
  # so a very short connector still reads as an arrow rather than a blob.
  @arrow_head_len 14
  @arrow_head_ratio 0.55

  @type annotation :: map()
  @type opts :: keyword()

  @doc """
  Builds ImageMagick `convert` arguments that draw the annotations — shape
  outlines, plus real glyphs for labels whose text is known (see `primitives/1`).

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
      |> primitives(opts)
      |> Enum.flat_map(fn
        {{:label, x, y, _w, h, text}, %{color: color}} ->
          # Glyphs, not an outline: filled text, stroke off, then fill reset
          # to `none` so the next outline primitive doesn't inherit it.
          # Sizing mirrors the live canvas (font ≈ 65% of the box height,
          # baseline ≈ 75% down, left pad ≈ 13%).
          [
            "-stroke",
            "none",
            "-fill",
            color || default,
            "-pointsize",
            to_string(label_font_size(h)),
            "-draw",
            "text #{x + label_pad(h)},#{y + label_baseline(h)} '#{im_escape(text)}'",
            "-fill",
            "none"
          ]

        {{:dot, x, y}, %{color: color}} ->
          # A disc, not a stroke: filled, no outline, radius from the width
          # the stroke would have been drawn at. `circle cx,cy px,py` takes
          # a point ON the circumference rather than a radius.
          [
            "-stroke",
            "none",
            "-fill",
            color || default,
            "-draw",
            "circle #{x},#{y} #{x},#{y + dot_radius(sw)}",
            "-fill",
            "none"
          ]

        {prim, %{color: color, fill: nil}} ->
          [
            "-fill",
            "none",
            "-stroke",
            color || default,
            "-strokewidth",
            sw,
            "-draw",
            im_draw(prim)
          ]

        {prim, %{color: color, fill: opacity}} ->
          # `fill-opacity` inside the MVG string rather than an alpha baked
          # into the colour: it takes whatever colour spec the shape carries
          # — hex, `rgb()`, a name — without this module having to parse it,
          # and the state dies with the `-draw` it is in.
          paint = color || default

          [
            "-fill",
            paint,
            "-stroke",
            paint,
            "-strokewidth",
            sw,
            "-draw",
            "fill-opacity #{opacity} " <> im_draw(prim)
          ]
      end)

    if draws == [], do: [], else: ["-fill", "none"] ++ draws
  end

  @doc """
  Renders the annotations as a standalone `<svg>` string — shape outlines,
  plus real glyphs for labels whose text is known (see `primitives/1`).

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
      |> primitives(opts)
      |> Enum.map_join("", fn {prim, paint} ->
        svg_element(prim, %{paint | color: paint.color || default}, sw)
      end)

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
  is a list of `{x, y}`), or `{:label, x, y, w, h, text}` — a text label drawn
  as glyphs, not outlined. Exposed so callers can add their own backend.
  """
  @spec primitives([annotation()]) :: [{tuple(), String.t() | nil}]
  def primitives(annotations, opts \\ []) when is_list(annotations) do
    base = label_base(opts)

    Enum.flat_map(annotations, fn ann ->
      kind = get(ann, "kind")
      geometry = get(ann, "geometry") || %{}
      style = get(ann, "style") || %{}
      color = color(style)
      paint = %{color: color, fill: fill_opacity(kind, style)}

      shape =
        kind
        |> shape_primitives(geometry, label_title(ann))
        |> Enum.map(&{&1, paint})

      label =
        ann
        |> satellite_label(kind, geometry, base)
        |> Enum.map(&{&1, %{color: title_color(ann, color), fill: nil}})

      shape ++ label
    end)
  end

  # ── fill ─────────────────────────────────────────────────────────────────

  # What the shape's BODY is painted with, mirroring `_applyFill` on the
  # canvas: a flat body at the shape's own colour, damped to 18% unless the
  # user asked for solid, and multiplied by the shape's opacity. `nil` means
  # outline only.
  #
  # Only the kinds the canvas lets you fill — a marker is a stroke and
  # nothing else, and a shaft (line, dimension, arrow) has no inside.
  #
  # "pattern" is the hatch, which is drawn live as a tile of diagonal lines.
  # It bakes as the flat semi body instead: at thumbnail scale a hatch is
  # finer than the pixels available to it, so it would read as a muddy tint
  # at best — and a tint is exactly what this draws.
  defp fill_opacity(kind, style) when kind in ["rectangle", "circle", "polygon", "freehand"] do
    case get(style, "fill") || "semi" do
      "none" ->
        nil

      mode ->
        opacity =
          case get(style, "opacity") do
            o when is_number(o) -> o
            _ -> 1
          end

        Float.round(if(mode == "solid", do: 1.0, else: 0.18) * opacity, 4)
    end
  end

  defp fill_opacity(_kind, _style), do: nil

  # ── kind → primitive(s) (mirrors the README geometry table) ──────────────

  # The label-bearing kinds render their TEXT when the annotation carries it
  # (`metadata.title` — the same field the live canvas reads). The old
  # behaviour drew the label's bounding box instead, which on a baked
  # thumbnail looked like a mystery rectangle where a word should be: the
  # box is the one part of a label the viewer was never meant to see live.
  # The box remains only as the no-title fallback, so a caller that doesn't
  # pass metadata still gets a mark where the label sits.
  defp shape_primitives("text", %{} = g, title) when is_binary(title) do
    case rect(g) do
      [{:rect, x, y, w, h}] -> [{:label, x, y, w, h, title}]
      other -> other
    end
  end

  # A titled callout mirrors the live composition: leader line from the
  # anchor to the box's bottom-left corner, underline along the box's bottom
  # edge, glyphs above it — and no box.
  defp shape_primitives("callout", g, title) when is_binary(title) do
    case rect(get(g, "text_box") || %{}) do
      [{:rect, x, y, w, h}] ->
        underline = {:line, x, y + h, x + w, y + h}
        label = {:label, x, y, w, h, title}

        case get(g, "anchor") do
          nil ->
            [underline, label]

          anchor ->
            {ax, ay} = pt(anchor)
            [{:line, num(ax), num(ay), x, y + h}, underline, label]
        end

      _ ->
        shape_primitives("callout", g)
    end
  end

  defp shape_primitives(kind, g, _title), do: shape_primitives(kind, g)

  defp shape_primitives("rectangle", %{} = g), do: rect(g)
  defp shape_primitives("text", %{} = g), do: rect(g)

  # Media bakes as its outline. The transport is live interface — a play
  # button and a scrub position in a flattened image would be a picture of a
  # control nobody can press, at whatever moment the exporter happened to be
  # at. Video frames aren't drawn either: they're in a DOM layer the server
  # has no access to, and picking one to stand for the whole clip would be an
  # invention.
  defp shape_primitives(k, %{} = g) when k in ["audio", "video"], do: rect(g)

  defp shape_primitives("circle", g),
    do: with_keys(g, ["cx", "cy", "r"], &[{:circle, &1, &2, &3}])

  defp shape_primitives("polygon", %{"points" => p}) when is_list(p), do: poly(:polygon, p)

  # A stroke with no length is a dot — a click with a pen in hand, which is
  # how the dot under a question mark or on an i gets drawn. It cannot bake
  # as a polyline: ImageMagick refuses a degenerate one outright ("non-
  # conforming drawing primitive"), and an SVG one paints only under a round
  # cap. Both back ends draw a disc instead, sized from the stroke width at
  # render time — which is what the canvas paints too, by rounding the cap
  # of a stroke that goes nowhere.
  defp shape_primitives(k, g) when k in ["freehand", "marker"] do
    case stroke_points(g) do
      [] ->
        []

      points ->
        if dot?(points) do
          {x, y} = pt(hd(points))
          [{:dot, x, y}]
        else
          poly(:polyline, points)
        end
    end
  end

  defp shape_primitives("line", g), do: ab_line(g)

  # A dimension is a measurement, and what makes it read as one rather than
  # as a plain rule is the pair of V-heads facing outward at its ends — the
  # same arrowheads the canvas draws, one per endpoint, each opening back
  # toward the other end. Baked as a bare line it was indistinguishable from
  # `line`, which is what a thumbnail of one looked like.
  defp shape_primitives("dimension", g) do
    case ab_line(g) do
      [{:line, x1, y1, x2, y2} = shaft] ->
        [shaft] ++ arrow_head([{x2, y2}, {x1, y1}]) ++ arrow_head([{x1, y1}, {x2, y2}])

      other ->
        other
    end
  end

  # A connector is the routed path (`a`, any bends the user dropped in
  # `points`, then `b`) plus the V at its head. Every coordinate is written
  # into the geometry each time the canvas draws it, so baking one needs no
  # knowledge of what it's bound to.
  defp shape_primitives("arrow", g) do
    case arrow_path(g) do
      [] -> []
      [_single] -> []
      path -> [{:polyline, path}] ++ arrow_head(path)
    end
  end

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

  # Every point a connector is drawn through: tail, bends, head. Mirrors the
  # canvas's `_arrowPath`; an arrow saved before waypoints existed has no
  # `points` key and reads as the plain two-point case.
  defp arrow_path(g) do
    case {get(g, "a"), get(g, "b")} do
      {a, b} when not is_nil(a) and not is_nil(b) ->
        bends = get(g, "points") || []
        Enum.map([a | bends] ++ [b], &pt/1) |> Enum.map(fn {x, y} -> {num(x), num(y)} end)

      _ ->
        []
    end
  end

  # The V at an arrow's head: tip at the last point, wings opening back along
  # the LAST segment — on a routed arrow that differs from the tail-to-head
  # chord, and it's the final approach that has to line up with whatever the
  # arrow points at.
  #
  # Sized in image px here rather than the canvas's screen px — there is no
  # zoom to correct for in a baked image — so it stays proportional to the
  # arrow instead of vanishing on a long one.
  defp arrow_head(path) do
    {bx, by} = List.last(path)
    {ax, ay} = Enum.at(path, length(path) - 2)
    dx = ax - bx
    dy = ay - by

    case :math.sqrt(dx * dx + dy * dy) do
      len when len > 0 ->
        ux = dx / len
        uy = dy / len
        head = min(@arrow_head_len, len / 2)
        half = head * @arrow_head_ratio
        basex = bx + ux * head
        basey = by + uy * head

        [
          {:polyline,
           [
             {basex - uy * half, basey + ux * half},
             {bx, by},
             {basex + uy * half, basey - ux * half}
           ]}
        ]

      _ ->
        []
    end
  end

  # Half the stroke's width — the disc a round cap paints on a stroke that
  # goes nowhere, which is what the canvas shows for the same click.
  defp dot_radius(sw) do
    case sw do
      n when is_number(n) -> max(n / 2, 0.5)
      s when is_binary(s) -> max(String.to_float(s <> ".0") / 2, 0.5)
      _ -> 1.0
    end
  end

  # Under a tenth of a pixel across: a click's stroke carries a hundredth,
  # and nothing a hand draws lands that small.
  @dot_extent 0.1

  defp dot?(points) do
    {xs, ys} = points |> Enum.map(&pt/1) |> Enum.unzip()

    Enum.max(xs) - Enum.min(xs) <= @dot_extent and
      Enum.max(ys) - Enum.min(ys) <= @dot_extent
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

  defp im_draw({:polyline, points}),
    # Round caps and joins, as the canvas draws every stroke — without them
    # a baked stroke ends square and corners spike, which is visible the
    # moment a baked thumbnail sits beside the drawing it came from.
    do: "stroke-linecap round stroke-linejoin round polyline " <> points_str(points)

  defp im_draw({:line, x1, y1, x2, y2}), do: "line #{x1},#{y1} #{x2},#{y2}"

  defp points_str(points), do: Enum.map_join(points, " ", fn {x, y} -> "#{x},#{y}" end)

  # ── primitive → SVG element ──────────────────────────────────────────────

  defp svg_element({:rect, x, y, w, h}, paint, sw),
    do: ~s(<rect x="#{x}" y="#{y}" width="#{w}" height="#{h}" #{paint(paint, sw)}/>)

  defp svg_element({:circle, cx, cy, r}, paint, sw),
    do: ~s(<circle cx="#{cx}" cy="#{cy}" r="#{r}" #{paint(paint, sw)}/>)

  defp svg_element({:polygon, points}, paint, sw),
    do: ~s(<polygon points="#{svg_points(points)}" #{paint(paint, sw)}/>)

  defp svg_element({:polyline, points}, paint, sw),
    do: ~s(<polyline points="#{svg_points(points)}" #{paint(paint, sw)}/>)

  defp svg_element({:dot, x, y}, %{color: color}, sw),
    do: ~s(<circle cx="#{x}" cy="#{y}" r="#{dot_radius(sw)}" fill="#{color}" stroke="none"/>)

  defp svg_element({:line, x1, y1, x2, y2}, paint, sw),
    do: ~s(<line x1="#{x1}" y1="#{y1}" x2="#{x2}" y2="#{y2}" #{paint(paint, sw)}/>)

  defp svg_element({:label, x, y, _w, h, text}, %{color: color}, _sw) do
    ~s(<text x="#{x + label_pad(h)}" y="#{y + label_baseline(h)}") <>
      ~s( font-size="#{label_font_size(h)}") <>
      ~s( font-family="ui-sans-serif, system-ui, sans-serif" font-weight="500") <>
      ~s( fill="#{color}" stroke="none">#{svg_escape(text)}</text>)
  end

  defp svg_points(points), do: Enum.map_join(points, " ", fn {x, y} -> "#{x},#{y}" end)

  defp paint(%{color: color, fill: nil}, sw), do: ~s(fill="none" #{stroke(color, sw)})

  defp paint(%{color: color, fill: opacity}, sw),
    do: ~s(fill="#{color}" fill-opacity="#{opacity}" #{stroke(color, sw)})

  defp stroke(color, sw), do: ~s(stroke="#{color}" stroke-width="#{sw}")

  # ── the label every shape can carry ──────────────────────────────────────

  # `text` and `callout` ARE their text — those are drawn by
  # `shape_primitives/3` from their own geometry. Every other kind carries
  # its label as a satellite the canvas positions for it, and baking skipped
  # them entirely: a board of named rectangles came out as a board of
  # anonymous rectangles, and a dimension lost the measurement that is the
  # whole reason it exists.
  #
  # The three placements below are the canvas's, in its order of precedence
  # (`_shapeTitleBoxImage`).
  defp satellite_label(ann, kind, g, base) do
    title = label_title(ann)
    meta = get(ann, "metadata") || %{}

    if title && kind not in ["text", "callout"] do
      case label_box(kind, g, meta, base, title, label_font_px(ann, base)) do
        {x, y, w, h} -> [{:label, num(x), num(y), num(w), num(h), title}]
        nil -> []
      end
    else
      []
    end
  end

  # The font a label is drawn at, in image px: a pinned `style.font_size`
  # (stored canvas-relative, like every other ink measure) or the canvas's
  # own default, scaled onto this image. The box is then sized to produce
  # exactly that font back through `label_font_size/1`, so the glyphs come
  # out at the size the live canvas would draw them.
  defp label_font_px(ann, base) do
    case get(get(ann, "style") || %{}, "font_size") do
      fs when is_number(fs) and fs > 0 -> fs * base / @default_label_font
      _ -> base
    end
  end

  defp label_box(kind, g, meta, base, title, fs) do
    {w, h} =
      case get(meta, "title_box") do
        %{} = box ->
          case {get(box, "w"), get(box, "h")} do
            {bw, bh} when is_number(bw) and is_number(bh) -> {bw, bh}
            _ -> default_label_size(fs, title)
          end

        _ ->
          default_label_size(fs, title)
      end

    cond do
      # A shaft-riding label is magnetic to its line: centred on the point
      # `title_offset` along it (the middle by default), never on the box's
      # own stored position.
      kind in ["dimension", "arrow"] ->
        case shaft_point(kind, g, shaft_offset(meta)) do
          {px, py} -> {px - w / 2, py - h / 2, w, h}
          nil -> nil
        end

      align = normalize_align(get(meta, "title_align")) ->
        case bbox(kind, g) do
          {bx, by, bw, bh} -> aligned_box({bx, by, bw, bh}, {w, h}, align)
          nil -> nil
        end

      match?(%{}, get(meta, "title_box")) ->
        box = get(meta, "title_box")

        case {get(box, "x"), get(box, "y")} do
          {bx, by} when is_number(bx) and is_number(by) -> {bx, by, w, h}
          _ -> nil
        end

      true ->
        # The float-above default: centred over the shape's top edge.
        case bbox(kind, g) do
          {bx, by, bw, _bh} -> {bx + bw / 2 - w / 2, by - h - base, w, h}
          nil -> nil
        end
    end
  end

  # Wide enough for the glyphs at this size — the server cannot measure a
  # font, and 0.6em per character is the usual approximation for a
  # proportional face. Height is set so `label_font_size/1` reads the font
  # back out of it exactly.
  defp default_label_size(fs, title) do
    {max(fs * 0.6 * String.length(title), fs * 2), fs / 0.65}
  end

  defp shaft_offset(meta) do
    case get(meta, "title_offset") do
      t when is_number(t) -> min(max(t, 0), 1)
      _ -> 0.5
    end
  end

  # The point a fraction `t` along the drawn path — the routed one for an
  # arrow, so a label on a bent connector sits on the line rather than on
  # the chord between its ends.
  defp shaft_point(kind, g, t) do
    path = if kind == "arrow", do: arrow_path(g), else: ab_points(g)

    case path do
      [] -> nil
      [only] -> only
      pts -> walk(pts, t)
    end
  end

  defp ab_points(g) do
    case ab_line(g) do
      [{:line, x1, y1, x2, y2}] -> [{x1, y1}, {x2, y2}]
      _ -> []
    end
  end

  defp walk(pts, t) do
    segs =
      pts
      |> Enum.chunk_every(2, 1, :discard)
      |> Enum.map(fn [{x1, y1} = a, {x2, y2} = b] ->
        {a, b, :math.sqrt(:math.pow(x2 - x1, 2) + :math.pow(y2 - y1, 2))}
      end)

    total = Enum.reduce(segs, 0.0, fn {_, _, len}, acc -> acc + len end)

    if total <= 0 do
      hd(pts)
    else
      target = total * t

      Enum.reduce_while(segs, 0.0, fn {{x1, y1}, {x2, y2}, len}, walked ->
        if walked + len >= target or len == 0 do
          f = if len > 0, do: (target - walked) / len, else: 0.0
          {:halt, {x1 + (x2 - x1) * f, y1 + (y2 - y1) * f}}
        else
          {:cont, walked + len}
        end
      end)
      |> case do
        {_, _} = point -> point
        _ -> List.last(pts)
      end
    end
  end

  # `%{"h" => "left"|"center"|"right", "v" => "top"|"middle"|"bottom"}`,
  # the same shape `normalizeTitleAlign` accepts on the canvas.
  defp normalize_align(%{} = align) do
    h = get(align, "h")
    v = get(align, "v")

    if h in ["left", "center", "right"] and v in ["top", "middle", "bottom"] do
      {h, v}
    else
      nil
    end
  end

  defp normalize_align(_), do: nil

  defp aligned_box({bx, by, bw, bh}, {w, h}, {ah, av}) do
    x =
      case ah do
        "left" -> bx
        "right" -> bx + bw - w
        _ -> bx + bw / 2 - w / 2
      end

    y =
      case av do
        "top" -> by
        "bottom" -> by + bh - h
        _ -> by + bh / 2 - h / 2
      end

    {x, y, w, h}
  end

  # The box a shape occupies, for the label placements that need one.
  defp bbox("rectangle", g), do: xywh(g)
  defp bbox(k, g) when k in ["text", "audio", "video", "image"], do: xywh(g)

  defp bbox("circle", g) do
    case {get(g, "cx"), get(g, "cy"), get(g, "r")} do
      {cx, cy, r} when is_number(cx) and is_number(cy) and is_number(r) ->
        {cx - r, cy - r, r * 2, r * 2}

      _ ->
        nil
    end
  end

  defp bbox("polygon", %{"points" => pts}) when is_list(pts),
    do: points_bbox(Enum.map(pts, &pt/1))

  defp bbox(k, g) when k in ["freehand", "marker"],
    do: points_bbox(stroke_points(g) |> Enum.map(&pt/1))

  defp bbox("arrow", g), do: points_bbox(arrow_path(g))
  defp bbox(k, g) when k in ["line", "dimension"], do: points_bbox(ab_points(g))
  defp bbox(_kind, _g), do: nil

  defp xywh(g) do
    case {get(g, "x"), get(g, "y"), get(g, "w"), get(g, "h")} do
      {x, y, w, h} when is_number(x) and is_number(y) and is_number(w) and is_number(h) ->
        {x, y, w, h}

      _ ->
        nil
    end
  end

  defp points_bbox([]), do: nil

  defp points_bbox(pts) do
    xs = Enum.map(pts, &elem(&1, 0))
    ys = Enum.map(pts, &elem(&1, 1))
    {Enum.min(xs), Enum.min(ys), Enum.max(xs) - Enum.min(xs), Enum.max(ys) - Enum.min(ys)}
  end

  # A label's own colour when it has one, else the shape's — the same
  # resolution `_titleColorFor` does, which is what makes a red dimension's
  # measurement red.
  defp title_color(ann, shape_color) do
    case get(get(ann, "metadata") || %{}, "title_color") do
      c when is_binary(c) and c != "" -> c
      _ -> shape_color
    end
  end

  # Label sizes are stored against a reference canvas, exactly like ink
  # weights, so a label reads the same size relative to the picture whatever
  # the picture's resolution. Without the canvas dimensions there is nothing
  # to scale against and the stored number is used as-is.
  defp label_base(opts) do
    w = Keyword.get(opts, :canvas_width) || Keyword.get(opts, :width)
    h = Keyword.get(opts, :canvas_height) || Keyword.get(opts, :height)

    case {w, h} do
      {w, h} when is_number(w) and is_number(h) and (w > 0 or h > 0) ->
        @default_label_font * max(w, h) / @reference_canvas_px

      _ ->
        @default_label_font
    end
  end

  # ── label helpers ────────────────────────────────────────────────────────

  # The live canvas draws the label font at 65% of the box height, the first
  # baseline about 75% down, and pads the left edge by 13% — the same ratios
  # here keep a baked label sitting where the live one did. The floor stops a
  # sub-pixel box from producing unreadable (or zero) sizes.
  defp label_font_size(h), do: max(round(h * 0.65), 8)
  defp label_baseline(h), do: round(h * 0.75)
  defp label_pad(h), do: round(h * 0.13)

  # `metadata.title`, normalised to a single drawable line — server backends
  # here don't wrap, and a thumbnail-scale label reads fine on one line.
  # Blank/absent titles answer nil so the caller falls back to the box.
  defp label_title(ann) do
    with t when is_binary(t) <- get(get(ann, "metadata") || %{}, "title") || get(ann, "title"),
         t = t |> String.replace(~r/\s+/u, " ") |> String.trim(),
         false <- t == "" do
      t
    else
      _ -> nil
    end
  end

  # ImageMagick `-draw "text .. '...'"` string: backslashes and single
  # quotes are the two characters that can escape the quoted argument.
  defp im_escape(text) do
    text
    |> String.replace("\\", "\\\\")
    |> String.replace("'", "\\'")
  end

  defp svg_escape(text) do
    text
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
  end

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
