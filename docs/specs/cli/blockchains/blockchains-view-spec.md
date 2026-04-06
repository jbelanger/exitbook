# Blockchains CLI Spec

## Scope

This document defines the `blockchains` browse family:

- `exitbook blockchains`
- `exitbook blockchains list`
- `exitbook blockchains view <selector>`
- `exitbook blockchains explore [<selector>]`

It specializes the browse rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- provider benchmarking
- account creation flows
- any workflow command

## Family Model

`blockchains` is a read-only catalog of supported chains and their registered provider coverage.

Rules:

- browse commands never call live blockchain providers
- browse data comes from the registered blockchain catalog, registered providers, and local API-key configuration state
- `--json` is the only generic output override

## Command Surface

| Shape                            | Meaning                                     | Human surface      |
| -------------------------------- | ------------------------------------------- | ------------------ |
| `blockchains`                    | Quick browse of supported blockchains       | Static list        |
| `blockchains list`               | Explicit alias of the same static list      | Static list        |
| `blockchains view <selector>`    | Focused inspection of one blockchain        | Static detail card |
| `blockchains explore`            | Full blockchain explorer                    | TUI explorer       |
| `blockchains explore <selector>` | Explorer pre-selected on one blockchain     | TUI explorer       |
| Any of the above + `--json`      | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `blockchains explore` falls back to the same static list as `blockchains`
- `blockchains explore <selector>` falls back to the same static detail as `blockchains view <selector>`

## Selectors And Options

### Selector

`<selector>` is the blockchain key.

Examples:

- `bitcoin`
- `ethereum`
- `injective`

Rules:

- selector resolution is exact and case-insensitive on the blockchain key
- selectors cannot be combined with `--category`
- selectors cannot be combined with `--requires-api-key`
- selector misses fail with `Blockchain selector '<value>' not found`
- bare root selectors are invalid; callers must use `view <selector>` or `explore <selector>`

### Browse options

Supported browse options:

- `--category <name>`: filter by blockchain category
- `--requires-api-key`: include only blockchains whose provider set requires API-key configuration
- `--json`: output JSON

## Shared Data Semantics

Each blockchain item includes:

- blockchain key
- display name
- category
- optional layer label
- provider count
- API-key readiness summary
- example address placeholder

### API-Key Readiness

Readiness is summary data derived from registered providers for a blockchain.

States:

- `all configured`
- `{N} missing`
- `none needed`

Rules:

- readiness is local configuration state, not live provider health
- `--requires-api-key` includes blockchains with at least one required key, even if some optional no-key providers also exist
- the detail surface still shows providers that do not require keys

## Browse Surfaces

### Static List

Applies to:

- `exitbook blockchains`
- `exitbook blockchains list`
- `exitbook blockchains explore` off-TTY

Header:

```text
Blockchains{optional filter label} {total} total · {category counts...} · {providerCount} providers
```

Table columns:

- `NAME`
- `KEY`
- `CATEGORY`
- `LAYER`
- `PROVIDERS`
- `API KEYS`

Rules:

- category counts omit zeros
- category counts are omitted when already filtered to one category
- readiness wording stays concise and user-facing
- static output never shows controls, selected-row chrome, or side-by-side detail

### Static Detail

Applies to:

- `exitbook blockchains view <selector>`
- `exitbook blockchains explore <selector>` off-TTY

Title line:

```text
{displayName} {key} {category} {layer?}
```

Body order:

1. `Key`
2. `Category`
3. optional `Layer`
4. `Providers`
5. `API keys`
6. `Example address`
7. `Providers` section

Rules:

- provider rows are not artificially capped
- provider rows show name, API-key requirement, capabilities, and configured rate-limit summary when known
- detail copy stays user-facing and avoids implementation terms

### Explorer

Applies to:

- `exitbook blockchains explore`
- `exitbook blockchains explore <selector>`

The explorer is a master-detail Ink app over the same catalog data.

Rules:

- `explore <selector>` preselects the requested blockchain
- filtered-empty explorer states stay in the explorer
- a truly empty unfiltered collection may collapse to the static empty state
- explorer detail may truncate for height, but the static detail card must remain complete

## JSON Contract

- `blockchains --json`, `blockchains list --json`, and `blockchains explore --json` return the same list payload
- `blockchains view <selector> --json` and `blockchains explore <selector> --json` return the same detail payload

List payload:

```json
{
  "blockchains": [
    {
      "name": "ethereum",
      "displayName": "Ethereum",
      "category": "evm",
      "layer": "L1",
      "providerCount": 2,
      "keyStatus": "all-configured"
    }
  ]
}
```

Detail payload extends the list item with:

- `exampleAddress`
- `providers[]`

## Acceptance Notes

- `view` is always static detail, never the explorer
- `explore` is always the explorer verb
- root and `list` stay equivalent for static list output
- selector resolution must not diverge between `view` and `explore`
