# Exchange Processor Rewrite Plan

This document lays out a greenfield rewrite plan for exchange transaction
processing in `@exitbook/ingestion`.

The current exchange processor stack is centered on a shared correlating base:

- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts)
- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts)
- [`packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts`](../../packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts)
- [`packages/ingestion/src/sources/exchanges/shared/schemas.ts`](../../packages/ingestion/src/sources/exchanges/shared/schemas.ts)

That stack made iteration fast, but it now encodes too much semantic confidence
in a generic shared layer. The Kraken AKT case exposed the core failure mode:
ambiguous same-asset, opposite-sign ledger rows can be grouped and then
materialized as a confident `transfer`, which then leaks into linking as if it
were a real transaction shape.

This plan replaces that architecture with an explicit, evidence-first pipeline
where provider facts stay raw longer, ambiguity is first-class, and only
confirmed interpretations become `ProcessedTransaction`s.

## Why This Rewrite Exists

Today the exchange processor stack makes three design mistakes:

1. it normalizes provider rows into a shape that is already too semantic
2. it uses generic grouping and classification defaults across providers with
   different ledger semantics
3. it has nowhere first-class to put ambiguity, so uncertain groups are forced
   into transaction shapes

The Kraken case is the concrete example:

- raw Kraken ledger rows already contained the suspicious `385.15553711 AKT`
  amount under a shared `refid`
- the shared correlating processor grouped those rows by `refid`
- the shared classification logic treated same-asset inflow + outflow as a
  self-transfer
- linking then saw a transaction that looked real enough to match weakly

That means the problem is not just a Kraken bug. The architecture itself is too
eager to invent meaning.

## Scope

### In Scope

- replace the current generic correlating exchange processor path with a new
  provider-event pipeline
- make ambiguity and unsupported patterns explicit processing outputs
- move provider-specific correlation and interpretation into each exchange slice
- rewrite Kraken first, then Coinbase, then KuCoin CSV
- add fixture-based tests derived from current database rows with sanitized ids
- delete shared defaults that currently infer transaction shapes too early

### Out of Scope

- redesigning the universal processed transaction schema
- changing raw import persistence structure
- redesigning linking or cost-basis behavior directly
- adding backward compatibility for legacy exchange processor internals

## Real Smells To Address

These are not optional cleanup items. The rewrite should eliminate them.

### Smell 1: `ExchangeLedgerEntry` is too semantic

Current file:

- [`packages/ingestion/src/sources/exchanges/shared/schemas.ts`](../../packages/ingestion/src/sources/exchanges/shared/schemas.ts)

The current `ExchangeLedgerEntry` shape already assumes:

- one `amount` field with direction semantics
- one `fee` field with settled meaning
- one `correlationId` that is safe for grouping
- one `type` field that maps cleanly to universal categories

That is too much interpretation for an early-stage normalized row.

Greenfield fix:

- replace it with a less opinionated `ExchangeProviderEvent`
- keep provider facts and provider hints separate from derived semantics
- make correlation evidence explicit instead of collapsing it into one string id

### Smell 2: shared defaults are classifying business meaning

Current files:

- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts)
- [`packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts`](../../packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts)

The shared layer currently decides things like:

- same-asset inflow + outflow means `transfer`
- sign conventions imply clean inflow/outflow semantics
- fees can always be interpreted as platform balance fees

Those are provider business rules, not safe defaults.

Greenfield fix:

- shared code may provide primitives, not classifications
- classification must live in provider-owned interpreters
- there must be no shared rule that turns ambiguous same-asset flow into a
  transfer

### Smell 3: ambiguity has no first-class output

Current path:

- processor returns `ProcessedTransaction[]` or `Err`

That forces uncertain groups into one of two bad outcomes:

- materialize them as wrong transactions
- fail the entire batch with no structured diagnostic

Greenfield fix:

- introduce explicit processing diagnostics
- keep `confirmed`, `ambiguous`, and `unsupported` outcomes separate
- fail closed when ambiguity is blocking, but do so with structured evidence

### Smell 4: inheritance is doing too much architectural work

Current file:

- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts)

The base class currently owns:

- row normalization orchestration
- grouping
- interpretation
- consolidation
- classification
- processed transaction materialization
- error aggregation

That makes exchange-specific behavior look configurable when it is actually
semantic.

Greenfield fix:

- prefer functional pipelines per exchange over an inheritance-heavy shared base
- shared modules should expose small pure helpers and schema contracts only
- each exchange slice should own its end-to-end processing pipeline

### Smell 5: tests overfit generic helpers instead of real provider cases

Current tests prove that the generic correlating engine behaves consistently,
but they do not protect the actual product requirement:

- do not materialize false exchange transfers from ambiguous provider rows

Greenfield fix:

- use fixture-driven provider tests based on real database examples
- sanitize ids, refids, hashes, and addresses
- verify exact processed outputs and exact diagnostics

## Target End State

After the rewrite:

- each exchange owns a provider-event normalization stage
- grouping is provider-specific and evidence-based
- interpretation returns either a confirmed transaction draft or an explicit
  diagnostic
- only confirmed drafts become `ProcessedTransaction`s
- ambiguous exchange groups never silently become `transfer`s
- logging and failure reporting include machine-usable diagnostic codes and
  evidence
- tests are built around real provider examples, not only synthetic sign-based
  unit cases

The target boundary becomes:

```text
raw provider rows
        ↓
provider event normalization
        ↓
provider-specific correlation groups
        ↓
provider-specific interpretation
   ┌───────────────┼────────────────┐
   ↓               ↓                ↓
confirmed draft  ambiguous group  unsupported pattern
   ↓               ↓                ↓
ProcessedTx      diagnostic       diagnostic
```

## Proposed Package Layout

Add a new shared kernel for exchange processing v2:

- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-correlation-group.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-correlation-group.ts)
- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-interpretation.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-interpretation.ts)
- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-processing-diagnostic.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-processing-diagnostic.ts)
- [`packages/ingestion/src/sources/exchanges/shared-v2/materialize-processed-transaction.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/materialize-processed-transaction.ts)
- [`packages/ingestion/src/sources/exchanges/shared-v2/processing-result.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/processing-result.ts)

Then each exchange owns its own vertical slice:

### Kraken

- [`packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/kraken/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/processor.ts`](../../packages/ingestion/src/sources/exchanges/kraken/processor.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/__tests__/processor.test.ts`](../../packages/ingestion/src/sources/exchanges/kraken/__tests__/processor.test.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/`](../../packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/)

### Coinbase

- [`packages/ingestion/src/sources/exchanges/coinbase/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/interpret-group.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/processor.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/processor.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/__tests__/processor.test.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/__tests__/processor.test.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/`](../../packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/)

### KuCoin CSV

- [`packages/ingestion/src/sources/exchanges/kucoin/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/interpret-group.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/processor.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/processor.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/__tests__/processor.test.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/__tests__/processor.test.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/`](../../packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/)

## New Core Shapes

### Provider Event

Add:

- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-provider-event.ts)

```ts
export interface ExchangeProviderEvent {
  providerEventId: string;
  providerName: string;
  providerType: string;
  occurredAt: number;

  assetSymbol: Currency;
  rawAmount: string;
  rawFee?: string | undefined;
  rawFeeCurrency?: Currency | undefined;

  providerHints: {
    correlationKeys: string[];
    directionHint?: 'credit' | 'debit' | 'unknown' | undefined;
    networkHint?: string | undefined;
    addressHint?: string | undefined;
    hashHint?: string | undefined;
  };

  providerMetadata: Record<string, unknown>;
}
```

Important rule:

- `rawAmount` means exactly what the provider row says
- no shared code may reinterpret sign into transaction semantics at this stage

### Correlation Group

Add:

- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-correlation-group.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-correlation-group.ts)

```ts
export interface ExchangeCorrelationGroup {
  providerName: string;
  correlationKey: string;
  events: ExchangeProviderEvent[];
  evidence: {
    sharedKeys: string[];
    assetSymbols: string[];
    directionHints: ('credit' | 'debit' | 'unknown')[];
    timeSpanMs: number;
  };
}
```

Important rule:

- grouping is allowed to say "these rows belong together"
- grouping is not allowed to claim "this is a transfer"

### Interpretation Result

Add:

- [`packages/ingestion/src/sources/exchanges/shared-v2/exchange-interpretation.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/exchange-interpretation.ts)

```ts
export interface ConfirmedExchangeTransactionDraft {
  operation: OperationClassification;
  timestamp: number;
  externalId: string;
  movements: {
    inflows: MovementInput[];
    outflows: MovementInput[];
  };
  fees: FeeInput[];
  address?: string | undefined;
  network?: string | undefined;
  hash?: string | undefined;
  evidence: {
    providerEventIds: string[];
    interpretationRule: string;
  };
}

export interface ExchangeProcessingDiagnostic {
  code:
    | 'ambiguous_same_asset_opposing_pair'
    | 'missing_direction_evidence'
    | 'contradictory_provider_rows'
    | 'unsupported_multi_leg_pattern'
    | 'provider_event_validation_failed';
  severity: 'info' | 'warning' | 'error';
  providerName: string;
  correlationKey: string;
  providerEventIds: string[];
  message: string;
  evidence: Record<string, unknown>;
}

export type ExchangeGroupInterpretation =
  | { kind: 'confirmed'; draft: ConfirmedExchangeTransactionDraft }
  | { kind: 'ambiguous'; diagnostic: ExchangeProcessingDiagnostic }
  | { kind: 'unsupported'; diagnostic: ExchangeProcessingDiagnostic };
```

Important rule:

- provider interpreters must be able to refuse classification cleanly

## Processing Contract

Keep the external processor contract compatible with the ingestion workflow:

- processor still returns `Result<ProcessedTransaction[], Error>`

But change the internal flow so diagnostics are collected before deciding whether
to fail the batch.

Add:

- [`packages/ingestion/src/sources/exchanges/shared-v2/processing-result.ts`](../../packages/ingestion/src/sources/exchanges/shared-v2/processing-result.ts)

```ts
export interface ExchangeProcessingBatchResult {
  transactions: ProcessedTransaction[];
  diagnostics: ExchangeProcessingDiagnostic[];
}
```

Provider processor pseudo-code:

```ts
export async function processKrakenRows(rawRows: KrakenLedgerEntry[]): Promise<Result<ProcessedTransaction[], Error>> {
  const events = rawRows.map(normalizeKrakenProviderEvent);
  const groups = buildKrakenCorrelationGroups(events);

  const transactions: ProcessedTransaction[] = [];
  const diagnostics: ExchangeProcessingDiagnostic[] = [];

  for (const group of groups) {
    const interpretation = interpretKrakenGroup(group);

    if (interpretation.kind === 'confirmed') {
      transactions.push(materializeProcessedTransaction(interpretation.draft));
      continue;
    }

    diagnostics.push(interpretation.diagnostic);
  }

  const blockingDiagnostics = diagnostics.filter((d) => d.severity === 'error');
  if (blockingDiagnostics.length > 0) {
    return err(buildProcessingFailureError(blockingDiagnostics));
  }

  return ok(transactions);
}
```

Important rule:

- unsupported or ambiguous cases must log structured warnings or errors
- they must never silently become transactions

## Provider-Specific Rewrite Details

### Step 1: Rewrite Kraken First

Kraken is the forcing function because it already demonstrates the core
architectural problem.

#### Files To Add

- [`packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/kraken/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts)

#### Files To Replace

- [`packages/ingestion/src/sources/exchanges/kraken/processor.ts`](../../packages/ingestion/src/sources/exchanges/kraken/processor.ts)

#### `normalizeKrakenProviderEvent()`

Function:

```ts
export function normalizeKrakenProviderEvent(
  raw: KrakenLedgerEntry,
  eventId: string
): Result<ExchangeProviderEvent, Error>;
```

Rules:

- preserve Kraken `type`, `subtype`, `refid`, `asset`, `amount`, `fee`, and
  `balance` in `providerMetadata`
- set `providerHints.correlationKeys` from `refid`
- set `directionHint` conservatively from the raw sign only as a provider hint,
  not transaction truth
- do not derive universal operation category here

#### `buildKrakenCorrelationGroups()`

Function:

```ts
export function buildKrakenCorrelationGroups(events: ExchangeProviderEvent[]): ExchangeCorrelationGroup[];
```

Rules:

- group by `refid`
- include correlation evidence such as:
  - unique assets
  - unique provider types
  - sign pattern summary
  - time span
- do not collapse or sum amounts at this stage

#### `interpretKrakenGroup()`

Function:

```ts
export function interpretKrakenGroup(group: ExchangeCorrelationGroup): ExchangeGroupInterpretation;
```

Rules:

- a single clean credit event may become `deposit`
- a single clean debit event may become `withdrawal`
- multi-asset opposite-side groups may become `swap` only with explicit provider
  support
- same-asset opposite-sign pairs must not become `transfer` by default
- if a group contains contradictory same-asset rows and no decisive evidence,
  return `ambiguous_same_asset_opposing_pair`

Specific Kraken requirement:

- the known AKT case should produce an ambiguity diagnostic, not a processed
  transfer

#### Kraken Acceptance Criteria

- the current AKT case no longer materializes as a `transfer`
- the batch logs a structured diagnostic with provider event ids and refid
- normal single-row deposits and withdrawals still process
- no shared default classifies same-asset opposite-sign Kraken pairs

### Step 2: Port Coinbase Onto The Same Pipeline

Coinbase has better transfer hints, but the rewrite should still move it onto
the same explicit event/group/interpret/materialize pipeline.

#### Files To Add

- [`packages/ingestion/src/sources/exchanges/coinbase/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/coinbase/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/interpret-group.ts)

#### Files To Replace

- [`packages/ingestion/src/sources/exchanges/coinbase/processor.ts`](../../packages/ingestion/src/sources/exchanges/coinbase/processor.ts)

Rules:

- use Coinbase-native transfer ids and reference fields as grouping evidence
- preserve provider distinctions between sends, receives, conversions, rewards,
  and fees
- do not rely on generic sign semantics when Coinbase gives explicit type data

### Step 3: Port KuCoin CSV Onto The Same Pipeline

KuCoin CSV is important because it is the only CSV exchange source and has its
own shape differences.

#### Files To Add

- [`packages/ingestion/src/sources/exchanges/kucoin/normalize-provider-event.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/normalize-provider-event.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/build-correlation-groups.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/build-correlation-groups.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/interpret-group.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/interpret-group.ts)

#### Files To Replace

- [`packages/ingestion/src/sources/exchanges/kucoin/processor-csv.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/processor-csv.ts)
- [`packages/ingestion/src/sources/exchanges/kucoin/processor-utils.ts`](../../packages/ingestion/src/sources/exchanges/kucoin/processor-utils.ts)

Rules:

- preserve KuCoin row type distinctions in provider metadata
- keep CSV-specific parsing concerns separate from semantic interpretation
- only build transfer drafts when withdrawal/deposit evidence is explicit

## Test Data Plan

Use current database cases as the source of truth for fixtures. The user already
approved this approach so long as ids are sanitized.

### Fixture Source

Use rows from `apps/cli/data/transactions.db` and the current raw exchange data
already imported there.

Recommended real cases:

- Kraken ambiguous same-asset opposite-sign pair
- Kraken clean single-row deposit
- Kraken clean single-row withdrawal
- Coinbase clean withdrawal with explicit destination metadata
- Coinbase clean deposit
- KuCoin CSV withdrawal
- KuCoin CSV deposit
- KuCoin CSV internal transfer or unsupported multi-row case

### Sanitization Rules

Before checking fixtures into git:

- replace provider event ids with deterministic fake ids
- replace `refid`s with deterministic fake refs
- replace blockchain hashes with fake hashes of the same approximate shape
- replace addresses with fake addresses of the same chain format
- remove balances if they expose real account state and are not needed for the
  test
- keep timestamps, signs, assets, and amounts unless they identify a sensitive
  real-world action

Example:

```ts
function sanitizeKrakenFixtureRow(raw: KrakenLedgerEntry): KrakenLedgerEntry {
  return {
    ...raw,
    id: `KRKN_EVT_${index}`,
    refid: `KRKN_REF_${groupIndex}`,
    balance: '0.0000000000',
  };
}
```

### Fixture Files

Add:

- [`packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/ambiguous-same-asset-opposing-pair.json`](../../packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/ambiguous-same-asset-opposing-pair.json)
- [`packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/clean-withdrawal.json`](../../packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/clean-withdrawal.json)
- [`packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/clean-deposit.json`](../../packages/ingestion/src/sources/exchanges/kraken/__tests__/fixtures/clean-deposit.json)
- [`packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/clean-withdrawal.json`](../../packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/clean-withdrawal.json)
- [`packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/clean-deposit.json`](../../packages/ingestion/src/sources/exchanges/coinbase/__tests__/fixtures/clean-deposit.json)
- [`packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/csv-withdrawal.json`](../../packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/csv-withdrawal.json)
- [`packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/csv-deposit.json`](../../packages/ingestion/src/sources/exchanges/kucoin/__tests__/fixtures/csv-deposit.json)

### Test Strategy

Each provider test file should have three layers:

1. normalization tests
2. interpretation tests
3. full processor fixture tests

Full processor fixture tests should assert both:

- exact processed transaction shape for confirmed cases
- exact diagnostic code and evidence for ambiguous cases

Do not reintroduce synthetic helper tests that only prove sign arithmetic.

## Step-By-Step Migration Plan

### Phase 0: Prepare Shared V2 Contracts

1. Add `shared-v2` types and schemas.
2. Add `materializeProcessedTransaction()` as a pure shared helper.
3. Add diagnostic logging helpers.
4. Keep existing processors unchanged in this phase.

Acceptance:

- `shared-v2` compiles with no runtime wiring changes yet

### Phase 1: Rewrite Kraken

1. Add Kraken provider-event normalization.
2. Add Kraken correlation-group builder.
3. Add Kraken interpreter.
4. Rewrite Kraken `processor.ts` to use the new pipeline.
5. Add sanitized fixture tests from current DB cases.
6. Verify the AKT ambiguous pair no longer emits a transaction.

Acceptance:

- Kraken passes targeted tests
- the AKT case emits a diagnostic instead of a transfer

### Phase 2: Rewrite Coinbase

1. Add Coinbase provider-event normalization.
2. Add Coinbase grouping and interpretation.
3. Rewrite Coinbase `processor.ts`.
4. Add sanitized fixture tests.

Acceptance:

- Coinbase behavior is preserved for known good cases
- Coinbase no longer depends on shared sign-based defaults

### Phase 3: Rewrite KuCoin CSV

1. Add KuCoin provider-event normalization.
2. Add KuCoin grouping and interpretation.
3. Rewrite `processor-csv.ts`.
4. Move or delete obsolete helper logic from `processor-utils.ts`.
5. Add sanitized fixture tests based on current DB rows.

Acceptance:

- KuCoin CSV behavior is preserved for clean transfer cases
- CSV-specific row semantics stay local to KuCoin

### Phase 4: Delete V1 Shared Correlating Stack

Delete:

- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts)
- [`packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts`](../../packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts)
- [`packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts`](../../packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts)

Then remove any tests that only exist to validate the old shared semantics.

Acceptance:

- no exchange processor depends on the old correlating base
- no shared default still classifies same-asset opposing pairs as transfers

## Open Design Decisions

These need explicit decisions during implementation, but they should be handled
inside the rewrite instead of deferred.

### Decision 1: Whether diagnostics should be persisted

Recommended answer:

- not in phase 1
- keep diagnostics in logs and processing failures first

Reason:

- the architectural bug is premature materialization, not lack of storage
- persistence can be added later if operator workflows need it

### Decision 2: Whether ambiguous groups should fail the whole batch

Recommended answer:

- yes when the ambiguity means portfolio facts would be wrong if ignored
- no when the provider row is clearly ignorable and a warning is sufficient

Implementation rule:

- let each provider interpreter set diagnostic severity
- batch processing fails on any `error` diagnostic

### Decision 3: Whether to keep a shared processor base at all

Recommended answer:

- no inheritance-heavy base
- yes to tiny pure shared helpers

Reason:

- the current problem exists because shared abstractions drifted upward into
  business semantics

## Acceptance Criteria For The Overall Rewrite

- no exchange processor materializes a `ProcessedTransaction` from an ambiguous
  same-asset opposing-sign group
- provider-specific rules live in provider directories, not in shared generic
  defaults
- sanitized real fixtures exist for Kraken, Coinbase, and KuCoin
- structured diagnostics exist for ambiguous and unsupported provider groups
- old correlating exchange base code is deleted
- targeted processor tests and full build pass

## Suggested Implementation Order

If this work is split into PRs, use this order:

1. `shared-v2` contracts and diagnostics
2. Kraken rewrite plus fixtures
3. Coinbase rewrite plus fixtures
4. KuCoin rewrite plus fixtures
5. delete v1 shared correlating stack

That order lands the architectural seam first, proves it against the real
Kraken failure, then ports the other exchanges onto the new shape.
