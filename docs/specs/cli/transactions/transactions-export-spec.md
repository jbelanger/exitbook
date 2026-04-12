---
last_verified: 2026-04-12
status: canonical
---

# Transactions Export Spec

> ⚠️ **Code is law**: If this document disagrees with implementation, update the spec.

Defines the `exitbook transactions export` command and its file contracts.

## Scope

This document covers:

- `exitbook transactions export`

It specializes the export behavior for processed transactions and their related diagnostics, user notes, fees, and links.

## Command Surface

Examples:

```text
exitbook transactions export
exitbook transactions export --format json --output tx.json
exitbook transactions export --csv-format simple
exitbook transactions export --json
```

Options:

- `--format <csv|json>`
- `--csv-format <normalized|simple>`
- `--output <file>`
- `--json`

Rules:

- default format is `csv`
- default CSV format is `normalized`
- default output path is:
  - `data/transactions.csv` for CSV
  - `data/transactions.json` for JSON
- `--json` controls completion output format, not exported transaction data format

## Data Source

Export reads processed transactions for the active profile.

Rules:

- export does not call live providers
- export does not rebuild transactions
- normalized CSV export also reads persisted `transaction_links` for the exported transaction IDs

## Output Formats

### JSON Export

`--format json` writes one file containing the full processed transaction array.

Contract:

- output is `JSON.stringify(transactions, undefined, 2)`
- each transaction carries the canonical processed shape, including:
  - `movements`
  - `fees`
  - `diagnostics`
  - `userNotes`
  - blockchain metadata when present

### Simple CSV Export

`--format csv --csv-format simple` writes one flat summary CSV.

Headers:

- `id`
- `tx_fingerprint`
- `platform_key`
- `operation_category`
- `operation_type`
- `datetime`
- `inflow_assets`
- `inflow_amounts`
- `outflow_assets`
- `outflow_amounts`
- `network_fee_assets`
- `network_fee_amounts`
- `platform_fee_assets`
- `platform_fee_amounts`
- `diagnostic_codes`
- `diagnostic_messages`
- `user_note_messages`
- `status`

Rules:

- repeated movement assets on one side are joined with `;`
- fee columns split `network` and `platform` scopes only
- diagnostics and user notes are flattened into semicolon-separated message/code columns

### Normalized CSV Export

`--format csv --csv-format normalized` writes one base transaction CSV plus companion files.

Base output path:

- if `--output` ends with `.csv`, that exact path is the transactions file and the base prefix is the filename without `.csv`
- otherwise, `--output` itself is the base prefix and the transactions file still uses that exact path

Files:

- `<output>`: transactions table
- `<base>.movements.csv`
- `<base>.fees.csv`
- `<base>.diagnostics.csv`
- `<base>.user-notes.csv`
- `<base>.links.csv`

Transactions headers:

- `id`
- `tx_fingerprint`
- `account_id`
- `platform_key`
- `operation_category`
- `operation_type`
- `datetime`
- `timestamp`
- `status`
- `from`
- `to`
- `blockchain_name`
- `block_height`
- `transaction_hash`
- `is_confirmed`
- `excluded_from_accounting`

Movements headers:

- `tx_id`
- `direction`
- `asset_id`
- `asset_symbol`
- `gross_amount`
- `net_amount`
- `price_amount`
- `price_currency`
- `price_source`
- `price_fetched_at`
- `price_granularity`
- `fx_rate_to_usd`
- `fx_source`
- `fx_timestamp`

Fees headers:

- `tx_id`
- `asset_id`
- `asset_symbol`
- `amount`
- `scope`
- `settlement`
- `price_amount`
- `price_currency`
- `price_source`
- `price_fetched_at`
- `price_granularity`
- `fx_rate_to_usd`
- `fx_source`
- `fx_timestamp`

Diagnostics headers:

- `tx_id`
- `code`
- `severity`
- `message`
- `metadata_json`

User notes headers:

- `tx_id`
- `created_at`
- `author`
- `message`

Links headers:

- `link_id`
- `source_transaction_id`
- `target_transaction_id`
- `asset_symbol`
- `source_amount`
- `target_amount`
- `link_type`
- `confidence_score`
- `status`
- `reviewed_by`
- `reviewed_at`
- `created_at`
- `updated_at`
- `match_criteria_json`
- `metadata_json`

Rules:

- normalized CSV is relational, not display-oriented
- diagnostics and user notes are first-class companion files, not hidden JSON blobs inside the transactions file
- links output includes all persisted links for the exported transaction IDs

## Completion Output

Text completion:

- if zero transactions matched: `No transactions found to export.`
- otherwise:
  - one-path export: `Exported {n} transactions to: {path}`
  - multi-file export: `Exported {n} transactions to:` followed by one path per line

JSON completion shape:

```json
{
  "data": {
    "transactionCount": 123,
    "format": "csv",
    "csvFormat": "normalized",
    "outputPaths": ["data/transactions.csv"]
  }
}
```

## Invariants

- export operates on processed transactions only
- diagnostics and user notes are exportable first-class data
- normalized CSV export writes companion diagnostics and user-notes files
- completion JSON reports metadata about written files, not the exported dataset itself

## Related Specs

- [Transactions CLI Spec](./transactions-view-spec.md)
- [Movement Semantics and Diagnostics Specification](../../movement-semantics-and-diagnostics.md)
- [Transaction Linking](../../transaction-linking.md)
