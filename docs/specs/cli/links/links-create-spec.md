# Links Create Spec

## Overview

`exitbook links create <source-ref> <target-ref> --asset <symbol>` creates a
confirmed manual link when the user knows the exact source outflow transaction
and target inflow transaction, but the linker did not propose the pair.

This is the intended path for cases like token migrations or clearly-known
cross-source transfers that are not currently discoverable from heuristics.

## Command Contract

```text
exitbook links create <source-ref> <target-ref> --asset <symbol> [--reason <text>] [--json]
```

Rules:

- `source-ref` is the transaction ref for the sending transaction
- `target-ref` is the transaction ref for the receiving transaction
- `--asset` is required and must resolve to exactly one outflow on the source
  transaction and exactly one inflow on the target transaction
- the command confirms the link immediately and writes a durable `link_override`
  event so the link is recreated after reprocessing

## Visual Example

```text
✓ Manual link created
   Link: #91 (blockchain_to_blockchain)
   Source: #1001 (ethereum / e96a8b7baa) 80.61 RENDER
   Target: #1002 (solana / b7c08af224) 80.61 RENDER
   Reason: Token migration
```

Other successful outcomes:

- `Existing link confirmed manually`
- `Manual link already confirmed`

## JSON Mode

```json
{
  "action": "created",
  "changed": true,
  "assetSymbol": "RENDER",
  "linkId": 91,
  "linkType": "blockchain_to_blockchain",
  "reviewedBy": "cli-user",
  "reviewedAt": "2026-04-10T12:00:00.000Z",
  "sourceTransactionId": 1001,
  "sourceTransactionRef": "e96a8b7baa",
  "sourcePlatformKey": "ethereum",
  "sourceAmount": "80.61",
  "targetTransactionId": 1002,
  "targetTransactionRef": "b7c08af224",
  "targetPlatformKey": "solana",
  "targetAmount": "80.61",
  "reason": "Token migration"
}
```

`action` is one of:

- `created`
- `confirmed-existing`
- `already-confirmed`

## Failure Rules

- unknown or ambiguous transaction refs fail with the standard transaction
  selector errors
- if the source transaction does not have exactly one outflow for the requested
  asset, the command fails
- if the target transaction does not have exactly one inflow for the requested
  asset, the command fails
- if multiple persisted links already share that exact movement identity, the
  command fails rather than guessing which row to mutate
- if override persistence fails, the command fails before mutating
  `transaction_links`

## Durability Rules

- the override event is the long-term source of truth
- new manual links persist immediately in `transaction_links`
- existing exact rows are confirmed in-place instead of creating a duplicate row
- if the override write succeeds but the immediate row create fails, the command
  returns an error telling the user to rerun `links run` to rematerialize the
  manual link from the stored override
