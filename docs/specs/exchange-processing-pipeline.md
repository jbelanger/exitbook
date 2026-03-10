# Exchange Processing Pipeline

This spec defines the steady-state exchange processing architecture in
`@exitbook/ingestion`.

## Purpose

Exchange imports must preserve provider facts until there is enough evidence to
interpret them safely. The processor pipeline must fail closed on ambiguity
instead of inventing transaction meaning from generic defaults.

## Pipeline

Each exchange processor follows the same four-stage flow:

1. `normalize`: convert raw provider rows into `ExchangeProviderEvent`s
2. `group`: build provider-owned correlation groups from explicit evidence
3. `interpret`: classify each group as `confirmed`, `ambiguous`, or `unsupported`
4. `materialize`: turn confirmed drafts into `ProcessedTransaction`s

Shared code provides contracts and pure helpers for this flow. Provider
semantics stay inside each exchange slice.

## Invariants

- Ambiguity is first-class. Uncertain groups must not be materialized as
  transactions.
- Shared exchange code must not infer business meaning such as transfer, trade,
  reward, or fee categories from generic sign patterns alone.
- Same-asset opposing inflow/outflow pairs are not safe defaults for
  `transfer`.
- Correlation is evidence-driven and provider-owned. A provider may use
  different correlation rules for different row types.
- Unsupported patterns must emit structured diagnostics with enough evidence to
  explain why the group was rejected.

## Responsibility Split

Shared v2 code is responsible for:

- exchange processing contracts and diagnostic types
- draft materialization
- batch diagnostic aggregation and logging

Each exchange slice is responsible for:

- raw row normalization
- correlation group construction
- interpretation rules
- deciding when evidence is strong enough to confirm a transaction

## Outcomes

- `confirmed`: safe to materialize into a `ProcessedTransaction`
- `ambiguous`: evidence conflicts or is insufficient; processing fails closed
- `unsupported`: the pattern is recognized as out of scope for the current
  interpreter and must not be materialized
