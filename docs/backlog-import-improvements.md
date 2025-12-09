# Import Pipeline Improvements Backlog

**Status:** Future enhancements identified during refactoring-import-pipeline.md review
**Date:** 2025-11-29

These improvements were identified as valuable but not implemented during the normalization refactor. They represent the gap between current functionality and production-ready import operations.

---

## 1. Progress Tracking with Expected Counts

**Problem:** Users have no visibility into import progress for long-running operations. Logs show "imported 1500 so far..." but no sense of completion.

**Gap:**

- Schema has no `expected_total_count` field in `import_sessions` table
- Import service doesn't query provider count endpoints before starting
- Progress logs lack percentage completion

**Proposed Solution:**

- Add optional `getTransactionCount` operation to provider capabilities
- Store `expected_total_count` in session at import start (nullable for providers without support)
- Display progress as `"150/500 (30%)"` when available, `"150 imported so far..."` otherwise

**Why Worth Keeping:**

- Significant UX improvement for multi-thousand transaction imports
- Helps identify stalled imports vs slow-but-progressing ones
- Graceful degradation for providers without count support

**Providers with Count Support:**

- Mempool.space (Bitcoin): `chain_stats.tx_count + mempool_stats.tx_count`
- Subscan (Substrate): `count` field in paginated responses

---

## 2. Explicit Reset vs Resume Modes

**Problem:** Import service always resumes from `account.lastCursor`. No way to force full reindex from genesis for recovery or audit scenarios.

**Gap:**

- `import-service.ts:93` unconditionally uses `account.lastCursor`
- No server-controlled mode flag (`incremental` vs `reindex`)
- Cannot force clean reimport without manual database edits

**Current Code:**

```typescript
// Always resumes - no genesis mode
const importParams: ImportParams = {
  ...normalizedParams,
  cursor: account.lastCursor, // Always uses last cursor
};
```

**Proposed Solution:**

- Add `mode: 'incremental' | 'reindex'` parameter to import operations
- `incremental`: Resume from `account.lastCursor` (default)
- `reindex`: Admin-only flag, starts from genesis (cursor=undefined)

**Why Worth Keeping:**

- Critical for recovery when cursor state is corrupted
- Enables audit scenarios requiring complete data refresh
- Provider failover testing and validation
- Safeguard against data drift/missing transactions

---

## 3. Canonical Deduplication Keys

**Problem:** Current dedup relies on `(data_source_id, external_id)` uniqueness. Cross-provider failover or replay windows can create duplicates when providers use different ID schemes.

**Gap:**

- Schema has no `dedup_key` column in `raw_transactions` table
- No unique index on canonical identifier: `${providerName}:${txHash}:${index}`
- Re-imports or provider switches may create silent duplicates

**Proposed Solution:**

- Add `dedup_key` column with format: `${providerName}:${txHash}:${index}`
- Add unique index on `dedup_key` (UNIQUE constraint)
- Upsert on conflict for idempotent imports

**Why Worth Keeping:**

- Prevents duplicates during cross-provider failover mid-import
- Makes re-imports safe and idempotent
- Explicit dedup contract vs implicit reliance on external_id consistency
- Essential for production reliability (financial data cannot have duplicates)

---

## 4. Processing Invariant: Normalization Only in Import

**Problem:** Processing phase falls back to `rawData` when `normalizedData` is empty, creating silent re-normalization path. No distinction between expected skips vs unexpected errors.

**Current Code (process-service.ts:259-263):**

```typescript
let normalizedData: unknown = item.normalizedData;

if (!normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0) {
  normalizedData = item.rawData; // ❌ Silent fallback - violates invariant
}
```

**Gap:**

- Processing service has fallback normalization logic (should be import-only)
- No `skipReason` field to distinguish skips from errors

**Proposed Solution:**

- Enforce INVARIANT: Processing reads `normalizedData` directly, NEVER falls back to `rawData`
- Import phase marks skips explicitly: `{ normalized: null, skipReason: "..." }`
- Processing phase fails loudly if `normalizedData` is missing (data integrity error)
- Skipped items stay in `pending` state with skip reason logged

**Why Worth Keeping:**

- Prevents silent data loss (empty normalizedData should be error, not fallback)
- Clear observability: operators can see skips vs errors in logs
- Performance: avoids double-normalization path
- Correctness: enforces single-responsibility (import normalizes, process transforms)

**Example Skip Semantics:**

```typescript
// Import phase - mark skip
if (shouldSkip(tx)) {
  return { normalized: null, raw: tx, skipReason: 'Unsupported token type' };
}

// Processing phase - fail on missing normalized data
if (!item.normalizedData) {
  throw new Error(`Missing normalized data for item ${item.id} - data integrity violation`);
}
```

---

## 5. Per-Page Observability Metrics

**Problem:** Current logs show only basic batch size. Missing metrics for debugging stalls, data quality issues, and provider performance.

**Current Logs (import-service.ts:240):**

```typescript
this.logger.info(
  `Batch saved: ${batch.rawTransactions.length} ${batch.operationType} transactions (total: ${totalImported}, cursor progress: ${batch.cursor.totalFetched})`
);
```

**Gap - Missing Metrics:**

- Validation errors per page (Zod failures)
- Skip counts per page (expected non-standard operations)
- Cursor advance time (page fetch + save duration)
- Replay window events (provider failover rewinds)

**Proposed Enhanced Logging:**

```typescript
this.logger.info({
  page: {
    size: batch.rawTransactions.length,
    validationErrors: 2, // NEW
    skips: 5, // NEW
    cursorAdvanceTimeMs: 1250, // NEW
  },
  session: {
    totalImported: 1500,
    hasMore: true,
    nextCursor: '0x...',
    progress: '1500/5000 (30%)', // From item #1
  },
});
```

**Why Worth Keeping:**

- Essential for debugging import stalls (slow provider? validation issues? network?)
- Data quality visibility (high skip rate indicates config issue)
- Provider performance comparison (which providers are fastest?)
- SRE observability for production monitoring

---

## Implementation Priority

**High Value, Lower Effort:**

1. **#4 Processing Invariant** - Fixes correctness bug, prevents silent failures
2. **#3 Canonical Dedup Keys** - Critical for production reliability

**High Value, Medium Effort:** 3. **#2 Reset vs Resume** - Important for recovery scenarios 4. **#5 Per-Page Observability** - Developer experience and debugging

**Medium Value, Medium Effort:** 5. **#1 Progress Tracking** - UX improvement, provider-dependent

---

## Notes

- All items preserve the completed normalization refactor (docs/refactoring-import-pipeline.md)
- Items are independent - can be implemented individually
- No breaking schema changes required (additive columns only)
- Focus on production-readiness vs new features

---

**Related Docs:**

- Original design: `docs/refactoring-import-pipeline.md` (sections 5.1, 5.4, 10.2)
- Current import service: `packages/ingestion/src/services/import-service.ts`
- Current process service: `packages/ingestion/src/services/process-service.ts`
