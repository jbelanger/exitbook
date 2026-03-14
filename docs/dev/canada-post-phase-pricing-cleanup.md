# Canada Post-Phase Pricing Cleanup

This document now tracks only the Canada pricing cleanup that still remains
after the first cost-basis slice landed.

Completed follow-ups are intentionally removed from this note. The naming
cleanup, shared tax identity resolution, and Canada-owned valuation records
are already in place.

What remains is the shared `PriceAtTxTime` boundary. Canada exposed the smell,
but the question is broader than Canada and should be resolved only if the
shared pricing pipeline benefits from the split.

## Goals

- Clarify the meaning of transaction-time price fields.
- Keep the shared USD pricing pipeline stable while Canada migrates.
- Defer persistence work until the Canada event and pool model stabilize.

## Non-Goals

- Rewriting the entire shared price enrichment pipeline during the current
  Canada phase.
- Persisting lots, disposals, or pool state before the Canada workflow shapes
  settle.
- Reversing the current shared USD normalization contract in the same phase as
  the Canada math rewrite.

## Current Smell

### `PriceAtTxTime` is carrying two concerns

Today `PriceAtTxTime.price` acts as the shared normalized/storage price.

Canada, however, often needs the source-native transaction quote or direct
movement-leg valuation instead of the normalized USD value.

That means the current shape is mixing:

- source price evidence (`quotedPrice`)
- normalized shared valuation (`price`)

Those are related, but they are not the same thing.

## Decisions

### Keep shared USD normalization for now

The shared price enrichment pipeline should remain USD-normalized in the near
term.

That pipeline already serves generic cost basis, price coverage checks, fetch
logic, and other consumers. Replacing it during the Canada migration would
expand scope too far.

This means:

- shared enrichment continues to normalize non-USD fiat prices into USD
- Canada must not treat normalized USD as its tax truth
- Canada should build CAD tax valuations from transaction legs or native price
  evidence before falling back to normalized USD

### Treat `PriceAtTxTime` as price evidence, not tax output

Canada-specific tax values should not be pushed back into `priceAtTxTime`.

Do not use `priceAtTxTime` to store:

- inherited transfer basis
- pooled ACB values
- disposal cost basis
- superficial-loss-adjusted values

Those belong in Canada-owned events, layers, dispositions, and later reporting
records.

### Defer lot and disposal persistence

Persisted acquisitions, dispositions, and pool snapshots are not required for
the first Canada slice.

They become justified when one of these is needed:

- incremental recomputation
- durable audit snapshots
- faster UI drill-down without rerunning Canada math
- debugging against persisted engine outputs

Until then, persistence is optional and should stay out of the critical path.

## Post-Phase Direction

### 1. Keep Canada valuation leg-first

For Canada, valuation should prefer transaction semantics before shared price
fallbacks.

Preferred order:

1. derive value directly from fiat legs and fees when the transaction provides
   it
2. use `quotedPrice` when the source transaction provides a direct quote
3. use normalized USD price only as a fallback input to CAD conversion

This keeps Canada closer to transaction truth and reduces dependence on the
shared normalized representation.

### 2. Consider a later shared projection boundary

After the first Canada slice ships, revisit whether shared pricing should split
into:

- transaction source price evidence
- normalized/shared valuation projection

That work should only happen if more than Canada benefits from the separation.
It should not be introduced as speculative architecture.

## What This Means For The Current Canada Work

The current Canada implementation can proceed without a pipeline rewrite if it
follows these rules:

- use Canada-owned events and CAD valuations as the tax boundary
- keep shared USD normalization intact upstream
- treat `quotedPrice` as supporting price evidence, not as final tax output
- avoid adding lot/disposal persistence until the event and pool shapes settle

That keeps the first phase focused while preserving a clear cleanup path.

## Open Questions

- Is `PriceAtTxTime` a long-term shared fact shape, or only a transitional
  bridge while USD normalization remains destructive?
- When the Canada workflow stabilizes, do downstream views need persisted
  engine outputs, or is on-demand recomputation sufficient?
