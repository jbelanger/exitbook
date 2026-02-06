# Links Command — Ink Migration

## Scope

Migrate all four `links` subcommands from console.log/spinner output to Ink-based UIs, following the same visual language established by the ingestion dashboard (import/reprocess).

## Subcommands

| Command              | Spec                                                           | Nature                              | Ink Complexity                              |
| -------------------- | -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| `links run`          | [links-run-spec.md](./links-run-spec.md)                       | Operation tree (sequential phases)  | Low — static renders between phases         |
| `links view`         | [links-view-spec.md](./links-view-spec.md)                     | Interactive TUI (navigate + triage) | High — keyboard input, scrolling, mutations |
| `links confirm <id>` | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Single-line result                  | Minimal — render once + unmount             |
| `links reject <id>`  | [links-confirm-reject-spec.md](./links-confirm-reject-spec.md) | Single-line result                  | Minimal — render once + unmount             |

## Implementation Order

1. **`links confirm` / `links reject`** — smallest scope, establishes the Ink render pattern for simple commands
2. **`links run`** — operation tree pattern, handler enrichment (existing link counts)
3. **`links view`** — interactive TUI, most complex

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
