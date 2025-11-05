## Problem

`SolanaTransactionProcessor` violates the **Functional Core, Imperative Shell** pattern by containing 740+ lines of business logic mixed with processor orchestration.

## Current Issues

### Location: `packages/ingestion/src/infrastructure/blockchains/solana/processor.ts`

**Extensive business logic in private methods:**
- Lines 248-406: `analyzeBalanceChanges()` - fund flow analysis
  - Lines 313-346: Movement consolidation logic (34 lines)
- Lines 412-594: `determineOperationFromFundFlow()` - 10 pattern matching rules (182 lines)
- Lines 599-687: Instruction detection methods (88 lines):
  - `detectStakingInstructions()` - hardcoded program IDs
  - `detectSwapInstructions()` - DEX program detection
  - `detectTokenTransferInstructions()` - token program detection
  - `detectNFTInstructions()` - NFT standard detection

## Proposed Solution

Create `solana-processor-utils.ts` with pure functions:

```typescript
export function detectSolanaStakingInstructions(
  instructions: SolanaTransaction['instructions']
): boolean;

export function detectSolanaSwapInstructions(
  instructions: SolanaTransaction['instructions']
): boolean;

export function detectSolanaTokenTransferInstructions(
  instructions: SolanaTransaction['instructions']
): boolean;

export function detectSolanaNFTInstructions(
  instructions: SolanaTransaction['instructions']
): boolean;

export function consolidateSolanaMovements(
  movements: SolanaMovement[]
): SolanaMovement[];

export function classifySolanaOperationFromFundFlow(
  fundFlow: SolanaFundFlow,
  instructions: SolanaTransaction['instructions']
): OperationClassification;
```

## Benefits
- ✅ Test instruction detection logic independently
- ✅ Easily update program ID lists without touching processor
- ✅ Pattern matching rules testable in isolation
- ✅ Processor becomes thin orchestrator

## Acceptance Criteria
- [ ] Extract all instruction detection methods to pure functions
- [ ] Extract movement consolidation to pure function
- [ ] Extract operation classification to pure function
- [ ] Add comprehensive unit tests for extracted functions
- [ ] All existing tests pass

## Priority
**HIGH** - Similar to EVM processor, high complexity

## Related Issues
- Similar refactoring needed for EVM processor
- Part of Functional Core / Imperative Shell audit
