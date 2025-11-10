# Logging in Pure Functions - Analysis Report

## Executive Summary

Found **4 files** containing pure functions (in `*-utils.ts` modules) that include logging side effects, violating the "Functional Core, Imperative Shell" pattern outlined in CLAUDE.md.

**Impact:** Low-to-moderate architectural inconsistency. These violations don't cause bugs but weaken testability and violate stated architectural principles.

## Findings

### Pattern 1: Dependency Injection (✅ Acceptable)

**File:** `packages/ingestion/src/infrastructure/exchanges/kucoin/processor-utils.ts:432`

```typescript
export function processKucoinAccountHistory(
  filteredRows: CsvAccountHistoryRow[],
  logger: Logger  // ✅ Injected dependency
): UniversalTransaction[] {
  // ...
  logger.warn(`Convert Market group missing deposit/withdrawal pair...`);
  logger.warn(`Convert Market group has unexpected number of entries...`);
}
```

**Assessment:** ✅ Acceptable approach
- Logger is a dependency injected via parameter
- Function remains testable (can pass mock logger)
- Caller controls logging behavior
- Still technically impure, but pragmatic

---

### Pattern 2: Module-Level Logger (❌ Breaks Purity)

**Files:**
1. `packages/ingestion/src/services/token-metadata/token-metadata-utils.ts:10`
2. `packages/platform/providers/src/shared/blockchain/utils/amount-utils.ts:4`

```typescript
// Module-level logger instance
const logger = getLogger('token-metadata-utils');

export async function getOrFetchTokenMetadata(...): Promise<Result<...>> {
  // ...
  logger.error({ error, blockchain, contractAddress }, 'Failed to cache token metadata...');
  // ...
}

export async function enrichTokenMetadataBatch<T>(...): Promise<Result<void, Error>> {
  // ...
  logger.warn({ error, blockchain, contractAddress }, 'Failed to fetch token metadata...');
  logger.warn({ successCount, failureCount, blockchain }, 'Partial failure...');
  // ...
}
```

```typescript
const logger = getLogger('amount-utils');

export function normalizeTokenAmount(amount: string | undefined, decimals?: number): string {
  try {
    // ...
  } catch (error) {
    logger.warn(`Unable to normalize token amount: ${String(error)}`);
    return '0';
  }
}
```

**Assessment:** ❌ Violates purity
- Module-level side effect on import
- Cannot test without observing logs
- Hidden dependency not visible in function signature

---

### Pattern 3: Function-Level Logger (❌ Breaks Purity)

**File:** `packages/platform/providers/src/blockchain/cosmos/providers/injective-explorer/injective-explorer.mapper-utils.ts:29`

```typescript
export function mapInjectiveExplorerTransaction(
  rawData: InjectiveApiTransaction,
  sourceContext: SourceMetadata
): Result<CosmosTransaction, NormalizationError> {
  const logger = getLogger('InjectiveExplorerMapperUtils');  // ❌ Created inside function

  // ...
  logger.debug(`Skipping message: ${message.type} in tx ${rawData.hash}`);
  // ...
  logger.debug(`Skipping unsupported message type "${message.type}"...`);
  // ...
}
```

**Comment in file (line 22):** `"Pure function for Injective Explorer transaction mapping"`

**Assessment:** ❌ False claim of purity
- Function explicitly labeled as "pure" but contains side effects
- Creates logger on every invocation (performance concern)
- Cannot unit test without observing logs

---

## Logging Usage Breakdown

| File | Function(s) | Log Levels | Pattern |
|------|------------|-----------|---------|
| `kucoin/processor-utils.ts` | `processKucoinAccountHistory` | `warn` (2x) | ✅ DI |
| `injective-explorer/injective-explorer.mapper-utils.ts` | `mapInjectiveExplorerTransaction` | `debug` (2x) | ❌ Function-level |
| `token-metadata/token-metadata-utils.ts` | `getOrFetchTokenMetadata`, `enrichTokenMetadataBatch` | `error` (1x), `warn` (3x) | ❌ Module-level |
| `blockchain/utils/amount-utils.ts` | `normalizeTokenAmount`, `normalizeNativeAmount` | `warn` (2x) | ❌ Module-level |

---

## Why This Matters

### 1. **Testability**
Pure functions with logging are harder to test:
```typescript
// Cannot assert on logs without complex test infrastructure
test('should log warning on invalid amount', () => {
  normalizeTokenAmount('invalid', 18);
  // How do we check if logger.warn was called?
});
```

### 2. **Architectural Consistency**
CLAUDE.md explicitly states:
> **Functional Core, Imperative Shell:** Extract business logic into pure functions in `*-utils.ts` modules.

These violations undermine the architecture.

### 3. **Hidden Dependencies**
Functions appear pure in signature but have hidden side effects:
```typescript
// Looks pure but logs internally
function normalizeTokenAmount(amount: string, decimals?: number): string
```

---

## Recommendations

### Option A: Remove Logging from Pure Functions (Strictest)

**Move logging to callers** (imperative shell):

```typescript
// BEFORE (in utils)
export function normalizeTokenAmount(amount: string, decimals?: number): string {
  try {
    return parseDecimal(amount).dividedBy(parseDecimal('10').pow(decimals)).toFixed();
  } catch (error) {
    logger.warn(`Unable to normalize: ${String(error)}`);  // ❌ Side effect
    return '0';
  }
}

// AFTER (in utils - pure)
export function normalizeTokenAmount(amount: string, decimals?: number): Result<string, Error> {
  try {
    const result = parseDecimal(amount).dividedBy(parseDecimal('10').pow(decimals)).toFixed();
    return ok(result);
  } catch (error) {
    return err(wrapError(error, 'Unable to normalize token amount'));  // ✅ Pure
  }
}

// AFTER (in caller - imperative)
const result = normalizeTokenAmount(amount, decimals);
if (result.isErr()) {
  logger.warn({ error: result.error, amount, decimals }, 'Normalization failed');  // ✅ Logging in shell
  amount = '0';
}
```

**Pros:**
- True purity
- Testable without mocks
- Clear separation of concerns
- Errors propagate to caller for handling

**Cons:**
- Requires refactoring (medium effort)
- More verbose caller code
- May lose contextual logging (callers must add context)

---

### Option B: Dependency Injection (Pragmatic)

**Pass logger as parameter** (like KuCoin):

```typescript
// BEFORE
const logger = getLogger('amount-utils');
export function normalizeTokenAmount(amount: string, decimals?: number): string {
  logger.warn('...');
}

// AFTER
export function normalizeTokenAmount(
  amount: string,
  decimals: number | undefined,
  logger: Logger  // ✅ Injected
): string {
  logger.warn('...');
}
```

**Pros:**
- Testable (can inject mock logger)
- Minimal refactoring
- Maintains current error handling
- Explicit dependency

**Cons:**
- Still technically impure (side effects)
- Adds parameter to every function needing logs
- Verbose function signatures

---

### Option C: Hybrid Approach (Recommended)

**Combine both strategies based on context:**

1. **Error/exceptional cases:** Use `Result<T, Error>` + remove logging
   - Example: `normalizeTokenAmount`, `normalizeNativeAmount`
   - Rationale: Errors should propagate, caller decides logging

2. **Informational/debug logging:** Use dependency injection
   - Example: `mapInjectiveExplorerTransaction` (debug logs)
   - Rationale: Not error cases, just diagnostic info

3. **Business logic decisions:** Remove logging entirely
   - Example: `enrichTokenMetadataBatch` warnings about failures
   - Rationale: Return detailed results, let caller log

**Implementation Priority:**

**High Priority:**
1. ✅ Keep `kucoin/processor-utils.ts` as-is (already uses DI)
2. 🔧 Fix `injective-explorer.mapper-utils.ts`:
   - Remove "Pure function" comment (misleading)
   - Add `logger: Logger` parameter OR remove debug logs (they return `err()` anyway)
3. 🔧 Fix `amount-utils.ts`:
   - Return `Result<string, Error>` instead of `'0'` fallback
   - Remove module-level logger
   - Let callers handle logging

**Medium Priority:**
4. 🔧 Fix `token-metadata-utils.ts`:
   - `getOrFetchTokenMetadata`: Keep error handling, remove `.error()` log (already returns `err`)
   - `enrichTokenMetadataBatch`: Return enriched `Result` with failure details, let caller log

---

### Option D: Accept Current State (Not Recommended)

**Update CLAUDE.md** to acknowledge logging in utils is acceptable.

**Pros:**
- No code changes needed
- Reflects current practice

**Cons:**
- Weakens architectural principles
- Reduces testability
- Sets bad precedent for future code

---

## Recommended Action Plan

### Phase 1: Quick Wins (1-2 hours)
1. Fix misleading comment in `injective-explorer.mapper-utils.ts:22`
2. Add `logger: Logger` parameter to `mapInjectiveExplorerTransaction`
3. Document acceptable logging patterns in CLAUDE.md

### Phase 2: Refactor Critical Paths (2-4 hours)
1. Convert `amount-utils.ts` functions to return `Result<string, Error>`
2. Update all callers to handle results + log errors
3. Add tests confirming new behavior

### Phase 3: Systematic Cleanup (4-8 hours)
1. Audit all `*-utils.ts` files for logging
2. Apply hybrid approach consistently
3. Add linting rule to detect `getLogger` in utils files (optional)

---

## Testing Recommendations

### Before Refactor
Limited testability:
```typescript
// Can't verify logging without complex setup
test('logs warning on error', () => {
  normalizeTokenAmount('invalid', 18);
  // ???
});
```

### After Refactor (Option A)
```typescript
test('returns error on invalid amount', () => {
  const result = normalizeTokenAmount('invalid', 18);
  expect(result.isErr()).toBe(true);
  expect(result.error.message).toContain('Unable to normalize');
});
```

### After Refactor (Option B)
```typescript
test('logs warning on error', () => {
  const mockLogger = { warn: vi.fn() };
  normalizeTokenAmount('invalid', 18, mockLogger);
  expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unable to normalize'));
});
```

---

## Conclusion

The codebase has **4 instances** of logging in pure functions, representing a minor but meaningful violation of stated architectural principles.

**Recommended Path Forward:**
1. **Short-term:** Fix misleading comments + apply DI to `injective-explorer.mapper-utils.ts`
2. **Medium-term:** Refactor `amount-utils.ts` to return `Result` types
3. **Long-term:** Systematically audit and refactor using hybrid approach
4. **Documentation:** Update CLAUDE.md with explicit guidance on logging in utils

**Estimated Effort:**
- Critical fixes: 2-3 hours
- Full cleanup: 8-12 hours
- Marginal benefit: Improved testability, architectural consistency

**Priority:** Medium (not blocking but addresses technical debt)
