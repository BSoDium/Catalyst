# Fixtures

`demo.json` is **placeholder test data**: made-up places, made-up text, made-up media. It exists for automated tests
(`@catalyst/published`, `apps/web`, `apps/api`, the browser checks that look places up by slug) and for an explicit
`pnpm dev:demo`. It is never the default anywhere, never real content and must never be deployed
(`CATALYST_CONTENT=demo` is for local use only).

To see the owner's real places locally use the preview instead (`pnpm export:preview` in the private repo, then
`pnpm dev`); see the content modes table in [docs/architecture.md](../../../docs/architecture.md). The slugs in this
file are referenced by scripts and tests: do not rename them.
