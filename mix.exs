defmodule Etcher.MixProject do
  use Mix.Project

  @version "0.4.1"
  @description "Annotation overlay for Fresco viewers in Phoenix. Draw shapes on `<Fresco.canvas>` and `<Fresco.scroll_strip>`; annotations live inside the host's extensions map and travel with the .fresco file (canvas) or the strip's serialized state."
  @source_url "https://github.com/alexdont/etcher"

  def project do
    [
      app: :etcher,
      version: @version,
      description: @description,
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      package: package(),
      docs: docs()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:fresco, "~> 0.5.4"},
      {:phoenix_live_view, "~> 1.1"},
      {:phoenix_html, "~> 4.0"},
      {:jason, "~> 1.4"},
      {:ex_doc, "~> 0.39", only: :dev, runtime: false}
    ]
  end

  defp package do
    [
      name: "etcher",
      maintainers: ["Alexander Don"],
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ~w(lib priv mix.exs README.md LICENSE CHANGELOG.md)
    ]
  end

  defp docs do
    [
      name: "Etcher",
      source_ref: "v#{@version}",
      source_url: @source_url,
      main: "Etcher",
      extras: ["README.md", "CHANGELOG.md", "LICENSE"]
    ]
  end
end
