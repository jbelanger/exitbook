# Links Command — Ink Migration

## Scope

Migrate the `links` family to consistent terminal surfaces, following the same visual language established by the ingestion dashboard (import/reprocess).

Current phase-0 semantics:

- `links view` is the proposal-review explorer
- `links view --gaps` is the canonical coverage-gap explorer
- `links gaps` remains as a compatibility alias during migration

## Subcommands

| Command              | Spec                                                           | Nature                                      | Ink Complexity                              |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `links run`          | [links-run-spec.md](./links-run-spec.md)                       | Operation tree (sequential phases)          | Low — static renders between phases         |
| `links view`         | [links-view-spec.md](./links-view-spec.md)                     | Interactive TUI for proposal review         | High — keyboard input, scrolling, mutations |
| `links view --gaps`  | [links-view-spec.md](./links-view-spec.md)                     | Interactive TUI for coverage-gap diagnosis  | High — same explorer with a read-only lens  |
| `links gaps`         | [links-view-spec.md](./links-view-spec.md)                     | Compatibility alias for `links view --gaps` | None beyond the shared explorer             |
| `links confirm <id>` | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Single-line result                          | Minimal — render once + unmount             |
| `links reject <id>`  | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Single-line result                          | Minimal — render once + unmount             |

## Implementation Order

1. **`links confirm` / `links reject`** — smallest scope, establishes the Ink render pattern for simple commands
2. **`links run`** — operation tree pattern, handler enrichment (existing link counts)
3. **`links view` / `links view --gaps`** — interactive explorer, most complex

## Shared Utilities

Extract from the ingestion dashboard into `ui/shared/`:

- `formatDuration(ms)` — time formatting (`123ms`, `12.3s`, `2m 15s`)
- `StatusIcon` — `✓` / `⠋` / `⚠` component with colors
- `TreeChars` — `├─` / `└─` constants
- Color tier conventions (signal / content / context)

These become the foundation for all Ink-based command UIs going forward.

## Design Principles

- **JSON mode always bypasses TUI** — `--json` produces structured output for scripting
- **Same color language** — three-tier hierarchy (signal/content/context) across all commands
- **Confirm/reject stay as standalone commands** — TUI provides faster triage, but CLI commands remain for scripting and automation
- **No @clack/prompts in Ink renders** — prompts happen before Ink takes over (links run interactive mode)
- **`gaps` is a lens, not a status** — coverage analysis stays distinct from the link proposal lifecycle
