# Links Create Grouped Spec

## Overview

`exitbook links create-grouped` creates confirmed grouped manual links when the
user knows an exact transfer is split across multiple source transactions or
multiple target transactions and the system did not propose the grouped shape.

The first shipped slice is intentionally narrow:

- exact many-to-one (`N:1`)
- exact one-to-many (`1:N`)

It does **not** support general `M:N` allocation.

## Command Contract

```text
exitbook links create-grouped \
  --source <tx-ref> [--source <tx-ref> ...] \
  --target <tx-ref> [--target <tx-ref> ...] \
  --asset <symbol> \
  [--explained-residual-amount <amount> --explained-residual-role <role>] \
  [--reason <text>] \
  [--json]
```

Rules:

- `--source` selects source outflow transactions and may be repeated
- `--target` selects target inflow transactions and may be repeated
- exactly one side must contain multiple transactions
- the selected transactions must resolve to exactly one matching movement for
  the requested asset on the required side
- grouped totals must balance exactly for the requested asset unless the command
  declares one exact explained target residual
- explained target residual rules:
  - the residual is allowed only for grouped many-to-one corrections
  - both `--explained-residual-amount` and `--explained-residual-role` must be
    provided together
  - the residual amount must be positive
  - `sources total + residual amount` must equal the single target total exactly
  - the residual role must be one of:
    - `staking_reward`
    - `protocol_overhead`
    - `refund_rebate`
- the command confirms all grouped links immediately and writes durable
  `link_override` events so the grouped correction survives reprocessing

## Visual Example

```text
✓ Grouped manual links created
   Shape: many-to-one (2 source, 1 target)
   Links: 2 total (2 created, 0 confirmed existing, 0 unchanged)
   Explained residual: 10.524451 ADA (staking_reward)
   - #91 78a82e8482 -> 38adc7a548 1021.402541 ADA (created)
   - #92 d0c794045d -> 38adc7a548 975.034581 ADA (created)
   Reason: Wallet consolidation
```

Other successful outcomes:

- `Existing grouped links confirmed manually`
- `Grouped manual links already confirmed`
- `Grouped manual links applied`

## JSON Mode

```json
{
  "action": "mixed",
  "changed": true,
  "assetSymbol": "ADA",
  "groupShape": "many-to-one",
  "sourceCount": 2,
  "targetCount": 1,
  "createdCount": 1,
  "confirmedExistingCount": 1,
  "unchangedCount": 0,
  "explainedTargetResidualAmount": "10.524451",
  "explainedTargetResidualRole": "staking_reward",
  "reason": "Wallet consolidation",
  "links": [
    {
      "action": "confirmed-existing",
      "existingStatusBefore": "suggested",
      "linkId": 55,
      "linkType": "blockchain_to_exchange",
      "reviewedBy": "cli-user",
      "reviewedAt": "2026-04-14T12:00:00.000Z",
      "sourceTransactionId": 1001,
      "sourceTransactionRef": "78a82e8482",
      "sourcePlatformKey": "cardano",
      "sourceAmount": "1021.402541",
      "targetTransactionId": 4200,
      "targetTransactionRef": "38adc7a548",
      "targetPlatformKey": "kucoin",
      "targetAmount": "1021.402541"
    },
    {
      "action": "created",
      "linkId": 91,
      "linkType": "blockchain_to_exchange",
      "reviewedBy": "cli-user",
      "reviewedAt": "2026-04-14T12:00:00.000Z",
      "sourceTransactionId": 1002,
      "sourceTransactionRef": "d0c794045d",
      "sourcePlatformKey": "cardano",
      "sourceAmount": "975.034581",
      "targetTransactionId": 4200,
      "targetTransactionRef": "38adc7a548",
      "targetPlatformKey": "kucoin",
      "targetAmount": "975.034581"
    }
  ]
}
```

Top-level `action` is one of:

- `created`
- `confirmed-existing`
- `already-confirmed`
- `mixed`

Per-link `action` is one of:

- `created`
- `confirmed-existing`
- `already-confirmed`

## Failure Rules

- unknown or ambiguous transaction refs fail with the standard transaction
  selector errors
- both sides plural fails; use a later workflow if true `M:N` support is ever
  added
- both sides singular fail; use `links create <source-ref> <target-ref>`
- duplicate source or target selections fail
- a transaction cannot appear on both the source and target side
- if any selected transaction does not have exactly one matching movement for
  the requested asset on the required side, the command fails
- if the grouped totals do not balance exactly under the declared correction
  shape, the command fails
- explained target residuals on one-to-many groups fail
- if multiple persisted links already share the same exact movement identity for
  any grouped leg, the command fails rather than guessing
- if override persistence fails, the command fails before mutating
  `transaction_links`

## Durability Rules

- override events are the long-term source of truth for the grouped correction
- if an explained target residual is declared, it is persisted on each grouped
  `link_override` event and rematerialized back onto the grouped confirmed links
- grouped override events are appended atomically; either the whole batch is
  stored or none of it is
- immediate `transaction_links` updates run in one transaction after the
  override batch succeeds
- if the override batch succeeds but the immediate row mutation fails, the
  command returns an error telling the user to rerun `links run` to rematerialize
  the grouped links from the stored overrides
