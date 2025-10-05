# Exchange Import Refactor Plan

## Overview

Make exchange imports resilient, self-healing, and auto-incremental. Focus on exchanges only - **do not modify blockchain logic**.

---

## 1. Resilient Validation (Store Everything)

### Problem

Currently, if validation fails during import, we lose the raw data.

### Solution

**Always store raw data, validate optimistically, retry on next import.**

#### Schema Changes

```sql
ALTER TABLE external_transaction_data
ADD COLUMN parsed_data TEXT;        -- JSON of validated data (null if validation failed)
ADD COLUMN validation_error TEXT;   -- Error details if validation failed
```

#### States

- `parsed_data = null` → Validation failed, needs retry
- `parsed_data != null` → Validation succeeded, ready for processing
- `validation_error` → Diagnostic info for debugging

#### Flow

```
Import → Validate → Store Always
         ↓           ↓
      Success?   parsed_data & validation_error
      Yes: ok    parsed_data=JSON, error=null
      No: err    parsed_data=null, error=message
```

---

## 2. Auto-Revalidation on Every Import

### Problem

When schemas are fixed, we need to manually retry failed records.

### Solution

**Every import run revalidates existing failed records first.**

#### Logic

```typescript
// Step 1: Revalidate existing records with parsed_data=null
const invalidRecords = await rawDataRepo.getRecordsNeedingValidation(importSessionId);
for (const record of invalidRecords) {
  const result = client.validate(JSON.parse(record.raw_data));
  if (result.isOk()) {
    await rawDataRepo.updateParsedData(record.id, result.value);
  }
}

// Step 2: Fetch and validate new data
const newRawData = await client.fetchTransactionData({ since });
for (const rawItem of newRawData) {
  const result = client.validate(rawItem);
  await rawDataRepo.insert({
    raw_data: JSON.stringify(rawItem),
    parsed_data: result.isOk() ? JSON.stringify(result.value) : null,
    validation_error: result.isErr() ? result.error.message : null,
  });
}
```

#### Benefits

- ✅ Fix schema → re-run import → auto-validates failed records
- ✅ No data loss
- ✅ No special commands needed

---

## 3. Auto-Incremental Imports

### Problem

Every import re-fetches all historical data from APIs.

### Solution

**Auto-calculate `since` based on last transaction timestamp with 24h replay window.**

#### Implementation

```typescript
async function determineStartDate(importSessionId: string): Promise<Date | undefined> {
  const lastTimestamp = await rawDataRepo.getLatestTimestamp(importSessionId);

  if (!lastTimestamp) return undefined; // First import - fetch all

  // 24 hour replay window (catches delayed settlements, clock skew)
  const replayWindow = 24 * 60 * 60 * 1000;
  return new Date(lastTimestamp.getTime() - replayWindow);
}
```

#### Database Support

```typescript
// RawDataRepository method
async getLatestTimestamp(importSessionId: string): Promise<Date | undefined> {
  const result = await db
    .selectFrom('external_transaction_data')
    .select('timestamp')
    .where('import_session_id', '=', importSessionId)
    .orderBy('timestamp', 'desc')
    .limit(1)
    .executeTakeFirst();

  return result?.timestamp;
}
```

#### Deduplication

```sql
-- Prevent duplicate storage
CREATE UNIQUE INDEX idx_external_tx_session_external_id
ON external_transaction_data(import_session_id, external_id);
```

#### CLI Impact

```bash
# Clean UX - just works, automatically fetches only new data
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET

# NO --since, --until, --replay-window flags for exchanges (internal concern)

# Blockchains UNCHANGED (keep --since flag)
pnpm run dev import --blockchain bitcoin --address bc1q... --since 2023-01-01
```

---

## 4. Client Validation Interface

### Problem

Validation logic needs to be portable and reusable by importers. Exchange data has different types (trade, deposit, withdrawal, etc.) that need discriminated union handling.

### Solution

**Add generic `validate()` method to `IExchangeClient` interface with discriminated union types.**

#### Interface Update

```typescript
// packages/platform/exchanges/src/types.ts
export interface IExchangeClient<TParsedData = unknown> {
  fetchTransactionData(options?: FetchOptions): Promise<unknown[]>;

  /**
   * Validate and parse raw exchange data
   * @param rawData - Untyped data from API or CSV
   * @returns Result with parsed data or validation error
   */
  validate(rawData: unknown): Result<TParsedData, Error>;
}
```

#### Schema Definition (Discriminated Union)

```typescript
// packages/platform/exchanges/src/kraken/schemas.ts
const KrakenTradeSchema = z.object({
  type: z.literal('trade'),
  refid: z.string(),
  pair: z.string(),
  // ... trade-specific fields
});

const KrakenDepositSchema = z.object({
  type: z.literal('deposit'),
  refid: z.string(),
  asset: z.string(),
  // ... deposit-specific fields
});

const KrakenWithdrawalSchema = z.object({
  type: z.literal('withdrawal'),
  refid: z.string(),
  asset: z.string(),
  // ... withdrawal-specific fields
});

// Discriminated union
export const KrakenTransactionSchema = z.discriminatedUnion('type', [
  KrakenTradeSchema,
  KrakenDepositSchema,
  KrakenWithdrawalSchema,
  // ... other types (staking, transfer, etc.)
]);

// Infer type from schema
export type ParsedKrakenData = z.infer<typeof KrakenTransactionSchema>;
// ParsedKrakenData = { type: 'trade', ... } | { type: 'deposit', ... } | ...
```

#### Client Implementation

```typescript
// packages/platform/exchanges/src/kraken/client.ts
export class KrakenClient implements IExchangeClient<ParsedKrakenData> {
  async fetchTransactionData(options?: FetchOptions): Promise<unknown[]> {
    // Fetch from API, return raw
  }

  validate(rawData: unknown): Result<ParsedKrakenData, Error> {
    try {
      const parsed = KrakenTransactionSchema.parse(rawData);
      return ok(parsed); // Type: trade | deposit | withdrawal | ...
    } catch (error) {
      return err(new Error(`Kraken validation failed: ${error.message}`));
    }
  }
}
```

#### Processor Handles Each Type

```typescript
// packages/import/src/infrastructure/exchanges/kraken/processor.ts
export class KrakenProcessor {
  transform(parsed: ParsedKrakenData): StoredTransaction {
    // TypeScript narrows type based on discriminator
    switch (parsed.type) {
      case 'trade':
        return this.mapTrade(parsed); // parsed is KrakenTrade
      case 'deposit':
        return this.mapDeposit(parsed); // parsed is KrakenDeposit
      case 'withdrawal':
        return this.mapWithdrawal(parsed); // parsed is KrakenWithdrawal
      default:
        throw new Error(`Unknown transaction type: ${parsed.type}`);
    }
  }

  private mapTrade(trade: z.infer<typeof KrakenTradeSchema>): StoredTransaction {
    // Trade-specific mapping
  }

  private mapDeposit(deposit: z.infer<typeof KrakenDepositSchema>): StoredTransaction {
    // Deposit-specific mapping
  }
  // ...
}
```

#### Benefits

- ✅ Client owns schema validation
- ✅ Type-safe discriminated unions (trade | deposit | withdrawal)
- ✅ TypeScript automatically narrows types in switch statements
- ✅ Reusable in importers and revalidation
- ✅ Each transaction type has specific fields validated

---

## 5. Process Step Simplification

### Before

```typescript
// Validation + transformation mixed
const rawData = await rawDataRepo.getPending(sessionId);
for (const raw of rawData) {
  const validated = schema.parse(raw); // Might fail here
  const tx = processor.transform(validated);
}
```

### After

```typescript
// Pure transformation (validation already done)
const validRecords = await rawDataRepo.getValidRecords(sessionId);
for (const record of validRecords) {
  const parsed = JSON.parse(record.parsed_data); // Already validated!
  const tx = processor.transform(parsed);
  await txRepo.upsert(tx);
}
```

#### Benefits

- ✅ Process step never fails on validation
- ✅ Separation of concerns
- ✅ Faster processing (no re-validation)

---

## Implementation Checklist

### Database Layer

- [ ] Migration: Add `parsed_data`, `validation_error` columns to `external_transaction_data`
- [ ] Migration: Add unique index on `(import_session_id, external_id)`
- [ ] Add `RawDataRepository.getLatestTimestamp(importSessionId)`
- [ ] Add `RawDataRepository.getRecordsNeedingValidation(importSessionId)`
- [ ] Add `RawDataRepository.getValidRecords(importSessionId)` (WHERE parsed_data IS NOT NULL)
- [ ] Update `RawDataRepository.insert()` to accept `parsed_data` and `validation_error`

### Exchange Client Interface

- [ ] Update `IExchangeClient` to include `validate(rawData: unknown): Result<T, Error>`
- [ ] Implement `validate()` in `KrakenClient`
- [ ] Implement `validate()` in any other exchange clients (KuCoin, etc.)

### Importer Logic

- [ ] Update `KrakenApiImporter` to:
  - [ ] Revalidate existing invalid records on each run
  - [ ] Validate new raw data using `client.validate()`
  - [ ] Store both `raw_data` and `parsed_data`
  - [ ] Auto-calculate `since` using `getLatestTimestamp()` with 24h replay
- [ ] Apply same pattern to other API importers (KuCoin, future exchanges)

### CLI

- [ ] Remove `--since`, `--until` flags from exchange import command
- [ ] Keep blockchain import flags unchanged

### Processor

- [ ] Update processor to only fetch records WHERE `parsed_data IS NOT NULL`
- [ ] Remove validation logic from processor (already done during import)

### Testing

- [ ] Unit test: Revalidation logic
- [ ] Unit test: Auto-incremental `since` calculation
- [ ] Unit test: Client `validate()` method
- [ ] E2E test: Import → revalidate → process flow
- [ ] E2E test: Duplicate handling with unique constraint

---

## Non-Goals (Out of Scope)

- ❌ No changes to blockchain import logic
- ❌ No configuration files for replay windows (hardcoded 24h for exchanges)
- ❌ No separate revalidation commands (auto-revalidation on import is enough)
- ❌ No changes to CSV importers (focus on API importers first)

---

## Benefits Summary

1. **Resilience**: Never lose raw data, even if validation fails
2. **Self-healing**: Schemas auto-fix on next import run
3. **Efficiency**: Only fetch new transactions (auto-incremental)
4. **Simplicity**: Clean UX with no date flags for exchanges
5. **Separation of concerns**: Validation in import, transformation in process

---

## Open Questions

- Should CSV importers also use the same validation pattern? (Currently focused on API importers)
- Do we need batch limits for revalidation (e.g., max 1000 records per run)?
