---
last_verified: 2026-04-14
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

Rules:

- `txRef` and `movementRef` are user-facing selectors
- `txFingerprint` and `movementFingerprint` remain the canonical durable identities
- public mutation output must keep the selector and canonical identity meanings distinct

## JSON Output

### Note result

```json
{
  "action": "set",
  "changed": true,
  "note": "Moved to Ledger",
  "reason": "manual reminder",
  "transaction": {
    "platformKey": "kraken",
    "txFingerprint": "1234...",
    "txRef": "1234abcd56"
  }
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
  "reason": "cleanup",
  "transaction": {
    "platformKey": "coinbase",
    "txFingerprint": "1234...",
    "txRef": "1234abcd56"
  }
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

## Replay / Materialization Rules

- note mutation appends a `transaction_user_note_override` event, then materializes note projection
- movement-role mutation appends a `transaction_movement_role_override` event, then materializes movement-role projection
- movement-role mutation also marks downstream processed-transaction-derived projections stale for the owning account

## Related Specs

- [Transactions CLI Spec](./transactions-view-spec.md)
- [Transaction and Movement Identity](../../transaction-and-movement-identity.md)
- [Movement Semantics and Diagnostics](../../movement-semantics-and-diagnostics.md)
- [Override Event Store and Replay](../../override-event-store-and-replay.md)
