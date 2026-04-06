# Providers CLI Spec

## Scope

This document defines the `providers` browse family:

- `exitbook providers`
- `exitbook providers list`
- `exitbook providers view <selector>`
- `exitbook providers explore [<selector>]`

It specializes the browse rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- `providers benchmark`
- provider registration changes
- any workflow command

## Family Model

`providers` is a read-only catalog and health surface for configured blockchain API providers.

Rules:

- browse commands never benchmark providers or send live probe traffic
- browse data comes from the provider registry, local explorer overrides, persisted provider stats, and local API-key configuration state
- `providers benchmark` remains a separate workflow command
- `--json` is the only generic output override

## Command Surface

| Shape                          | Meaning                                     | Human surface      |
| ------------------------------ | ------------------------------------------- | ------------------ |
| `providers`                    | Quick browse of registered providers        | Static list        |
| `providers list`               | Explicit alias of the same static list      | Static list        |
| `providers view <selector>`    | Focused inspection of one provider          | Static detail card |
| `providers explore`            | Full provider explorer                      | TUI explorer       |
| `providers explore <selector>` | Explorer pre-selected on one provider       | TUI explorer       |
| Any of the above + `--json`    | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `providers explore` falls back to the same static list as `providers`
- `providers explore <selector>` falls back to the same static detail as `providers view <selector>`

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
- bare root selectors are invalid; callers must use `view <selector>` or `explore <selector>`

### Browse options

Supported browse options:

- `--blockchain <name>`: filter by blockchain served by the provider
- `--health <status>`: filter by provider health (`healthy`, `degraded`, `unhealthy`)
- `--missing-api-key`: include only providers requiring API keys that are currently missing
- `--json`: output JSON

## Shared Data Semantics

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

Health is derived from persisted provider stats.

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

Readiness is local configuration state.

States:

- `configured`
- `missing`
- `no key needed`

## Browse Surfaces

### Static List

Applies to:

- `exitbook providers`
- `exitbook providers list`
- `exitbook providers explore` off-TTY

Header:

```text
Providers{optional filter label} {total} total · {health counts...} · {apiKeyCount} require API key
```

Table columns:

- `NAME`
- `CHAINS`
- `HEALTH`
- `AVG RESP`
- `ERR RATE`
- `TOTAL REQS`
- `API KEY`

Rules:

- filter labels combine active filters in the order `blockchain`, `health`, `missing API key`
- API-key wording stays concise and user-facing
- static output never shows controls, selected-row chrome, or side-by-side detail

### Static Detail

Applies to:

- `exitbook providers view <selector>`
- `exitbook providers explore <selector>` off-TTY

Title line:

```text
{displayName} {health}
```

Body order:

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
- API-key wording stays user-facing: `{ENV_VAR} configured`, `{ENV_VAR} missing`, `no key needed`

### Explorer

Applies to:

- `exitbook providers explore`
- `exitbook providers explore <selector>`

The explorer is a master-detail Ink app over the same provider catalog and persisted health data.

Rules:

- `explore <selector>` preselects the requested provider
- filtered-empty explorer states stay in the explorer
- a truly empty unfiltered collection may collapse to the static empty state
- explorer detail may truncate for height, but the static detail card must remain complete

## JSON Contract

- `providers --json`, `providers list --json`, and `providers explore --json` return the same list payload
- `providers view <selector> --json` and `providers explore <selector> --json` return the same detail payload

List payload:

```json
{
  "providers": [
    {
      "name": "alchemy",
      "displayName": "Alchemy",
      "chainCount": 1,
      "healthStatus": "healthy",
      "apiKeyStatus": "configured"
    }
  ]
}
```

Detail payload extends the list item with:

- `blockchains[]`
- optional `apiKeyEnvName`
- optional `lastError`
- optional `lastErrorTime`

## Acceptance Notes

- `view` is always static detail, never the explorer
- `explore` is always the explorer verb
- root and `list` stay equivalent for static list output
- selector resolution must not diverge between `view` and `explore`
