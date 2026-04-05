# Blockchains CLI Spec

## Scope

This document defines the `blockchains` command family:

- `exitbook blockchains`
- `exitbook blockchains <selector>`
- `exitbook blockchains view`
- `exitbook blockchains view <selector>`

It specializes the browse-ladder rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- provider benchmarking
- account creation flows
- any workflow command

## Family Model

The `blockchains` family is a read-only catalog surface for supported chains and their provider coverage.

Rules:

- browse commands never call live blockchain providers
- all data comes from the registered blockchain and provider catalog plus local API-key configuration state
- `--json` is the only generic output override

## Command Surface

### Browse shapes

| Shape                         | Meaning                                     | Human surface      |
| ----------------------------- | ------------------------------------------- | ------------------ |
| `blockchains`                 | Quick browse of supported blockchains       | Static list        |
| `blockchains <selector>`      | Focused inspection of one blockchain        | Static detail card |
| `blockchains view`            | Full blockchain explorer                    | TUI explorer       |
| `blockchains view <selector>` | Explorer pre-selected on one blockchain     | TUI explorer       |
| Any of the above + `--json`   | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `blockchains view` falls back to the same static list as `blockchains`
- `blockchains view <selector>` falls back to the same static detail as `blockchains <selector>`

`view` does not define a separate text schema or JSON schema.

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

### Browse options

Supported browse options:

- `--category <name>`: filter by blockchain category
- `--requires-api-key`: include only blockchains whose provider set requires API-key configuration
- `--json`: output JSON

## Shared Data Semantics

### Blockchain Summary

Each blockchain item includes:

- blockchain key
- display name
- category
- optional layer label
- provider count
- API-key readiness summary
- example address placeholder

### API-Key Readiness

API-key readiness is summary data derived from the registered providers for a blockchain.

States:

- `all-configured`: at least one provider requires an API key and all required keys are configured
- `some-missing`: at least one required provider key is missing
- `none-needed`: no provider for the blockchain requires an API key

Rules:

- readiness is local configuration state, not live provider health
- `requires-api-key` filter includes blockchains with at least one required key, even if some optional no-key providers also exist
- the detail surface still shows providers that do not require keys

## Browse Surfaces

### Static List Surface

Applies to:

- `exitbook blockchains`
- `exitbook blockchains view` off-TTY

#### Header

Format:

```text
Blockchains{optional filter label} {total} total · {category counts...} · {providerCount} providers
```

Rules:

- `Blockchains` is bold
- metadata is dim
- only non-zero category counts are shown
- category counts are omitted when the list is already filtered to one category
- filter label is `({category})` or `(requires API key)`
- no blank line before the header
- one blank line follows the header before the table or empty state

#### Table

Columns:

| Column      | Meaning                               |
| ----------- | ------------------------------------- |
| `NAME`      | Human-readable blockchain name        |
| `KEY`       | Canonical blockchain key              |
| `CATEGORY`  | Display category                      |
| `LAYER`     | Layer label when known; otherwise `—` |
| `PROVIDERS` | Number of registered providers        |
| `API KEYS`  | Compact readiness summary             |

Example:

```text
Blockchains 3 total · 1 evm · 1 utxo · 1 cosmos · 4 providers

NAME       KEY        CATEGORY  LAYER  PROVIDERS  API KEYS
Bitcoin    bitcoin    utxo      L1             1  none needed
Ethereum   ethereum   evm       L1             2  all configured
Injective  injective  cosmos    L1             1  1 missing
```

Rules:

- no controls footer
- no selected-row expansion
- no side-by-side detail panel
- readiness wording is concise and user-facing: `all configured`, `N missing`, `none needed`

#### Empty states

Unfiltered empty state:

```text
Blockchains 0 total

No blockchains found.
```

Filtered empty state:

```text
Blockchains (evm) 0 total · 0 providers

No blockchains found for category evm.
```

### Static Detail Surface

Applies to:

- `exitbook blockchains <selector>`
- `exitbook blockchains view <selector>` off-TTY

#### Title line

Format:

```text
{displayName} {key} {category} {layer?}
```

Where:

- `{displayName}` is bold
- `{key}` is dim
- `{category}` is cyan
- `{layer}` is dim and omitted when unknown

Example:

```text
Ethereum ethereum evm L1
```

#### Body

Field order:

1. `Key`
2. `Category`
3. optional `Layer`
4. `Providers`
5. `API keys`
6. `Example address`
7. `Providers` section

Example:

```text
Ethereum ethereum evm L1

Key: ethereum
Category: evm
Layer: L1
Providers: 2
API keys: all configured
Example address: 0x742d35Cc...

Providers
alchemy      balance · txs · tokens   5/sec   ALCHEMY_API_KEY configured
etherscan    balance · txs            5/sec   no key needed
```

Rules:

- provider rows are not artificially capped
- provider rows show provider display name, capabilities, rate limit when known, and API-key status
- API-key status wording is user-facing: `configured`, `missing`, `no key needed`

## Explorer Surface

Applies to:

- `exitbook blockchains view`
- `exitbook blockchains view <selector>`

The explorer is a master-detail Ink app with one list view and one detail panel.

### Explorer layout

The explorer renders:

1. a blank line
2. the shared header
3. a blank line
4. a selectable blockchain list
5. a divider
6. a fixed-height detail panel
7. a blank line
8. a controls bar

### Explorer rows

Each row contains:

- display name
- category
- optional layer
- provider count
- API-key readiness summary

Example:

```text
▸ Ethereum  evm  L1  2 providers  all configured
```

### Explorer detail panel

The detail panel uses the same underlying fields as the static detail card, but:

- prefixes the title with `▸`
- is height-limited
- may truncate the provider list
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

`blockchains view <selector>` opens the explorer pre-selected on the requested blockchain.

### Empty explorer behavior

Explorer empties follow the V3 rules:

- `blockchains view` with a truly empty unfiltered collection collapses to the static empty state
- filtered-empty explorer requests stay on the explorer code path instead of silently downgrading to static output
- selector misses fail before any renderer mounts

## JSON

JSON follows the same semantic target regardless of whether the command uses `view`.

- `blockchains --json` and `blockchains view --json` return the same list payload
- `blockchains <selector> --json` and `blockchains view <selector> --json` return the same detail payload

### List payload

Shape:

```json
{
  "data": {
    "blockchains": []
  },
  "meta": {
    "total": 3,
    "byCategory": {
      "evm": 1
    },
    "totalProviders": 4
  }
}
```

Rules:

- list items include summary data only
- provider arrays are not inlined in the list payload

### Detail payload

Shape:

```json
{
  "data": {
    "name": "ethereum",
    "displayName": "Ethereum",
    "category": "evm",
    "layer": "1",
    "providerCount": 2,
    "keyStatus": "all-configured",
    "missingKeyCount": 0,
    "exampleAddress": "0x742d35Cc...",
    "providers": [
      {
        "name": "alchemy",
        "displayName": "Alchemy",
        "requiresApiKey": true,
        "apiKeyEnvName": "ALCHEMY_API_KEY",
        "apiKeyConfigured": true,
        "capabilities": ["balance", "txs", "tokens"],
        "rateLimit": "5/sec"
      }
    ]
  }
}
```

Rules:

- detail JSON includes the full provider array
- undefined properties are omitted from serialized JSON

## Errors And Help

Expected browse-family errors:

- `Use bare "blockchains" instead of "blockchains list".`
- `Blockchain selector '<value>' not found`
- `Blockchain selector cannot be combined with --category or --requires-api-key`

Help copy should keep the family model explicit:

- bare `blockchains` is the quick static browse
- `blockchains <selector>` is the focused static detail
- `blockchains view` is the explorer
- `--json` preserves semantic shape rather than surface shape
