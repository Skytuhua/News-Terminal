# Backend verification

Backend tests exercise real SQLite storage; feed transport and provider fixtures are documented separately. Production starts with no fabricated articles. All timestamps in fixtures are synthetic.

## Vertical test-first record

- Initial defaults: test `fresh_database_has_contract_defaults_and_no_demo_articles` exists before implementation; first MSVC build pending dependency compilation. The initial `Database::request` returns `not implemented`.

## Data design

SQLite is the authoritative host store. Profiles, source catalog, article metadata and revisions, profile article state, watchlists, workspace, provider metadata and alert receipts persist. Keys are excluded from SQLite and exports. SQLite FTS5 indexes only cached title/excerpt. Native bounds are managed by the native window module. Profile visits use a session-held marker to keep previous-visit catch-up stable. Workspace revision rejects stale whole-workspace updates from concurrent windows.
