## Problem

`CorrelatingExchangeProcessor` violates the **Functional Core, Imperative Shell** pattern by containing extensive business logic in private methods.

## Current Issues

### Location: `packages/ingestion/src/infrastructure/exchanges/shared/correlating-exchange-processor.ts`

**Business logic in private methods (over 250 lines):**
- Lines 329-373: `selectPrimaryMovement()` - pure sorting/selection logic (45 lines)
- Lines 378-386: `detectClassificationUncertainty()` - pure classification check (9 lines)
- Lines 391-399: `determinePrimaryDirection()` - pure direction determination (9 lines)
- Lines 404-441: `consolidateMovements()` - pure consolidation (38 lines)
- Lines 447-476: `consolidateFees()` - pure consolidation (30 lines)
- Lines 208-313: `determineOperationFromFundFlow()` - pure classification (105 lines)

## Proposed Solution

Create `correlating-exchange-processor-utils.ts` with pure functions:

```typescript
export function selectPrimaryMovement(
  movements: MovementInput[],
  criteria: SelectionCriteria
): MovementInput | null;

export function consolidateExchangeMovements(
  movements: MovementInput[]
): MovementInput[];

export function consolidateExchangeFees(
  fees: FeeInput[]
): FeeInput[];

export function classifyExchangeOperationFromFundFlow(
  fundFlow: ExchangeFundFlow
): OperationClassification;

export function detectExchangeClassificationUncertainty(
  fundFlow: ExchangeFundFlow
): boolean;

export function determinePrimaryDirection(
  inflows: MovementInput[],
  outflows: MovementInput[]
): 'inflow' | 'outflow' | 'neutral';
```

## Benefits
- ✅ Test consolidation logic without processor instantiation
- ✅ Pattern matching rules testable in isolation
- ✅ Logic reusable across different exchange processors
- ✅ Processor becomes thin orchestrator

## Acceptance Criteria
- [ ] Extract all private methods to pure functions
- [ ] Processor delegates to pure functions
- [ ] Add unit tests for extracted functions (no mocks)
- [ ] All existing tests pass

## Priority
**HIGH** - Core exchange processing logic

## Related Issues
Part of Functional Core / Imperative Shell audit
