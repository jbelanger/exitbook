# Canada Cost Basis Greenfield Design

This document proposes a greenfield design for CRA-aligned Canadian cost basis
inside `@exitbook/accounting`.

It is intentionally not a patch plan for the current `average-cost` strategy.
The current model is built around:

```text
USD-normalized prices
  +
assetId-keyed lot state
  +
strategy-level ACB matching
  +
post-hoc display currency conversion
```

That shape is the wrong foundation for Canada.

The greenfield design in this document treats Canada as a jurisdiction-owned tax
workflow with its own:

- tax property identity
- tax-currency valuation
- pooled ACB state
- superficial loss adjustments
- tax-native reporting

## Status

The identity, CAD valuation, pooled ACB, and transfer-fee foundation now exist
in the Canada slice. Specifically, the current implementation already has:

- explicit `taxAssetIdentityPolicy` plus `relaxedTaxIdentitySymbols`
- transaction-time CAD `CanadaTaxValuation`
- transfer-aware `CanadaTaxInputContextBuilder`
- pooled `CanadaAcbEngine`
- `CanadaSuperficialLossEngine` with denied-loss carry-forward into later ACB
- `CanadaTaxReport` plus optional `CanadaDisplayCostBasisReport`
- top-level workflow cut-in for `CA + average-cost`
- Canada workflow lookahead through `endDate + 30 days` while keeping report
  rows filtered to the requested calculation window
- link-scoped same-asset transfer fee adjustments when one source movement fans
  out across multiple confirmed links

Still pending from the full greenfield target:

- full `CA`-only cutover so `fifo` and `lifo` no longer fall back to the
  generic lot pipeline
- richer Canada transfer presentation in the CLI/report layer

Today `CA + average-cost` already enters the Canada workflow.
The remaining generic lot-pipeline path is still active for:

- non-CA jurisdictions
- `CA` requests that still select `fifo` or `lifo`

That generic path still goes through:

- `packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-calculator.ts`
- `packages/accounting/src/cost-basis/shared/gain-loss-utils.ts`
- `packages/accounting/src/cost-basis/orchestration/cost-basis-report-generator.ts`

## Goals

- Compute Canadian gains and losses in CAD at transaction time, not by
  converting USD results later.
- Pool identical property across all owned venues and accounts.
- Model superficial loss as a first-class ACB adjustment, not a boolean flag.
- Keep the accounting capability modular: hosts compose workflows; the
  accounting package owns the behavior and ports.
- Preserve auditability: every tax amount carries valuation and FX provenance.

## Non-Goals

- Solving business-income treatment for active trading.
- Solving multi-taxpayer household modeling in the first phase.
- Reusing FIFO/LIFO abstractions for the Canadian path if they weaken the model.
- Keeping the generic CA lot-pipeline path as a permanent compatibility layer.

## Current Model Problems

### 1. Tax math happens in USD first

Today the workflow calculates cost basis and gain/loss, then optionally
generates a non-USD report afterward.

That is acceptable for display.
It is not acceptable for Canadian tax accounting.

Canada needs:

- acquisition cost in CAD at acquisition time
- disposition proceeds in CAD at disposition time
- ACB pool maintained in CAD throughout

### 2. Pooling uses `assetId`

`assetId` is the right key for storage integrity and provider identity.
It is not the right key for Canadian identical-property pooling.

Examples that must pool together for Canada:

- BTC acquired on Kraken
- BTC acquired on Coinbase
- BTC acquired on-chain
- BTC moved between owned accounts

Examples that must not pool together:

- BTC and WBTC
- under a strict token policy, Ethereum USDC and Solana USDC
- distinct tokens that merely share a symbol

This requires a dedicated tax identity, not reuse of the storage identity.

### 3. Superficial loss is modeled as a boolean disallowance

The current shape checks for nearby reacquisitions and can zero out a taxable
loss.

That is too weak.

Canada needs:

- window-aware reacquisition detection
- owned-at-window-end validation
- denied quantity calculation
- denied loss amount allocation
- ACB carry-forward into substituted property

### 4. Reporting and tax computation are mixed together

The current report generator is doing two jobs:

- presentation conversion
- tax summary generation

Those concerns must split.

The primary Canada output must already be a tax-native CAD report.
Optional USD or other currency displays should be derived later and must never
recompute taxable amounts.

## Greenfield Architecture

Current landed shape:

```text
full transaction history
  +
confirmed links
  ↓
CanadaTaxInputContextBuilder
  ↓
CanadaTaxEvent[]
  ↓
CanadaAcbEngine
  ↓
CanadaSuperficialLossEngine
  ↓
CanadaAcbEngine (with superficial-loss adjustment events)
  ↓
CanadaTaxReportBuilder
  ↓
optional CanadaDisplayCostBasisReport
  ↓
CostBasisWorkflowResult (for CA + average-cost today)
```

Target end-state after the remaining phases:

```text
full transaction history
  +
confirmed links
  ↓
CanadaTaxInputContextBuilder
  ↓
CanadaTaxEvent[]
  ↓
CanadaAcbEngine
  ↓
CanadaSuperficialLossEngine
  ↓
CanadaAcbEngine (with superficial-loss adjustment events)
  ↓
CanadaTaxReportBuilder
  ↓
optional DisplayReportBuilder
  ↓
CostBasisWorkflowResult
```

The landed workflow also takes a report-end pool snapshot from the adjusted
Canada event stream so post-period reacquisitions can deny in-period losses
without leaking future acquisition rows into the report.

### Boundary Split

Keep these existing responsibilities:

- repository/data adapter loads full transaction history + confirmed links
- accounting-scoped builder still owns same-hash transaction semantics
- CLI remains the composition root

Replace these Canada-specific responsibilities:

- `average-cost` strategy dispatch inside the generic pipeline
- `LotMatcher` as the authoritative Canada calculator
- generic gain/loss disallowance helpers
- `CostBasisReportGenerator` as the source of Canadian tax output

### Workflow Dispatch Target

`CostBasisWorkflow` remains the host-facing shell.
The jurisdiction dispatch moves inside the workflow:

```ts
if (config.jurisdiction === 'CA') {
  assert config.method === 'average-cost'
  load confirmed links once
  runCanadaAcbWorkflow(...)
  runCanadaSuperficialLossEngine(...)
  buildCanadaTaxReport(...)
  optionally build display report from CAD tax rows
  return canada workflow result
}

return run generic lot pipeline for non-CA jurisdictions
```

The important boundary is that `CA` must not enter `runCostBasisPipeline()` once
cutover lands.

## Workflow And Report Boundary

The current generic public result shape is lot-oriented:

- `summary`
- `lots`
- `disposals`
- `lotTransfers`
- optional `report`

That is the wrong authority boundary for Canada because it makes a USD-origin
display report look like the tax result.

Recommended cutover boundary:

```ts
type CostBasisWorkflowResult = GenericCostBasisWorkflowResult | CanadaCostBasisWorkflowResult;

interface CanadaCostBasisWorkflowResult {
  kind: 'canada-workflow';
  calculation: {
    id: string;
    jurisdiction: 'CA';
    method: 'average-cost';
    taxYear: number;
    startDate: Date;
    endDate: Date;
    transactionsProcessed: number;
  };
  taxReport: CanadaTaxReport;
  displayReport?: CanadaDisplayCostBasisReport;
}
```

Relationship to the current landed Canada slice:

- `runCanadaAcbWorkflow()` currently returns `CanadaAcbWorkflowResult`
- that result is the internal ACB-stage output: input context plus ACB engine
  state
- `CanadaCostBasisWorkflowResult` is the current public boundary for
  `CA + average-cost`, wrapping the ACB-stage output with tax-report assembly
- in other words, `CanadaCostBasisWorkflowResult` wraps and supersedes
  `CanadaAcbWorkflowResult` at the host-facing API boundary rather than
  replacing the lower-level ACB workflow step itself

Rules for this boundary:

- `taxReport` is the authoritative tax output
- `displayReport` is optional and derived from `taxReport`
- display conversion may change presentation currency, never tax math
- raw Canada engine artifacts stay internal or debug-only, not CLI-facing
- non-CA jurisdictions may keep the generic lot-pipeline result temporarily
  during migration
- do not back-project Canada into `LotDisposal` or `ConvertedLotDisposal` just
  to preserve the old shape

## Core Domain Types

Create Canada-owned tax shapes in
`packages/accounting/src/cost-basis/canada/canada-tax-types.ts`.

### `CanadaCostBasisCalculation`

Current workflow-level metadata for the Canada result.

Current fields:

- `id`
- `calculationDate`
- `method: 'average-cost'`
- `jurisdiction: 'CA'`
- `taxYear`
- `displayCurrency`
- `taxCurrency: 'CAD'`
- `startDate`
- `endDate`
- `transactionsProcessed`
- `assetsProcessed`

### `CanadaTaxPropertyKey`

String key for Canadian identical-property pooling.

Examples:

- `ca:btc`
- `ca:eth`
- `ca:erc20:ethereum:0xa0b8...`
- `ca:spl:solana:EPjF...`

This key must be derived from a canonical economic asset identity, not from
venue.

### `CanadaTaxValuation`

Carries transaction-time valuation in CAD.

Current fields:

- `taxCurrency: 'CAD'`
- `storagePriceAmount`
- `storagePriceCurrency`
- `quotedPriceAmount`
- `quotedPriceCurrency`
- `unitValueCad`
- `totalValueCad`
- `valuationSource`
- optional `fxRateToCad`
- optional `fxSource`
- optional `fxTimestamp`

### `CanadaTaxEvent`

Current discriminated union:

- `acquisition`
- `disposition`
- `transfer-out`
- `transfer-in`
- `fee-adjustment`

Planned follow-on event kind:

- `superficial-loss-adjustment`

Every event carries:

- `taxPropertyKey`
- `transactionId`
- `timestamp`
- `quantity`
- `valuation`
- provenance metadata

### `CanadaAcbPoolState`

One live pool per `CanadaTaxPropertyKey`.

Required fields:

- `quantityHeld`
- `totalAcbCad`
- `acbPerUnitCad`
- `acquisitionLayers`

Each acquisition layer currently carries:

- historical `totalCostCad`
- `remainingQuantity`
- `remainingAllocatedAcbCad` as the layer's current audit projection of pooled
  ACB

The pool is the authoritative Canadian accounting state. Superficial-loss
carry-forward now lands as explicit adjustment events rather than a separate
pending-state structure.

### `CanadaTaxReport`

Authoritative CRA-facing output for the Canada workflow.

Required fields:

- `calculationId`
- `taxCurrency: 'CAD'`
- `acquisitions`
- `dispositions`
- `superficialLossAdjustments`
- `transfers`
- `summary`

`summary` should carry tax-native totals:

- `totalProceedsCad`
- `totalCostBasisCad`
- `totalGainLossCad`
- `totalTaxableGainLossCad`
- `totalDeniedLossCad`

### `CanadaDisplayCostBasisReport`

Optional non-tax projection for CLI/UI/JSON display.

Minimal shape for Phase 5:

- `displayCurrency`
- `sourceTaxCurrency`
- `dispositions`
- `transfers`
- `summary`

Rules:

- source rows come from `CanadaTaxReport`, not from raw transactions
- display conversion starts from CAD tax amounts for Canada
- conversion metadata remains attached for auditability
- this report may be omitted entirely when display currency is already `CAD`

## Foundational Design Decisions

### 1. Resolve tax identity explicitly

Do not persist a Canada-specific canonical id on raw transactions.

Instead, resolve tax identity inside accounting from imported facts:

- `assetId`
- `assetSymbol`
- jurisdiction identity policy

Rules:

- `assetId` stays storage/provider-facing
- accounting resolves an economic/tax identity key from imported facts
- Canada derives `taxPropertyKey` from that resolved identity
- the identity policy must be explicit so strict and relaxed behaviors are testable
- relaxed symbol collapse is allowed for imported-data-only cases like `USDC`
- if Canada cannot derive `taxPropertyKey`, the workflow fails closed

### 2. Build CAD valuations before cost basis

Do not store Canadian cost basis as converted USD results.

Instead:

- read execution price / normalized price data from transactions
- derive CAD valuation at transaction timestamp
- attach FX metadata to the tax event
- run ACB entirely in CAD

### 3. Use a pool engine, not lot-matching strategy, for Canada

The current ACB strategy distributes disposal quantity across open lots
pro-rata. That can remain useful for audit output, but it should not be the
primary Canadian accounting model.

The primary model is:

```text
pool quantity
pool total ACB
pool ACB/unit
```

Dispositions reduce the pool directly.

### 4. Model superficial loss as state mutation

Superficial loss is not a reporting annotation.
It changes future ACB.

The engine must:

- identify the denied portion of a loss
- record the denied loss amount
- attach that denied amount to substituted property
- keep the audit trail for later disposal

## File Layout

Implemented foundation:

```text
packages/accounting/src/cost-basis/canada/
  canada-tax-types.ts
  canada-tax-identity-utils.ts
  canada-tax-context-builder.ts
  canada-acb-engine.ts
  canada-acb-workflow.ts
  __tests__/
    canada-tax-context-builder.test.ts
    canada-acb-engine.test.ts
    canada-acb-workflow.test.ts
    test-utils.ts
```

Planned follow-ons:

```text
packages/accounting/src/cost-basis/canada/
  canada-superficial-loss-types.ts
  canada-superficial-loss-engine.ts
  __tests__/
    canada-superficial-loss-engine.test.ts
    canada-tax-report-builder.test.ts
```

Shared/report boundary changes:

```text
packages/accounting/src/cost-basis/shared/report-types.ts
packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts
packages/accounting/src/cost-basis/orchestration/cost-basis-report-generator.ts
apps/cli/src/features/cost-basis/command/cost-basis.ts
apps/cli/src/features/cost-basis/view/cost-basis-view-utils.ts
apps/cli/src/features/cost-basis/view/cost-basis-view-state.ts
```

Shared/core touchpoints:

```text
packages/core/src/transaction/universal-transaction.ts
packages/core/src/money/asset-id-utils.ts
```

Aspirational core extractions only if the logic proves reusable outside Canada:

```text
packages/core/src/money/tax-property-key-utils.ts
```

Orchestration changes:

```text
packages/accounting/src/cost-basis/orchestration/cost-basis-pipeline.ts
packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts
packages/accounting/src/ports/cost-basis-persistence.ts
apps/cli/src/features/cost-basis/command/cost-basis-handler.ts
apps/cli/src/features/cost-basis/command/cost-basis-utils.ts
```

## Canada Workflow Shape

### Step 1: Build tax context

Input:

- full transaction history up to report end date
- confirmed links
- jurisdiction config
- FX provider

Output:

- `CanadaTaxInputContext`
- `CanadaTaxEvent[]`

Pseudo-code:

```ts
for each scoped transaction:
  for each movement/fee:
    taxPropertyKey = resolveCanadaTaxPropertyKey(movement)
    valuation = valueMovementInCadAtTxTime(movement, tx)
    emit CanadaTaxEvent(...)
```

### Step 2: Apply transfer semantics

Transfers between owned accounts do not realize gains/losses.

Rules:

- same-property owned transfers preserve pool economics
- transfer fees apply according to Canadian policy
- transfer events must not split identical-property pools by venue
- same-asset transfer fee adjustments must preserve link provenance; if one
  source movement maps to multiple confirmed links, emit one fee-adjustment
  event per link rather than attributing the full adjustment to the first link

### Step 3: Update ACB pools

Pseudo-code:

```ts
on acquisition:
  pool.quantityHeld += quantity
  pool.totalAcbCad += acquisitionCad + allocableFeesCad
  pool.acbPerUnitCad = pool.totalAcbCad / pool.quantityHeld

on disposition:
  costCad = quantity * pool.acbPerUnitCad
  proceedsCad = dispositionCadNet
  gainLossCad = proceedsCad - costCad
  pool.quantityHeld -= quantity
  pool.totalAcbCad -= costCad
```

### Step 4: Evaluate superficial loss

Pseudo-code:

```ts
for each loss disposition:
  reacquiredQty = quantity reacquired in [d-30, d+30]
  ownedAtEndQty = quantity still owned at d+30
  deniedQty = min(lossQty, reacquiredQty, ownedAtEndQty)
  deniedLossCad = totalLossCad * deniedQty / lossQty
  attach deniedLossCad to substituted property ACB
```

The engine must produce explicit adjustment events.

### Step 5: Build Canada tax report

The primary Canada report is already in CAD.

It should contain:

- acquisitions that affected ACB
- dispositions with proceeds, ACB, gain/loss, denied loss amounts
- superficial loss adjustments and substituted-property attachment
- transfer treatment details
- summary totals in CAD

Optional display conversions happen later and cannot change taxable results.

The report builder should consume:

- workflow calculation metadata
- `CanadaTaxInputContext`
- `CanadaAcbEngineResult`
- `CanadaSuperficialLossEngineResult`

It should not consume generic lot-matcher output types.

## Migration Plan

### Phase 1: Identity foundation

Implement:

- `resolveTaxAssetIdentity()`
- `TaxAssetIdentityPolicy`
- `resolveCanadaTaxPropertyKey()`
- fail-closed validation for unresolvable Canada tax identity

Do this before any Canada math rewrite.

Status: landed, including jurisdiction-configured relaxed symbol overrides.

### Phase 2: CAD valuation foundation

Implement:

- `CanadaTaxValuation`
- transaction-time CAD valuation builder
- audit metadata propagation

At the end of this phase, Canada events should already be expressed in CAD.

Status: landed.

### Phase 3: ACB pool engine

Implement:

- pooled ACB state
- acquisition/disposition updates
- transfer preservation

Do not implement superficial loss as a shortcut in this phase.

Status: landed for pooled ACB plus transfer-fee adjustments. Superficial loss
now layers on top of this engine rather than changing the Phase 3 pool model.

### Phase 4: Superficial loss engine

Implement:

- denied quantity calculation
- denied loss allocation
- ACB carry-forward adjustments
- audit trail output

Design constraints:

- replace the boolean `checkLossDisallowance()` model for the Canada path
- attach denied loss to explicit substituted-property rows
- compute taxable gain/loss after adjustments, not before

Status: landed for the current Canada slice. The workflow now evaluates
superficial loss over a `+30 day` lookahead window, records explicit
substituted-property attachments, and re-runs pooled ACB with the carried
forward denied loss.

### Phase 5: Reporting split

Replace the current CA report path with:

- `CanadaTaxReportBuilder` for CAD tax output
- optional display conversion builder for non-tax UI needs

Implementation notes:

- add `CanadaTaxReport` as the authoritative Canada result
- treat the existing `CostBasisReport` as display-only or retire it
- do not derive Canada summaries from `CostBasisReportGenerator`
- move CLI/JSON/TUI asset rendering to consume Canada tax rows instead of
  `lots` plus `disposals` plus `lotTransfers`
- allow `--fiat-currency USD|EUR|GBP` to project from CAD tax rows after the
  Canada report is built

Status: landed for `CA + average-cost`, including `CanadaTaxReport`, optional
`CanadaDisplayCostBasisReport`, Canada-row-based CLI rendering, and
superficial-loss-adjusted tax summaries. Remaining work is richer transfer
presentation.

### Phase 6: Cutover

Change workflow dispatch so:

- `CA` uses the new Canada workflow
- non-CA jurisdictions continue using the generic lot pipeline until their
  own jurisdiction slices exist

Detailed cutover sequence:

1. Branch early in
   `packages/accounting/src/cost-basis/orchestration/cost-basis-workflow.ts`
   on `config.jurisdiction === 'CA'`.
2. Keep
   `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
   unchanged except for constructor/wiring fallout; the handler does not need
   jurisdiction logic.
3. Load confirmed links once through
   `packages/accounting/src/ports/cost-basis-persistence.ts`.
4. For `CA + average-cost`, run `runCanadaAcbWorkflow()`, then the superficial
   loss engine, then the Canada report builder.
5. Build any non-CAD display projection from the Canada report rather than from
   USD-origin calculations.
6. Reject `fifo`, `lifo`, and `specific-id` for `CA` in validation and prompts
   once the Canada path is the only CA path; the current generic-pipeline
   fallback should be removed rather than kept as a compatibility mode.
7. Remove `CA` use of `AverageCostStrategy`, `CanadaRules`,
   `checkLossDisallowance()`, and `CostBasisReportGenerator`.

Status: partially landed. `CA + average-cost` now branches into the Canada
workflow with superficial loss and report assembly. Remaining cutover work is
to remove `CA` fallback into the generic pipeline for unsupported methods.

## Test Matrix

Minimum required cases:

- BTC bought on two exchanges pools into one Canadian ACB
- BTC moved from exchange to self-custody does not create a separate pool
- relaxed identity policy collapses exchange and on-chain `USDC` into one pool key
- strict identity policy keeps on-chain `USDC` token ids separate from exchange `USDC`
- CAD valuation differs from USD due to FX movement between buy and sell dates
- transfer fee increases ACB when policy requires it
- same source movement split across two confirmed links emits distinct
  fee-adjustment events with correct `linkId` provenance
- superficial loss with full denial
- superficial loss with partial denial
- reacquisition inside window but no holding at day `+30` does not deny
- later disposal of substituted property realizes the carried-forward denied
  loss
- `CA` workflow dispatch bypasses `runCostBasisPipeline()` entirely
- `CA` result summary is sourced from `CanadaTaxReport`, not a USD-origin
  converted report
- `CA` with `--fiat-currency USD` converts from CAD tax rows without changing
  `CanadaTaxReport.summary`
- `CA` rejects `fifo` and `lifo` after cutover
- non-CA jurisdictions continue to use the generic pipeline unchanged
- mixed transactions with excluded assets do not corrupt Canada pool state
- unresolvable Canada tax identity fails closed with explicit error
- missing CAD valuation fails closed with explicit error

## Open Questions

These are design questions, not reasons to block the document:

- whether relaxed symbol-collapse should remain a jurisdiction policy or become a
  user-visible configuration
- whether affiliated-person modeling should land in the first Canada slice or
  remain an explicit unsupported limitation
- whether Canada transfer-fee policy should stay in accounting config or be
  fully embedded in the Canada workflow

## Naming Decisions

Applied or current names in the landed slice:

- keep `assetId` for storage identity; use `assetIdentityKey` and
  `taxPropertyKey` for tax pooling
- use `remainingAllocatedAcbCad` for the layer-level projection of pooled ACB;
  `remainingCostCad` was too easy to misread as historical layer cost

Still recommended for later phases:

- split `currency` in cost-basis config into `taxCurrency` and
  `displayCurrency`
- replace `CostBasisReportGenerator` with `CanadaTaxReportBuilder` and
  `DisplayReportBuilder`
- retire or rename `CostBasisReport` once non-CA paths no longer treat it as a
  mixed tax/display artifact
- replace `isLossDisallowed()` with a richer adjustment workflow; the current
  name overstates what the function actually proves

## Recommendation

If we want Canadian correctness, we should not continue accreting logic onto
`AverageCostStrategy`, `CanadaRules`, and the existing report generator.

The right continuation from here is to finish the Canada-owned workflow on top
of the landed identity, CAD valuation, pooled ACB, transfer-fee, and
superficial-loss foundation, with the next concrete slice being:

- remove remaining `CA` fallback into the generic lot pipeline
- finish transfer presentation on top of Canada tax rows
