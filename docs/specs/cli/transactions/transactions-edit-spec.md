---
last_verified: 2026-04-19
status: canonical
---

# Transactions Edit CLI Spec

## Scope

This document defines the `transactions edit` mutation surfaces:

- `exitbook transactions edit note <TX-REF>`
- `exitbook transactions edit movement-role <TX-REF> --movement <MOVEMENT-REF>`

It specializes the mutation rules in [CLI Surface V3 Specification](../cli-surface-v3-spec.md).

Out of scope:

- read-only browse surfaces in [Transactions CLI Spec](./transactions-view-spec.md)
- downstream accounting issue surfacing in [Issues View Spec](../issues/issues-view-spec.md)

## Family Model

`transactions edit` is the durable processed-transaction override surface.

Rules:

- commands mutate durable override state only
- commands target processed transactions for the active profile
- commands never key durability by numeric transaction ids
- command input is ref-first:
  - `TX-REF` for transaction selection
  - `MOVEMENT-REF` for one asset movement inside one selected transaction

## Command Surface

| Shape                                                               | Meaning                                     |
| ------------------------------------------------------------------- | ------------------------------------------- |
| `transactions edit note <TX-REF> --message <text>`                  | Save one durable analyst note               |
| `transactions edit note <TX-REF> --clear`                           | Clear the durable analyst note              |
| `transactions edit movement-role <TX-REF> --movement <REF> ...`     | Save one durable movement-role override     |
| `transactions edit movement-role <TX-REF> --movement <REF> --clear` | Clear the durable movement-role override    |
| Any of the above + `--json`                                         | Return machine output for the same mutation |

Rules:

- `transactions edit` is a command group, not an executable shape by itself
- note and movement-role mutations are intentionally separate commands
- movement-role mutation is scoped to one selected transaction plus one selected movement

## Selectors

### Transaction selector

`<TX-REF>` is the persisted transaction fingerprint prefix shown in browse output.

Rules:

- transaction resolution is prefix-based against `txFingerprint`
- ambiguous prefixes fail
- missing transaction refs fail

### Movement selector

`<MOVEMENT-REF>` is the transaction-scoped movement convenience ref shown in transaction detail output.

Rules:

- movement resolution is scoped to the already-selected transaction only
- `MOVEMENT-REF` is derived from persisted `movementFingerprint`
- ambiguity or misses fail at the command boundary
- fee movements are not selectable through this command family

## Note Mutation Rules

`transactions edit note` persists durable analyst context without changing transaction amounts or semantics.

Rules:

- `--message` and `--clear` are mutually exclusive
- setting the same note again is idempotent
- clearing a missing note is idempotent
- durable note state is keyed by persisted `txFingerprint`

## Movement-Role Mutation Rules

`transactions edit movement-role` persists one manual role override on one persisted asset movement.

Rules:

- `--role` and `--clear` are mutually exclusive
- the persisted base role remains in `transaction_movements.movement_role`
- the manual state materializes separately in `transaction_movements.movement_role_override`
- effective reads use:
  - `movement_role_override ?? movement_role ?? 'principal'`
- clear restores the processor-authored base role from stored row state
  - it must not derive the next role from the already-materialized effective transaction view

Compatibility rules:

- outflows may not be set to:
  - `staking_reward`
  - `refund_rebate`
- inflows may use any currently-shipped movement role
- `protocol_overhead` remains valid on either direction

Idempotency rules:

- setting a movement to its current effective role is a no-op
- clearing a movement with no stored override is a no-op

## Shared Output Contract

Both edit commands return ref-first public summaries.

Shared transaction summary:

```ts
{
  platformKey: string;
  txFingerprint: string;
  txRef: string;
}
```

Movement summary:

```ts
{
  assetSymbol: string;
  direction: 'inflow' | 'outflow';
  movementFingerprint: string;
  movementRef: string;
}
```

Projection sync summary:

```ts
{
  projectionSyncStatus: 'synchronized' | 'reprocess-required';
  repairCommand?: string;
  warnings: string[];
}
```

Rules:

- `txRef` and `movementRef` are user-facing selectors
- `txFingerprint` and `movementFingerprint` remain the canonical durable identities
- public mutation output must keep the selector and canonical identity meanings distinct
- `warnings` is always present:
  - `[]` when the selected transaction and downstream projections are synchronized
  - one or more operator-facing warnings when durable override state is ahead of projections
- `repairCommand` is present only when `projectionSyncStatus` is `reprocess-required`
- failures before a durable append is confirmed remain hard command errors
- failures after a durable append is confirmed return success output with:
  - `projectionSyncStatus: 'reprocess-required'`
  - `warnings`
  - `repairCommand: "exitbook reprocess"`

## JSON Output

### Note result

```json
{
  "action": "set",
  "changed": true,
  "note": "Moved to Ledger",
  "projectionSyncStatus": "synchronized",
  "reason": "manual reminder",
  "transaction": {
    "platformKey": "kraken",
    "txFingerprint": "1234...",
    "txRef": "1234abcd56"
  },
  "warnings": []
}
```

### Movement-role result

```json
{
  "action": "clear",
  "changed": true,
  "movement": {
    "assetSymbol": "USDC",
    "direction": "inflow",
    "movementFingerprint": "movement:abcd...:1",
    "movementRef": "abcd123456:1"
  },
  "previousEffectiveRole": "staking_reward",
  "nextEffectiveRole": "principal",
  "projectionSyncStatus": "synchronized",
  "reason": "cleanup",
  "transaction": {
    "platformKey": "coinbase",
    "txFingerprint": "1234...",
    "txRef": "1234abcd56"
  },
  "warnings": []
}
```

### Partial-success result

```json
{
  "action": "set",
  "changed": true,
  "note": "Moved to Ledger",
  "projectionSyncStatus": "reprocess-required",
  "repairCommand": "exitbook reprocess",
  "transaction": {
    "platformKey": "kraken",
    "txFingerprint": "1234...",
    "txRef": "1234abcd56"
  },
  "warnings": ["Override state is current, but transaction note projection refresh failed: ..."]
}
```

## Text Output

Text output is success-first and compact.

Required lines:

- success line
- `Transaction: <TX-REF> (<platform> / <txFingerprint>)`
- note or movement summary line as appropriate

Movement-role text output also includes:

- `Movement: <MOVEMENT-REF> (<direction amount asset [role]>)`
- `Role: <previous> -> <next>`

When `warnings` is non-empty, text output also includes:

- one `Warning: ...` line per warning
- `Repair: exitbook reprocess`

## Replay / Materialization Rules

- note mutation reads stored note overrides, then always attempts to synchronize the selected transaction note projection
  - if the requested durable note already matches stored override state, the command remains idempotent and reports `changed: false`
  - if note projection synchronization still fails, the command reports `projectionSyncStatus: 'reprocess-required'`
- movement-role mutation appends a `transaction_movement_role_override` event, then materializes movement-role projection
- movement-role mutation also marks downstream processed-transaction-derived projections stale for the owning account
- when append succeeds but later synchronization work fails, the current operator repair path is `exitbook reprocess`

## Related Specs

- [Transactions CLI Spec](./transactions-view-spec.md)
- [Transaction and Movement Identity](../../transaction-and-movement-identity.md)
- [Movement Semantics and Diagnostics](../../movement-semantics-and-diagnostics.md)
- [Override Event Store and Replay](../../override-event-store-and-replay.md)
