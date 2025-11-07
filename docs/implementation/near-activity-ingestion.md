# NEAR Activity + Token Transfer Integration

## Overview

- **Goal:** make NEAR balance verification and cost-basis accurate by enriching normalized transactions with native balance deltas (`accountChanges`) and NEP-141 token transfers (`tokenTransfers`).
- **Why now:** NearBlocks deprecated the `/txns` endpoint and recommends `/txns-only`, `/receipts`, `/activity`, and `/ft-txns`. Our current mapper only consumes `/txns`, so every processed transaction lacks balance movements, leading to balance mismatches (live: 231.371389 NEAR vs. calculated: –0.000021 NEAR).
- **Desired outcome:** a reworked provider/importer pipeline that stitches the four endpoints per address, producing complete `NearTransaction` objects so `analyzeNearFundFlow` can compute inflows/outflows with no fallback heuristics.

## Current Limitations

1. `mapNearBlocksTransaction` only copies top-level action/fee info; `accountChanges` and `tokenTransfers` remain undefined.
2. Processor relies exclusively on `accountChanges` to determine NEAR inflows/outflows. With an empty array it records zero movements and only captures network fees.
3. Cost-basis and balance reconciliation therefore collapse to fees-only, and sessions persist mismatches even though the raw chain data contains the correct balances.

## Target Data Sources

| Endpoint                          | Purpose                         | Notes                                                                                                                                               |
| --------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/account/{account}/txns-only` | Base transaction metadata       | Replace existing `/txns` pagination. Includes actions, fee aggregates, signer/receiver.                                                             |
| `/v1/account/{account}/receipts`  | Receipt-level execution context | Use to map receipt IDs → transaction hash, executor, gas burned. Needed to correlate activities.                                                    |
| `/v1/account/{account}/activity`  | Native NEAR balance deltas      | Provides `direction`, `absolute_nonstaked_amount`, and counterparty for every receipt affecting the account. Converts directly to `accountChanges`. |
| `/v1/account/{account}/ft-txns`   | NEP-141 transfers               | Provides contract address, sender, receiver, raw amount, decimals. Maps to `tokenTransfers` entries used by processor-utils.                        |

## Implementation Plan

### 1. Provider Layer (`packages/platform/providers/src/blockchain/near`)

1. **Schemas:**
   - Add Zod schemas for the new endpoints (activity + ft transactions + receipts-without-tx hash if not already defined) in `nearblocks/nearblocks.schemas.ts`.
   - Include direction enums (`INBOUND`/`OUTBOUND`) and numeric strings for yocto amounts.
2. **Mapper Utilities:**
   - Add helpers to convert activity rows → `NearAccountChange` with signed yocto deltas → NEAR decimals.
   - Add helpers to convert ft transactions → `NearTokenTransfer` (normalize amounts by decimals, handle missing symbols using contract addresses).
3. **API Client:**
   - Extend `NearBlocksApiClient` with operations `getAccountReceipts`, `getAccountActivities`, `getAccountFtTransactions`.
   - Update `execute` to allow a combined multi-fetch (or expose dedicated methods the importer can call directly).
   - Ensure pagination (all endpoints appear to mirror `/txns` pagination). Respect existing rate-limit config.
4. **Return Type:**
   - Introduce a new provider-level DTO (e.g., `NearBlocksAccountDataPackage`) bundling transactions, receipts, activities, and ft transfers keyed by transaction hash. This keeps importer logic straightforward while preserving API boundaries.

### 2. Ingestion Layer (Importer) (`packages/ingestion/src/infrastructure/blockchains/near/importer.ts`)

1. After `getAddressTransactions`, invoke new provider methods to fetch receipts, activities, and ft transfers for the same address and time window.
2. Build an in-memory index:
   - `txHash → receipts[]`
   - `receiptId → activities[]`
   - `txHash → ftTransfers[]`
3. For each base transaction:
   - Attach `accountChanges` derived by aggregating activities whose `receipt_id` links to the transaction. Convert yocto strings to NEAR decimals and compute signed deltas: inbound → positive, outbound → negative.
   - Attach `tokenTransfers` derived from `ft-txns` entries where `transaction_hash` matches.
4. Preserve provider provenance (include `providerName` in new metadata) before handing the enriched `NearTransaction` to the processor.

### 3. Processor Layer (`packages/ingestion/src/infrastructure/blockchains/near/processor-utils.ts`)

1. Confirm `analyzeNearBalanceChanges` can consume the new `accountChanges` shape (if we change schema). Update types if necessary.
2. Ensure token transfers populated from `/ft-txns` propagate through `extractNearTokenTransfers`.
3. Add regression tests covering:
   - Simple inbound transfer (activity direction INBOUND, no tokens).
   - Outbound transfer with fee (activity OUTBOUND + fee deduction).
   - Token swap (token transfer inflow/outflow + NEAR fee-only activity) to validate multi-asset fund flow.

### 4. Data Schema & Types (`packages/platform/providers/src/blockchain/near/schemas.ts`)

1. Extend `NearAccountChange` to allow optional `direction` / `delta` fields if we cannot compute `preBalance`/`postBalance`. Processor currently expects pre/post strings; if the API does not supply them, store `preBalance`/`postBalance` as synthesized cumulative values (e.g., treat `preBalance = delta < 0 ? |delta| : '0'` etc.) and document the convention.
2. Update `NearTransactionSchema` to require `accountChanges` when the user is involved to catch regressions.

### 5. Tests

1. **Provider tests:**
   - Unit tests for new schema parsers and mapper functions (activity → account change, ft tx → token transfer).
   - Update `nearblocks.api-client.test.ts` to cover the additional HTTP calls and pagination logic.
2. **Ingestion tests:**
   - Extend `packages/ingestion/.../__tests__/importer.test.ts` with fixture data representing the four endpoints to ensure the importer emits enriched transactions.
   - Add processor integration tests verifying calculated balances for the sample address now match the sum of activity deltas.

### 6. Rollout & Verification

1. Re-run `pnpm run dev import --blockchain near --address <address> --process` and verify the session summary now shows matching calculated/live balances.
2. Add a regression CLI test (or documented manual step) using the provided address `3c49...f5fcc` to demonstrate parity with live balance 231.3713894597364556 NEAR.
3. Monitor logs for rate-limit warnings; NearBlocks endpoints may require increasing burst limits once we hit four endpoints per address.

## Validation Checklist

- [ ] `npm run lint` passes (schema updates).
- [ ] `pnpm test` passes (new provider + importer tests).
- [ ] Manual CLI balance check matches live value for at least one historical address.
- [ ] Database `transactions.movements_*` columns show inflow/outflow JSON entries instead of null.

## Open Questions / Risks

1. **Pagination volume:** Need to confirm `activity` and `ft-txns` endpoints expose enough history (≥ 1000 rows) or provide cursors. If not, importer must page until empty response, similar to `txns`.
2. **Pre/post balances:** Activity payloads only provide absolute deltas, not `preBalance`. If that becomes an issue, revisit processor to accept signed deltas directly instead of pre/post values.
3. **Token metadata:** `/ft-txns` does not supply symbol/decimals consistently. Continue using contract metadata service if symbol missing; store contract address in `tokenTransfers.contractAddress` for lookup.
4. **Performance:** Fetching four endpoints sequentially may increase import time. Consider concurrency inside provider manager, but keep requests serialized per provider until rate-limit behavior is confirmed.

## Next Steps

1. Approve this plan.
2. Implement provider-layer changes, then importer, then processor tests.
3. Re-run NEAR balance verification to confirm parity.
