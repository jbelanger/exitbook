# Providers CLI Spec

## Scope

This document defines the browse surface for the `providers` command family:

- `exitbook providers`
- `exitbook providers <selector>`
- `exitbook providers view`
- `exitbook providers view <selector>`

It specializes the browse-ladder rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- `providers benchmark`
- provider registration changes
- any workflow command

## Family Model

The `providers` family is a read-only catalog and health surface for configured blockchain API providers.

Rules:

- browse commands never benchmark providers or send live probe traffic
- browse data comes from the provider registry, local explorer overrides, persisted provider stats, and local API-key configuration state
- `providers benchmark` remains a separate workflow command
- `--json` is the only generic output override

## Command Surface

### Browse shapes

| Shape                       | Meaning                                     | Human surface      |
| --------------------------- | ------------------------------------------- | ------------------ |
| `providers`                 | Quick browse of registered providers        | Static list        |
| `providers <selector>`      | Focused inspection of one provider          | Static detail card |
| `providers view`            | Full provider explorer                      | TUI explorer       |
| `providers view <selector>` | Explorer pre-selected on one provider       | TUI explorer       |
| Any of the above + `--json` | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `providers view` falls back to the same static list as `providers`
- `providers view <selector>` falls back to the same static detail as `providers <selector>`

`view` does not define a separate text schema or JSON schema.

## Selectors And Options

### Selector

`<selector>` is the provider name.

Examples:

- `alchemy`
- `blockstream.info`
- `helius`

Rules:

- selector resolution is exact and case-insensitive on the provider name
- selectors cannot be combined with `--blockchain`
- selectors cannot be combined with `--health`
- selectors cannot be combined with `--missing-api-key`
- selector misses fail with `Provider selector '<value>' not found`

### Browse options

Supported browse options:

- `--blockchain <name>`: filter by blockchain served by the provider
- `--health <status>`: filter by provider health (`healthy`, `degraded`, `unhealthy`)
- `--missing-api-key`: include only providers requiring API keys that are currently missing
- `--json`: output JSON

## Shared Data Semantics

### Provider Summary

Each provider item includes:

- provider name
- display name
- chain count
- health status
- aggregate request count
- aggregate error rate
- aggregate average response time
- API-key readiness summary
- top-level config source summary

### Health Status

Health status is derived from persisted provider stats.

States:

- `healthy`
- `degraded`
- `unhealthy`
- `no-stats`

Rules:

- health is based on persisted usage data, not live probing
- `no-stats` means the provider has no persisted request history
- `--health` does not accept `no-stats`

### API-Key Readiness

API-key readiness is local configuration state.

States:

- `configured`
- `missing`
- `no key needed`

Rules:

- readiness is derived from provider metadata plus local env configuration state
- `--missing-api-key` includes only providers that require an API key and are currently missing one

## Browse Surfaces

### Static List Surface

Applies to:

- `exitbook providers`
- `exitbook providers view` off-TTY

#### Header

Format:

```text
Providers{optional filter label} {total} total · {health counts...} · {apiKeyCount} require API key
```

Rules:

- `Providers` is bold
- metadata is dim
- only non-zero health counts are shown
- filter labels combine active filters in the order `blockchain`, `health`, `missing API key`
- no blank line before the header
- one blank line follows the header before the table or empty state

#### Table

Columns:

| Column       | Meaning                           |
| ------------ | --------------------------------- |
| `NAME`       | Canonical provider name           |
| `CHAINS`     | Number of served blockchains      |
| `HEALTH`     | Health summary                    |
| `AVG RESP`   | Aggregate average response time   |
| `ERR RATE`   | Aggregate error rate              |
| `TOTAL REQS` | Aggregate request count           |
| `API KEY`    | Compact API-key readiness summary |

Rules:

- no controls footer
- no selected-row expansion
- no side-by-side detail panel
- API-key wording is concise and user-facing: `configured`, `missing`, `—`

### Static Detail Surface

Applies to:

- `exitbook providers <selector>`
- `exitbook providers view <selector>` off-TTY

#### Title line

Format:

```text
{displayName} {health}
```

Where:

- `{displayName}` is bold
- `{health}` is colored by health status

#### Body

Field order:

1. `Name`
2. `Chains`
3. `Health`
4. `Total requests`
5. `Avg response`
6. `Error rate`
7. optional `Config`
8. `API key`
9. optional `Last error`
10. `Blockchains` section

Rules:

- provider rows are not artificially capped
- per-blockchain rows show blockchain name, capabilities, rate limit when known, request count, error rate, average response, and optional alert text
- API-key wording is user-facing: `{ENV_VAR} configured`, `{ENV_VAR} missing`, `no key needed`

## Explorer Surface

Applies to:

- `exitbook providers view`
- `exitbook providers view <selector>`

The explorer is a master-detail Ink app with one list view and one detail panel.

### Explorer detail panel

The detail panel uses the same underlying fields as the static detail card, but:

- prefixes the title with `▸`
- is height-limited
- may truncate the blockchain list
- shows an overflow line when more detail exists than can fit

### Explorer navigation

| Key               | Action            |
| ----------------- | ----------------- |
| `↑` / `k`         | Move up           |
| `↓` / `j`         | Move down         |
| `PgUp` / `Ctrl-U` | Page up           |
| `PgDn` / `Ctrl-D` | Page down         |
| `Home`            | Jump to first row |
| `End`             | Jump to last row  |
| `q` / `Esc`       | Quit              |

### Selector behavior

`providers view <selector>` opens the explorer pre-selected on the requested provider.

### Empty explorer behavior

Explorer empties follow the V3 rules:

- `providers view` with a truly empty unfiltered collection collapses to the static empty state
- filtered-empty explorer requests stay on the explorer code path instead of silently downgrading to static output
- selector misses fail before any renderer mounts

## JSON

JSON follows the same semantic target regardless of whether the command uses `view`.

- `providers --json` and `providers view --json` return the same list payload
- `providers <selector> --json` and `providers view <selector> --json` return the same detail payload

### List payload

Rules:

- list items include summary data only
- per-blockchain arrays are not inlined in the list payload

### Detail payload

Rules:

- detail JSON includes the full blockchain array
- undefined properties are omitted from serialized JSON

## Errors And Help

Expected browse-family errors:

- `Use bare "providers" instead of "providers list".`
- `Provider selector '<value>' not found`
- `Provider selector cannot be combined with --blockchain, --health, or --missing-api-key`

Help copy should keep the family model explicit:

- bare `providers` is the quick static browse
- `providers <selector>` is the focused static detail
- `providers view` is the explorer
- `--json` preserves semantic shape rather than surface shape
