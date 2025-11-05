## Problem

`EvmTransactionProcessor` violates the **Functional Core, Imperative Shell** pattern by containing 700+ lines of business logic mixed with processor orchestration.

## Current Issues

### Location: `packages/ingestion/src/infrastructure/blockchains/evm/processor.ts`

**Extensive business logic in private methods:**
- Lines 220-500: `analyzeFundFlowFromNormalized()` - fund flow analysis
  - Lines 387-420: Movement consolidation logic
  - Lines 427-470: Primary asset selection logic
- Lines 506-632: `determineOperationFromFundFlow()` - 7 pattern matching rules (126 lines)
- Lines 680-725: `enrichTokenMetadata()` - metadata enrichment orchestration

## Proposed Solution

Create `evm-processor-utils.ts` with pure functions:

```typescript
export function consolidateEvmMovementsByAsset(
  movements: EvmMovement[]
): EvmMovement[];

export function selectPrimaryEvmMovement(
  movements: EvmMovement[],
  criteria: SelectionCriteria
): EvmMovement | null;

export function determineEvmOperationFromFundFlow(
  fundFlow: EvmFundFlow
): OperationClassification;

export function enrichTokenMetadataForTransactions(
  transactions: UniversalTransaction[],
  metadataService: ITokenMetadataService
): Promise<Result<void, Error>>;
```

## Benefits
- ✅ Test complex fund flow analysis without instantiating processor
- ✅ Reuse logic across different EVM chains
- ✅ Easier to understand pattern matching rules in isolation
- ✅ Processor becomes thin orchestrator

## Acceptance Criteria
- [ ] Extract movement consolidation to pure function
- [ ] Extract primary movement selection to pure function
- [ ] Extract operation classification to pure function
- [ ] Add comprehensive unit tests for extracted functions
- [ ] All existing tests pass

## Priority
**HIGH** - Large amount of logic, enables processor reuse

## Related Issues
- Similar refactoring needed for Solana processor
- Part of Functional Core / Imperative Shell audit
