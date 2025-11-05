## Problem

Several utility "classes" are implemented as static method containers instead of pure function modules, violating the **Functional Core, Imperative Shell** pattern.

## Current Issues

### 1. CsvParser (`packages/ingestion/src/infrastructure/exchanges/shared/csv-parser.ts`)
**Lines 8-70** - Static utility class:
```typescript
export class CsvParser {
  static async getHeaders(filePath: string): Promise<string> { ... }
  static async parseFile<T>(filePath: string): Promise<T[]> { ... }
  static async validateHeaders(...): Promise<string> { ... }
}
```

### 2. CsvFilters (`packages/ingestion/src/infrastructure/exchanges/shared/csv-filters.ts`)
**Lines 4-84** - Static utility class:
```typescript
export class CsvFilters {
  static filterByField<T>(rows: T[], field: K, value?: T[K]): T[] { ... }
  static filterByFields<T>(rows: T[], filters): T[] { ... }
  // ... 4 more static methods
}
```

### 3. CoinbaseGrossAmountsStrategy (`packages/ingestion/src/infrastructure/exchanges/shared/strategies/interpretation.ts`)
**Lines 114-221** - Strategy as class with single method:
```typescript
class CoinbaseGrossAmountsStrategy implements InterpretationStrategy<CoinbaseLedgerEntry> {
  interpret(entry, group): LedgerEntryInterpretation { ... }
  private shouldIncludeFeeForEntry(entry, group): boolean { ... }
}
```

## Proposed Solution

### Convert static classes to function modules:

**`csv-parser-utils.ts`**
```typescript
export async function getCsvHeaders(filePath: string): Promise<string> { ... }
export async function parseCsvFile<T>(filePath: string): Promise<T[]> { ... }
export async function validateCsvHeaders(...): Promise<string> { ... }
```

**`csv-filters-utils.ts`**
```typescript
export function filterCsvByField<T, K extends keyof T>(
  rows: T[],
  field: K,
  value?: T[K]
): T[] { ... }

export function filterCsvByFields<T>(
  rows: T[],
  filters: Partial<Record<keyof T, unknown>>
): T[] { ... }
```

**`interpretation-strategies.ts`**
```typescript
// Pure function helpers
function shouldIncludeFeeForCoinbaseEntry(
  entry: RawTransactionWithMetadata<CoinbaseLedgerEntry>,
  group: RawTransactionWithMetadata<CoinbaseLedgerEntry>[]
): boolean { ... }

// Strategy as pure function object
export const coinbaseGrossAmounts: InterpretationStrategy<CoinbaseLedgerEntry> = {
  interpret(entry, group): LedgerEntryInterpretation {
    const shouldIncludeFee = shouldIncludeFeeForCoinbaseEntry(entry, group);
    // ... rest of logic
  }
};
```

## Benefits
- ✅ Clarifies that these are pure functions, not resource managers
- ✅ No need to instantiate classes for stateless operations
- ✅ Follows established patterns in codebase (balance-calculator, etc.)
- ✅ More idiomatic TypeScript/JavaScript

## Acceptance Criteria
- [ ] Convert CsvParser to function exports
- [ ] Convert CsvFilters to function exports
- [ ] Convert CoinbaseGrossAmountsStrategy to pure function object
- [ ] Update all call sites
- [ ] All existing tests pass

## Priority
**MEDIUM** - Quick wins, lower risk than processor refactorings

## Related Issues
Part of Functional Core / Imperative Shell audit
