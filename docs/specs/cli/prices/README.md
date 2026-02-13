# Prices Command — Ink Migration

## Scope

Migrate the `prices` namespace to Ink-based UIs, following the same visual language established by the ingestion dashboard and links commands.

## Concept Mapping (Links → Prices)

| Links Concept          | Prices Parallel                | Notes                                     |
| ---------------------- | ------------------------------ | ----------------------------------------- |
| `links run`            | `prices enrich`                | Operation tree with sequential phases     |
| `links view` (links)   | `prices view` (coverage)       | Asset-level table, read-only detail panel |
| `links view` (gaps)    | `prices view --missing-only`   | Movement-level list with inline set-price |
| `links confirm/reject` | `prices set` / `prices set-fx` | Stay as-is — simple one-shot CLI commands |

## Subcommands

| Command         | Spec                                             | Nature                                           | Ink Complexity                                       |
| --------------- | ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `prices enrich` | [prices-enrich-spec.md](./prices-enrich-spec.md) | Operation tree (trade → FX → market → propagate) | Low — static renders between phases, live API footer |
| `prices view`   | [prices-view-spec.md](./prices-view-spec.md)     | Interactive TUI (navigate + set)                 | High — keyboard input, scrolling, inline action      |
| `prices set`    | _No spec needed_                                 | Single-line result                               | None — stays as-is                                   |
| `prices set-fx` | _No spec needed_                                 | Single-line result                               | None — stays as-is                                   |

## Workflow

The recommended workflow for resolving missing prices:

```
1. prices enrich                         # Run full pipeline (trade prices → FX rates → market prices → propagation)
2. prices view --missing-only            # See what's still missing, fix inline with 's' key
3. prices enrich                         # Re-run to propagate newly set prices
```

Key change from current behavior: `--on-missing prompt` is removed from `prices enrich`. Interactive price entry moves to `prices view --missing-only`, where the user has full context (asset, date, source, amount) and can triage systematically rather than being prompted mid-pipeline.

## Implementation Order

1. **`prices enrich`** — operation tree pattern, handler enrichment with progress callbacks
2. **`prices view`** — interactive TUI with coverage mode and missing mode

## Shared Utilities

Reuse from `ui/shared/` (established by links migration):

- `formatDuration(ms)` — time formatting
- `StatusIcon` — `✓` / `⠋` / `⚠` component with colors
- `TreeChars` — `├─` / `└─` constants
- Color tier conventions (signal / content / context)
- `ApiMetricsFooter` — shared API call summary table (used by import and enrich)

## Design Principles

- **JSON mode always bypasses TUI** — `--json` produces structured output for scripting
- **Same color language** — three-tier hierarchy (signal/content/context) across all commands
- **No @clack/prompts in Ink renders** — inline set-price uses Ink's own input handling
- **`prices set` / `prices set-fx` stay as standalone commands** — no Ink needed for simple one-shot operations
