---
status: complete
last_verified: 2026-04-27
---

# Kraken Ledger-V2 Execution Plan

## Problem

Kraken currently writes legacy `TransactionDraft` records from provider ledger
rows. The ledger rewrite needs Kraken to also emit processor-authored source
activities, journals, postings, and source component refs so exchange imports
prove the same ledger identity model used by blockchain sources.

## Current Surfaces

- Legacy Kraken processing:
  - `packages/ingestion/src/sources/exchanges/kraken/processor.ts`
  - `packages/ingestion/src/sources/exchanges/kraken/interpret-group.ts`
  - `packages/ingestion/src/sources/exchanges/kraken/build-correlation-groups.ts`
  - `packages/ingestion/src/sources/exchanges/kraken/normalize-provider-event.ts`
- Shared exchange interpretation model:
  - `packages/ingestion/src/sources/exchanges/shared/exchange-interpretation.ts`
  - `packages/ingestion/src/sources/exchanges/shared/processing-result.ts`
- Ledger persistence path:
  - `packages/ingestion/src/features/process/process-workflow.ts`
  - `packages/ingestion/src/features/process/raw-transaction-lineage.ts`
  - `packages/ingestion/src/shared/types/exchange-adapter.ts`

## Already True

- Kraken rows normalize into typed provider events with provider event ids,
  correlation keys, timestamps, amounts, fees, and provider metadata.
- The legacy interpreter already classifies deposits, withdrawals, swaps,
  dust sweeping, one-sided trade residuals, and ambiguous reversal pairs.
- `AccountingLedgerRepository.replaceForSourceActivity()` already persists
  source activities, journals, postings, source components, and raw assignments.

## Missing

- Exchange adapters cannot register a ledger-v2 processor.
- Processing workflow only creates ledger-v2 processors for blockchain accounts.
- Ledger raw binding rejects non-blockchain sources.
- Kraken has no source-activity/journal/posting assembler.

## Model

Use the existing Kraken provider-event grouping and interpretation as the
classification input, then assemble ledger drafts from the confirmed
exchange transaction draft and original provider events.

Chosen shape:

1. Add a shared exchange ledger assembler for source activity identity,
   journal-kind mapping, posting construction, diagnostics, and source component
   refs.
2. Register `KrakenProcessorV2` through the exchange adapter.
3. Let the processing workflow create exchange ledger processors when adapters
   expose them.
4. Bind exchange ledger drafts to raw rows by explicit provider event ids while
   validating that posting source components belong to the same source activity.

Rejected for now:

- Reinterpreting Kraken directly in a separate v2 classifier. That would create
  two classification paths immediately.
- Adding exchange-specific ledger tables or fake blockchain hashes. The settled
  source activity model already supports exchange provider events.

## Acceptance

- Clean Kraken deposit emits one transfer journal with one liquid principal
  posting and `raw_event` provenance.
- Clean Kraken withdrawal emits one transfer journal with principal outflow plus
  balance-settled fee posting.
- Kraken dust sweeping emits a trade journal with exchange-fill movement refs,
  fee provenance, and allocation diagnostics.
- Net-zero reversal pairs remain skipped rather than materialized.
- Representative Kraken groups reconcile against legacy liquid balance impact
  with no diffs.
- Process workflow persists Kraken ledger-v2 drafts in the same transaction as
  legacy transaction writes.
- No ledger-v2 exchange processor receives legacy scam detection hooks.
- Imported Kraken corpus reconciles across legacy processing, ledger-v2
  processing, and live Kraken balances with no diffs.

## Validation

- `pnpm vitest run packages/ingestion/src/sources/exchanges/kraken/__tests__/processor-v2.test.ts`
- `pnpm vitest run packages/ingestion/src/features/process/__tests__/raw-transaction-lineage.test.ts`
- `pnpm vitest run packages/ingestion/src/features/process/__tests__/process-workflow.test.ts`
- `pnpm -F @exitbook/ingestion lint`
- `pnpm build`

Imported-corpus validation:

- Source: local `apps/cli/data/transactions.db` Kraken account imported on
  2026-04-27.
- Raw rows: 677.
- Legacy transactions: 381.
- Ledger-v2 drafts: 381.
- Legacy balance rows: 44.
- Ledger-v2 balance rows: 44.
- Live Kraken BalanceEx assets: 8.
- Legacy-vs-ledger diffs: none.
- Legacy-vs-live diffs: none.
- Ledger-vs-live diffs: none.

This validation is intentionally not a committed test because it depends on a
private local corpus and live Kraken API credentials.
