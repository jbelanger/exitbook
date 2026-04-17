# Transactions CLI Spec

## Scope

This document defines the `transactions` family:

- `exitbook transactions`
- `exitbook transactions list`
- `exitbook transactions view <selector>`
- `exitbook transactions explore [<selector>]`

It specializes the browse rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- `transactions edit ...` mutation surfaces in [Transactions Edit CLI Spec](./transactions-edit-spec.md)
- `transactions export` browse-independent export contract

Those commands remain part of the family, but this spec focuses on the browse surfaces they support.

## Family Model

The `transactions` family is the processed-transaction inspection surface.

Rules:

- browse commands are read-only
- browse commands read processed transactions by default
- `transactions view <selector> --provider-data` may additionally read linked raw
  source rows for that selected transaction
- browse commands never call live providers
- browse commands may include excluded transactions because the family is an operator surface, not an accounting filter
- transaction identity is the persisted `txFingerprint`; numeric `id` is display metadata only

## Command Surface

### Browse shapes

| Shape                             | Meaning                                     | Human surface      |
| --------------------------------- | ------------------------------------------- | ------------------ |
| `transactions`                    | Quick browse of processed transactions      | Static list        |
| `transactions list`               | Explicit alias of the same static list      | Static list        |
| `transactions view <selector>`    | Focused inspection of one transaction       | Static detail card |
| `transactions explore`            | Full transaction explorer                   | TUI explorer       |
| `transactions explore <selector>` | Explorer pre-selected on one transaction    | TUI explorer       |
| Any of the above + `--json`       | Machine output for the same semantic target | JSON               |

On a non-interactive terminal:

- `transactions explore` falls back to a static list
- `transactions explore <selector>` falls back to the same static detail as `transactions view <selector>`

## Selectors And Options

### Selector

`<selector>` is a persisted transaction fingerprint prefix, shown in the list as `TX-REF`.

Examples:

- `a1b2c3d4e5`
- `61637d8a6e`

Rules:

- root `transactions <selector>` is invalid; callers must use `view <selector>` or `explore <selector>`
- selector resolution is prefix-based against `txFingerprint`
- selector misses fail clearly
- selectors cannot be combined with browse filters on `view`
- selectors cannot be combined with browse filters or `--limit` on `explore`

### Browse options

Shared browse options:

- `--platform <name>`: filter by exchange or blockchain platform
- `--asset <symbol>`: filter by asset symbol
- `--since <date>`: inclusive lower date bound
- `--until <date>`: inclusive upper date bound
- `--operation-type <type>`: filter by operation type
- `--no-price`: show only transactions missing full price coverage
- `--json`: output JSON

Detail-only option:

- `--provider-data`: include linked raw source rows, original `provider_data`, and stored `normalized_data`

Explorer-only option:

- `--limit <number>`: cap the visible list for `explore` list-mode outputs

Rules:

- `transactions` and `transactions list` do not accept `--limit`
- `--provider-data` requires a transaction selector
- `transactions view <selector>` is always detail-shaped, even with `--json`
- `transactions explore <selector>` is always selector-shaped, even when it falls back to static detail off-TTY

## Shared Data Semantics

### Data source

Browse data comes from processed transactions for the active profile.

Rules:

- browse commands never rebuild or reprocess transactions
- missing or invalid filter dates fail fast before loading the browse surface
- list and detail projection use the same processed-transaction source by
  default
- `transactions view <selector> --provider-data` enriches the detail projection
  with linked raw source rows from persisted lineage bindings
- only presentation changes between static, JSON, and TUI outputs unless an
  explicit detail-only enrichment flag is requested

### Filtering

Filters are applied in this order:

1. platform
2. `since`
3. `until`
4. asset participation
5. operation type
6. missing-price status

Rules:

- asset filtering matches either inflows or outflows
- `--no-price` includes `none` and `partial` price coverage
- empty filtered results are valid browse outcomes and do not fail

## Browse Surfaces

### Static List

Applies to:

- `exitbook transactions`
- `exitbook transactions list`
- `exitbook transactions explore` off-TTY

Header:

```text
Transactions {(filters)} {total} total · {trade} trade · {transfer} transfer · {staking} staking · {other} other
```

Table columns:

- `TX-REF`
- `DATE`
- `PLATFORM`
- `OPERATION`
- `DEBIT`
- `CREDIT`
- `FEES`
- `FLAGS`

Rules:

- `DEBIT` is a compact summary of balance debits from outflow `grossAmount`
- `CREDIT` is a compact summary of balance credits from inflow `grossAmount`
- `FEES` is a compact summary of additional fee debits where `fee.settlement !== 'on-chain'`
- each summary entry formats as `{amount} {asset}`
- repeated assets on the same summary side are aggregated into one entry
- multi-asset summaries join entries with `+` in first-seen order
- empty summaries render as `—`
- `on-chain` fees do not appear in `FEES` because they are already embedded in the debited movement amount
- category counts only render for non-zero categories
- static list never renders controls, selected-row chrome, or a detail panel
- the unfiltered empty state points users at `exitbook import --help`

### Static Detail

Applies to:

- `exitbook transactions view <selector>`
- `exitbook transactions explore <selector>` off-TTY

Body order:

1. title line with transaction id, fingerprint ref, platform, and operation
2. `Transaction ref`
3. `Fingerprint`
4. `Date`
5. `Platform`
6. `Operation`
7. `Debit`
8. `Credit`
9. `Fees`
10. `Primary movement`
11. `Price`
12. `Flags`
13. optional `From`
14. optional `To`
15. optional blockchain metadata block
16. optional `Inflows`
17. optional `Outflows`
18. optional transaction-fee detail block
19. optional `User notes`
20. optional `Source data`

Rules:

- static detail is transaction-first and never opens inline export
- `Debit`, `Credit`, and `Fees` use the same balance-summary semantics as the browse list
- `Primary movement` is supplementary detail only and may render `—` when no primary movement can be derived
- blockchain metadata appears only when present on the processed transaction
- when `From` or `To` is present and the endpoint belongs to a tracked account
  set for the active profile, the detail surface appends `[tracked]` or
  `[untracked]` inline
- asset movement detail lines must include:
  - transaction-scoped `MOVEMENT-REF`
  - the effective `movementRole` when it is non-principal
- user notes render in full and are not artificially capped
- `Source data` renders only when `--provider-data` is requested
- each source row includes identifying metadata plus the linked `provider_data`
  and `normalized_data` payloads

### Explorer

Applies to:

- `exitbook transactions explore`
- `exitbook transactions explore <selector>`

Layout:

- top list of visible transactions
- bottom detail panel for the selected transaction
- dim divider between panes
- controls bar with navigation and export hints

Rules:

- the explorer list uses the same debit/credit/fee summaries as the static list, but without list headers
- selector-based explorer opens on the full unfiltered list with the requested transaction pre-selected
- non-selector explorer honors browse filters and `--limit`
- inline export remains explorer-only and is triggered from inside the TUI
- export writes the full filtered dataset, not just the visible window

## JSON Output

### List JSON

Applies to:

- `exitbook transactions --json`
- `exitbook transactions list --json`
- `exitbook transactions explore --json`

Shape:

```json
{
  "data": [
    {
      "id": 2456,
      "txFingerprint": "…",
      "platformKey": "kraken",
      "debitSummary": "24,500 USD",
      "creditSummary": "0.25 BTC",
      "feeSummary": "12.50 USD"
    }
  ],
  "meta": {
    "count": 50,
    "offset": 0,
    "limit": 50,
    "hasMore": false,
    "filters": {
      "platform": "kraken"
    }
  }
}
```

Rules:

- `transactions` and `transactions list` return the full static-list result set
- `transactions explore --json` applies the explorer `--limit`
- `debitSummary`, `creditSummary`, and `feeSummary` use the same balance-summary rules as the human list surfaces

### Detail JSON

Applies to:

- `exitbook transactions view <selector> --json`
- `exitbook transactions explore <selector> --json`

Rules:

- detail JSON contains one selected transaction plus detail meta
- selector detail JSON remains stable across static-detail and off-TTY explore paths
- blockchain detail JSON may include:
  - `fromOwnership`
  - `toOwnership`
- each inflow/outflow item in detail JSON must include:
  - `movementFingerprint`
  - `movementRole`

## Notes

- `transactions export` remains the script-oriented export command for full data dumps and is specified in [Transactions Export Spec](./transactions-export-spec.md)
- `transactions edit note <TX-REF>` remains the mutation entrypoint for durable analyst notes
