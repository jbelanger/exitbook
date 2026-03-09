# Canada Post-Phase Pricing Cleanup

This document records the cleanup work that should happen after the first
Canada cost basis slice is functional.

It exists because the Canada implementation exposed two schema smells in the
shared transaction model:

- `PriceAtTxTime.quotedPrice`
- tax asset identity policy / resolution

The first phase should stay focused on getting the Canada workflow correct.
This document captures the follow-up work needed to make that implementation
cleaner without turning the current Canada delivery into a full pricing-system
rewrite.

## Goals

- Reduce Canada-specific leakage into `UniversalTransactionData`.
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

## Current Smells

### 1. `quotedPrice` is semantically precise

`quotedPrice` describes what the value is: the price quoted at transaction
time in the source currency.

What the field actually represents is the source-native quoted price before
shared normalization rewrites `price` into USD.

That makes `quotedPrice` a better name.
It reads like a temporary snapshot, not a stable concept.

### 2. `PriceAtTxTime` is carrying two concerns

Today `PriceAtTxTime.price` acts as the shared normalized/storage price.

Canada, however, often needs the source-native transaction quote or direct
movement-leg valuation instead of the normalized USD value.

That means the current shape is mixing:

- source price evidence
- normalized shared valuation

Those are related, but they are not the same thing.

### 3. Tax asset identity must stay derived, not persisted

Canada needs an economic identity that is broader than `assetId`, but imported
data does not justify persisting a Canada-shaped field on raw transactions.

That identity should stay behind a shared resolver and explicit policy rather
than leaking into `UniversalTransactionData`.

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

### Rename `originalPrice` to `quotedPrice`

Post-phase, `PriceAtTxTime.originalPrice` should be renamed to `quotedPrice`.

`quotedPrice` better communicates:

- this was the source-native quoted price
- it predates shared normalization
- it is evidence, not a Canada-specific field

This is a terminology cleanup, not a behavior change.

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

### 1. Make naming honest

Rename:

- `PriceAtTxTime.originalPrice` -> `PriceAtTxTime.quotedPrice`

Follow-up cleanup:

- replace `'original-price'` valuation labels with `'quoted-price'`
- rename helper/test terminology that still says "original"

### 2. Keep Canada valuation leg-first

For Canada, valuation should prefer transaction semantics before shared price
fallbacks.

Preferred order:

1. derive value directly from fiat legs and fees when the transaction provides
   it
2. use `quotedPrice` when the source transaction provides a direct quote
3. use normalized USD price only as a fallback input to CAD conversion

This keeps Canada closer to transaction truth and reduces dependence on the
shared normalized representation.

### 3. Consider a later shared projection boundary

After the first Canada slice ships, revisit whether shared pricing should split
into:

- transaction source price evidence
- normalized/shared valuation projection

That work should only happen if more than Canada benefits from the separation.
It should not be introduced as speculative architecture.

### 4. Keep identity policy explicit

Post-phase, keep making explicit decisions about:

- which assets stay chain-strict
- which imported-data-only symbols are intentionally collapsed
- where that policy belongs if more jurisdictions start using it

Do not leave those choices as undocumented heuristics.

## What This Means For The Current Canada Work

The current Canada implementation can proceed without a pipeline rewrite if it
follows these rules:

- use Canada-owned events and CAD valuations as the tax boundary
- keep shared USD normalization intact upstream
- treat `quotedPrice` as supporting price evidence, not as final tax output
- avoid adding lot/disposal persistence until the event and pool shapes settle

That keeps the first phase focused while preserving a clear cleanup path.

## Open Questions

- Should relaxed symbol-collapse stay Canada-specific, or move into a shared
  cross-jurisdiction tax-identity policy layer?
- Is `PriceAtTxTime` a long-term shared fact shape, or only a transitional
  bridge while USD normalization remains destructive?
- When the Canada workflow stabilizes, do downstream views need persisted
  engine outputs, or is on-demand recomputation sufficient?
