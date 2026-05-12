# Changelog

All notable changes to **Etcher** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-05-06

Initial release.

### Added

- `Etcher.Layer` Phoenix LiveView function component — attaches an
  annotation overlay to a named Fresco viewer and adds a pencil button
  to its nav column.
- `Etcher.Storage` behaviour — pluggable storage adapter contract with
  four callbacks (`create/1`, `list_for/2`, `update/2`, `delete/1`).
- `Etcher.Storage.Default` — bundled implementation backed by the
  `etcher_annotations` table. Reads the consumer's Repo from
  `config :etcher, repo: …`.
- `Etcher.Annotation` Ecto schema for the bundled table (UUIDv7 primary
  key, `target_type` / `target_uuid`, four geometry kinds: rectangle,
  circle, polygon, freehand).
- `mix etcher.gen.migration` — generates the `etcher_annotations` table
  migration into the consumer's `priv/repo/migrations/`.
- JS engine at `priv/static/etcher.js` — registers the `EtcherLayer`
  LiveView hook, draws shapes as SVG overlays anchored to image
  coordinates, emits `etcher:created` / `:updated` / `:deleted` /
  `:selected` events.
- Bottom drawing toolbar with rectangle / circle / polygon / freehand
  tools; pencil-button toggle integrated with Fresco's nav column via
  `handle.appendNavButton/3` (Fresco 0.2+).

[0.1.0]: https://github.com/alexdont/etcher/releases/tag/v0.1.0
