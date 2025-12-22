# Implementation: EVM Hash-Grouping Fix

## Goal

Fix balance mismatches by ensuring all raw events sharing the same `blockchain_transaction_hash` are processed together.

## Changes Required

### 1. Repository Layer

**File:** `packages/data/src/repositories/raw-data-repository.ts`

- [ ] Add method `loadPendingByHashBatch(accountId: number, hashLimit: number)`
  - Returns all pending raw rows for the first N distinct transaction hashes
  - Uses CTE query from spec (lines 54-66)
  - Add to `IRawDataRepository` interface

### 2. Service Layer

**File:** `packages/ingestion/src/features/process/process-service.ts`

- [ ] Update `processAccountTransactionsChunked()` method (lines 204-305)
  - Replace `load()` call with `loadPendingByHashBatch()`
  - Change constant: `RAW_DATA_LOAD_CHUNK_SIZE = 1000` → `RAW_DATA_HASH_BATCH_SIZE = 100`
  - Loop until `loadPendingByHashBatch()` returns empty array
  - Keep everything else (marking processed, saving, error handling)

### 3. Testing

**Files:** `packages/data/src/repositories/__tests__/raw-data-repository.test.ts`

- [ ] Add test: multiple hashes with multiple events each
- [ ] Verify all events for same hash are returned together
- [ ] Verify hash limit is respected

**Files:** `packages/ingestion/src/features/process/__tests__/process-service.test.ts`

- [ ] Add test: chunking doesn't split same-hash events
- [ ] Verify existing tests still pass

## SQL Query Template

```sql
WITH hashes AS (
  SELECT DISTINCT blockchain_transaction_hash
  FROM raw_transactions
  WHERE account_id = ? AND processing_status = 'pending'
  ORDER BY blockchain_transaction_hash
  LIMIT ?
)
SELECT rt.*
FROM raw_transactions rt
JOIN hashes h ON rt.blockchain_transaction_hash = h.blockchain_transaction_hash
WHERE rt.account_id = ? AND rt.processing_status = 'pending'
ORDER BY rt.blockchain_transaction_hash, rt.id;
```

## Verification

- [ ] Run `pnpm test`
- [ ] Run `pnpm build`
- [ ] Test with real EVM account that had balance mismatch
- [ ] Check balance.txt shows resolved mismatch

## Notes

- Non-blockchain accounts (exchanges) unaffected - use different code path
- All blockchains (Solana, Near, etc.) benefit from same fix
- No database migration needed
