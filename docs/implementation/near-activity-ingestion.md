# NEAR Activity + Token Transfer Integration

## Overview

**Goal:** Make NEAR balance verification and cost-basis accurate by enriching transactions with native balance deltas (`accountChanges`) and NEP-141 token transfers.

**Problem:** NearBlocks deprecated `/txns` endpoint. Our current implementation only fetches basic transaction metadata, missing balance movements. This leads to mismatches (live: 231.371389 NEAR vs. calculated: –0.000021 NEAR).

**Solution:** Update NearBlocks provider to use the new multi-endpoint architecture, with all enrichment happening internally in the provider layer.

## Architecture

### Standard Operation Model

The system supports three standard blockchain operations:

1. **`getAddressTransactions`** - Native blockchain transactions (NEAR transfers, function calls)
2. **`getAddressTokenTransactions`** - Token transfers (NEP-141 fungible tokens)
3. **`getAddressInternalTransactions`** - Internal transactions (not applicable to NEAR)

### Endpoint Mapping

| NearBlocks Endpoint               | Operation                       | Purpose                                                    |
| --------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `/v1/account/{account}/txns-only` | `getAddressTransactions`        | Base transaction metadata (actions, fees, signer/receiver) |
| `/v1/account/{account}/activity`  | `getAddressTransactions` (data) | NEAR balance deltas to populate `accountChanges`           |
| `/v1/account/{account}/receipts`  | `getAddressTransactions` (data) | Receipt-level context to correlate activities to txns      |
| `/v1/account/{account}/ft-txns`   | `getAddressTokenTransactions`   | NEP-141 token transfers                                    |

### Key Principle: Provider Layer Owns Enrichment

**All provider-specific logic stays in the provider layer.** The provider internally:

- Fetches data from multiple endpoints
- Correlates activities/receipts to transactions via receipt IDs
- Maps raw API responses to normalized `NearTransaction` objects
- Returns complete transactions with `accountChanges` and `tokenTransfers` populated

**The importer never sees provider-specific types** like `NearBlocksActivity`, `NearBlocksReceipt`, etc. It only works with normalized blockchain types.

## Implementation

### 1. Provider Layer (`packages/blockchain-providers/src/blockchain/near/nearblocks/`)

**Status: Partially complete**

#### Schemas (`nearblocks.schemas.ts`)

- ✅ `NearBlocksActivitySchema` - Activity rows with INBOUND/OUTBOUND direction
- ✅ `NearBlocksFtTransactionSchema` - Token transfer data with decimals
- ✅ `NearBlocksReceiptSchema` - Receipt correlation data
- ✅ Updated `NearBlocksTransactionSchema` to use `/txns-only` endpoint

#### Mapper Utilities (`mapper-utils.ts`)

- ✅ `mapNearBlocksActivityToAccountChange()` - Converts activity → `NearAccountChange` with signed deltas
- ✅ `mapNearBlocksFtTransactionToTokenTransfer()` - Converts FT tx → `NearTokenTransfer`
- ✅ `mapNearBlocksTransaction()` - Base transaction mapping

#### API Client (`nearblocks.api-client.ts`)

**Current state:**

- ✅ Uses `/txns-only` endpoint instead of deprecated `/txns`
- ✅ Has `getAccountReceipts()`, `getAccountActivities()`, `getAccountFtTransactions()` methods
- ❌ `getAddressTransactions()` does not fetch or merge enrichment data
- ❌ No `getAddressTokenTransactions()` operation registered

**Required changes:**

1. **Update `getAddressTransactions()` to enrich internally:**

   ```typescript
   private async getAddressTransactions(params: { address: string }) {
     // 1. Fetch base transactions from /txns-only (paginated)
     // 2. Fetch activities from /activity (paginated)
     // 3. Fetch receipts from /receipts (paginated)
     // 4. Build correlation maps:
     //    - receiptId → transaction_hash (from receipts)
     //    - receiptId → activities[] (from activities)
     // 5. For each transaction:
     //    - Find receipts with matching transaction_hash
     //    - Find activities with matching receipt_id
     //    - Aggregate activities to create accountChanges[]
     //    - Use mapNearBlocksActivityToAccountChange()
     // 6. Return TransactionWithRawData<NearTransaction>[]
   }
   ```

2. **Add `getAddressTokenTransactions()` operation:**

   ```typescript
   private async getAddressTokenTransactions(params: { address: string }) {
     // 1. Fetch from /ft-txns (paginated)
     // 2. Map each FT transaction using mapNearBlocksFtTransactionToTokenTransfer()
     // 3. Return TransactionWithRawData<NearTokenTransfer>[] or similar
   }
   ```

3. **Update registration decorator:**

   ```typescript
   @RegisterApiClient({
     capabilities: {
       supportedOperations: [
         'getAddressTransactions',
         'getAddressTokenTransactions',  // ADD THIS
         'getAddressBalances'
       ],
     },
     // ... rest of config
   })
   ```

4. **Update `execute()` method:**
   ```typescript
   switch (operation.type) {
     case 'getAddressTransactions':
       return await this.getAddressTransactions({ address: operation.address });
     case 'getAddressTokenTransactions':
       return await this.getAddressTokenTransactions({ address: operation.address });
     case 'getAddressBalances':
       return await this.getAddressBalances({ address: operation.address });
   }
   ```

### 2. Importer Layer (`packages/ingestion/src/infrastructure/blockchains/near/importer.ts`)

**Required changes:**

1. **Remove all provider-specific type imports:**
   - ❌ Delete imports: `NearBlocksActivity`, `NearBlocksFtTransaction`, `NearBlocksReceipt`
   - ❌ Delete imports: `mapNearBlocksActivityToAccountChange`, `mapNearBlocksFtTransactionToTokenTransfer`
   - ✅ Only import normalized types: `NearTransaction`, `NearAccountChange`, `NearTokenTransfer`

2. **Simplify `fetchTransactionsWithEnrichment()`:**

   ```typescript
   // OLD (wrong - importer does enrichment):
   const txsResult = await getAddressTransactions();
   const activitiesResult = await getAccountActivities();
   const receiptsResult = await getAccountReceipts();
   // ... build maps, correlate, enrich ...

   // NEW (correct - provider does enrichment):
   const txsResult = await getAddressTransactions();
   // Transactions already have accountChanges populated
   return txsResult;
   ```

3. **Add token transfer fetching:**
   ```typescript
   // In fetchTransactionsWithEnrichment or separate method:
   const tokenTxsResult = await providerManager.execute({
     type: 'getAddressTokenTransactions',
     address: accountId,
   });
   // Token transfers come back normalized, ready to store
   ```

### 3. Schema Updates (`packages/blockchain-providers/src/blockchain/near/schemas.ts`)

**No changes needed.** The `NearTransaction` schema already supports:

- `accountChanges?: NearAccountChange[]`
- `tokenTransfers?: NearTokenTransfer[]`

These are optional because not all transaction types have balance changes (e.g., failed transactions).

### 4. Tests

**Provider tests (`nearblocks.api-client.test.ts`):**

- ✅ Updated to use `/txns-only` endpoint with `per_page=25`
- ✅ Tests for `getAccountReceipts()`, `getAccountActivities()`, `getAccountFtTransactions()`
- ❌ Need tests for enriched `getAddressTransactions()` returning transactions with `accountChanges`
- ❌ Need tests for `getAddressTokenTransactions()` operation

**Importer tests (`importer-enrichment.test.ts`):**

- ❌ Currently imports provider-specific types (architectural violation)
- ❌ Need to rewrite tests to mock provider returning normalized types only
- ✅ Keep tests for correlation logic if we move that to provider

**Integration tests:**

- Verify calculated balance matches live balance for test address `3c49...f5fcc`
- Verify `accountChanges` populated correctly for inbound/outbound transfers
- Verify token transfers captured separately via `getAddressTokenTransactions`

## Migration Strategy

### Phase 1: Provider Enrichment (Current)

1. ✅ Update endpoint from `/txns` → `/txns-only`
2. Implement internal enrichment in `getAddressTransactions()`
3. Add `getAddressTokenTransactions()` operation
4. Add provider-level tests

### Phase 2: Importer Cleanup

1. Remove provider-specific types from importer
2. Simplify importer to call operations and store results
3. Update importer tests to use normalized types only

### Phase 3: Verification

1. Run CLI import for test address
2. Verify balance reconciliation
3. Verify `transactions` table has populated `accountChanges` and `tokenTransfers`

## Performance Considerations

**Multi-endpoint fetching:**

- Each address import now requires 3 endpoint calls (txns-only, activities, receipts)
- Token imports add a 4th call (ft-txns)
- NearBlocks rate limit: 6 requests/minute with `per_page=25`

**Optimization strategies:**

- Fetch endpoints concurrently where possible (respect rate limits)
- Consider caching correlation maps if refetching same address
- Monitor for rate limit warnings and adjust `burstLimit` if needed

## Open Questions

1. **Should token transfers be separate transactions?**
   - Option A: Store as separate records via `getAddressTokenTransactions`
   - Option B: Include in `tokenTransfers` field of regular transactions
   - Current: Option A (follows EVM pattern)

2. **Activities with null transaction_hash:**
   - Some activities (staking rewards) don't have a parent transaction
   - Should these create synthetic transactions or be ignored?
   - Current: TBD based on testing

3. **Pagination limits:**
   - Default 1000 transactions (40 pages × 25)
   - Is this sufficient for typical NEAR addresses?
   - Current: Monitor and adjust `maxPages` if needed
