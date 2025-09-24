# Research: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)

**Branch**: `003-replace-universaltransaction-with` | **Date**: 2025-09-24 | **Phase**: 0

## Executive Summary

Research confirms that the current `UniversalTransaction` architecture mixes "what happened" (money flows) with "why it happened" (purposes) in a single type, creating ambiguity for downstream accounting systems. The proposed `ProcessedTransaction` + Purpose Classifier architecture will provide clear separation of concerns while leveraging existing strengths in error handling (neverthrow), financial precision (Decimal.js), and deterministic processing patterns.

## Current Architecture Analysis

### UniversalTransaction Limitations

**Decision**: Replace `UniversalTransaction` with `ProcessedTransaction` + Purpose Classifier
**Rationale**: Current architecture conflates movement descriptions with business purposes
**Alternatives considered**: Extend UniversalTransaction vs Clean slate replacement

**Current Structure Problems**:

- Single `fee?: Money` field cannot represent multi-fee transactions (e.g., Kraken trades with both trading fees and withdrawal fees)
- `TransactionType` enum mixes movement types (`'deposit'`, `'withdrawal'`) with purposes (`'fee'`, `'trade'`)
- No support for complex transactions requiring multiple movements (DeFi operations, multi-leg trades)
- Classification logic scattered across individual processors rather than centralized

**Key Integration Points** (`packages/core/src/types.ts:238-261`):

```typescript
export interface UniversalTransaction {
  amount: Money; // Primary amount only
  fee?: Money | undefined; // Single optional fee
  type: TransactionType; // Mixed concerns
  // ... other fields
}
```

### Existing Financial Precision Patterns

**Decision**: Continue using Decimal.js for all financial calculations
**Rationale**: Mature 28-precision decimal arithmetic already proven in production
**Alternatives considered**: BigNumber.js, native BigInt (rejected due to limited decimal support)

**Current Implementation** (`packages/shared/utils/src/decimal-utils.ts`):

```typescript
Decimal.set({
  precision: 28, // Crypto-grade precision
  rounding: Decimal.ROUND_HALF_UP, // Consistent rounding
});

export function createMoney(amount: string | Decimal, currency: string): Money {
  return {
    amount: parseDecimal(amount), // High-precision Decimal
    currency: currency || 'unknown',
  };
}
```

### Error Handling Architecture

**Decision**: Use neverthrow Result types with specific error hierarchies
**Rationale**: 135+ files already use neverthrow; mature patterns for error composition
**Alternatives considered**: Throwing exceptions, generic Result<T, string> (rejected for poor error handling)

**Current Best Practices** (from BaseRawDataMapper):

```typescript
map(rawData: TRawData, context: ImportSessionMetadata): Result<UniversalBlockchainTransaction[], string> {
  const validationResult = this.schema.safeParse(rawData);
  if (!validationResult.success) {
    return err(`Invalid ${this.constructor.name} data: ${errors.join(', ')}`);
  }
  return this.mapInternal(validationResult.data as TRawData, context);
}
```

**Recommended Enhancement**: Specific error type hierarchy

```typescript
export abstract class ProcessingError extends Error {
  abstract readonly code: string;
  abstract readonly severity: 'error' | 'warning';
}

export class ValidationError extends ProcessingError {
  /* ... */
}
export class ClassificationError extends ProcessingError {
  /* ... */
}
export class BalanceError extends ProcessingError {
  /* ... */
}
```

## Purpose Classification Research

### Current Classification Limitations

**Decision**: Implement centralized Purpose Classifier service
**Rationale**: Current type mapping logic scattered across processors; inconsistent classification
**Alternatives considered**: Extend TransactionType enum (rejected - still mixes concerns)

**Current Scattered Logic** (from BaseProcessor):

```typescript
protected mapTransactionType(
  blockchainTransaction: UniversalBlockchainTransaction,
  sessionContext: ImportSessionMetadata
): TransactionType {
  // Processor-specific logic determines:
  // - 'deposit': funds coming into wallet
  // - 'withdrawal': funds leaving wallet
  // - 'transfer': internal movement
  // - 'fee': fee-only transaction
}
```

**Problems with Current Approach**:

- Each processor implements own classification logic
- No consistency guarantees across providers
- Cannot handle transactions with multiple purposes (trade + fee)
- Classification tied to processor implementation rather than business rules

### Proposed Three-Purpose Model

**Decision**: Support exactly three purposes: PRINCIPAL, FEE, GAS
**Rationale**: MVP scope covers 95% of transaction types; avoids over-engineering
**Alternatives considered**: Broader purpose taxonomy (rejected for MVP scope)

**Purpose Definitions**:

- `PRINCIPAL`: Core business movement (trade, transfer, deposit, withdrawal)
- `FEE`: Exchange or service fees (trading fees, withdrawal fees)
- `GAS`: Blockchain execution costs (Ethereum gas, Bitcoin mining fees)

**Classification Confidence Model**:

```typescript
export interface ClassificationInfo {
  purpose: 'PRINCIPAL' | 'FEE' | 'GAS';
  ruleId: string; // Which rule determined classification
  version: string; // Classifier version for historical tracking
  reasoning: string; // Human-readable explanation
  confidence: number; // 0-1 score (accept all for MVP)
}
```

## Fee Handling Research

### Current Fee Processing Patterns

**Current Ethereum Gas Handling** (MoralisMapper.ts):

```typescript
const gasPrice = parseDecimal(tx.gas_price);
const gasUsed = parseDecimal(tx.receipt_gas_used);
const feeWei = gasPrice.mul(gasUsed);
const feeEth = feeWei.dividedBy(new Decimal(10).pow(18));

return {
  feeAmount: feeEth.toString(),
  feeCurrency: 'ETH',
};
```

**Current Kraken Fee Handling** (KrakenProcessor.ts):

```typescript
let totalFee = '0';
let feeAsset = spend.asset;

if (!parseDecimal(spendFee).isZero()) {
  totalFee = spendFee;
  feeAsset = spend.asset;
} else if (!parseDecimal(receiveFee).isZero()) {
  totalFee = receiveFee;
  feeAsset = receive.asset;
}
```

**Problems with Current Approach**:

- Fees embedded in single optional field
- Cannot represent multiple fee types in one transaction
- Complex logic for determining fee currency and source
- Inconsistent handling between blockchain and exchange fees

**Proposed Movement-Based Approach**:

```typescript
// Kraken spot trade with fee
const movements: MovementUnclassified[] = [
  { amount: createMoney('100', 'USD'), direction: 'out', asset: 'USD' }, // Spend USD
  { amount: createMoney('0.001', 'BTC'), direction: 'in', asset: 'BTC' }, // Receive BTC
  { amount: createMoney('0.5', 'USD'), direction: 'out', asset: 'USD' }, // Trading fee
];

// After classification:
// Movement 1: PRINCIPAL (spend)
// Movement 2: PRINCIPAL (receive)
// Movement 3: FEE (trading fee)
```

## Deterministic Processing Research

### Current Consistency Patterns

**Decision**: Maintain existing deterministic processing with enhanced guarantees
**Rationale**: System already provides reproducible results; extend with classification versioning
**Alternatives considered**: Best-effort classification (rejected - reduces system reliability)

**Current Deterministic Elements**:

- Zod schema validation provides consistent data structures
- Provider registry ensures consistent mapper selection
- Decimal.js eliminates floating-point inconsistencies
- Session context preserves processing environment

**Enhancement Required**: Classification Rule Versioning

```typescript
export interface ClassificationRule {
  id: string;
  version: string; // Semantic versioning
  conditions: RuleCondition[];
  action: ClassificationAction;
  metadata: {
    createdDate: string;
    description: string;
    testCases: TestCase[];
  };
}
```

### Validation Pipeline Enhancement

**Current Validation** (from BaseProcessor):

```typescript
const { invalid, valid } = validateUniversalTransactions(transactions);
if (invalid.length > 0) {
  this.logger.error(`${invalid.length} invalid transactions`);
}
```

**Proposed Multi-Layer Validation**:

1. **Schema Validation**: Zod schemas for data structure
2. **Business Rules**: Movement balance validation
3. **Classification Rules**: Purpose assignment validation
4. **Financial Constraints**: Precision and mathematical validation

## Provider Integration Research

### Registry-Based Architecture Compatibility

**Decision**: ProcessedTransaction integrates seamlessly with existing provider registry
**Rationale**: No changes required to @RegisterApiClient decorator pattern
**Alternatives considered**: Separate registry for ProcessedTransaction (rejected - unnecessary complexity)

**Current Provider Flow**:

```
Raw Data → Mapper → UniversalBlockchainTransaction → Processor → UniversalTransaction
```

**Proposed Enhanced Flow**:

```
Raw Data → Mapper → UniversalBlockchainTransaction → Processor → ProcessedTransaction
                                                               ↗️ Purpose Classifier
```

**Integration Points**:

- Processors return `Result<ProcessedTransaction[], ProcessingError>` instead of `UniversalTransaction[]`
- Purpose Classifier service injected into processors
- Database schema updated to store movements instead of single transaction
- Validation pipeline extended with movement-specific rules

## Technology Stack Confirmation

### Dependencies Analysis

**Core Dependencies Confirmed**:

- **TypeScript**: Existing Node.js 23.0.0+ environment
- **Decimal.js**: 28-precision financial arithmetic (already integrated)
- **neverthrow**: Result type error handling (135+ files use it)
- **Zod**: Runtime schema validation (existing validation pipeline)
- **Vitest**: Unit testing framework (existing ~2s test execution)

**No New Dependencies Required**: All necessary libraries already integrated and proven in production.

### Database Integration

**Decision**: Extend existing SQLite schema with new tables
**Rationale**: Preserve existing transaction data while adding movement-based storage
**Alternatives considered**: Replace transactions table (rejected - risky migration)

**Proposed Schema Extension**:

```sql
-- New tables alongside existing transactions table
CREATE TABLE processed_transactions (
  id TEXT PRIMARY KEY,
  universal_transaction_id TEXT REFERENCES transactions(id),
  timestamp INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT -- JSON
);

CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  processed_transaction_id TEXT REFERENCES processed_transactions(id),
  amount_value TEXT NOT NULL,  -- Decimal as string
  amount_currency TEXT NOT NULL,
  direction TEXT NOT NULL,     -- 'in' | 'out'
  participant TEXT,
  classification_purpose TEXT, -- 'PRINCIPAL' | 'FEE' | 'GAS'
  classification_rule_id TEXT,
  classification_confidence REAL,
  classification_reasoning TEXT
);
```

## Implementation Strategy

### Phased Approach

**Phase 0** (Complete): Research and planning
**Phase 1**: Core data structures and contracts

- ProcessedTransaction, Movement types
- Purpose Classifier interface design
- Database schema updates
- Validation pipeline extension

**Phase 2**: Implementation

- Purpose Classifier service implementation
- Processor interface updates
- Database repository updates
- Migration utilities

**Phase 3**: Integration and Testing

- Update all existing processors
- End-to-end testing with real transaction data
- Performance validation
- Documentation updates

## Critical Implementation Requirements

### 1. Fail-Fast Balance Rule (Testable Invariant)

**Decision**: Reject entire transaction if movements don't balance
**System Response**: Log error and continue processing other transactions
**Rationale**: Prevents corrupted financial data from entering system

**Balance Rules**:

- **Trade**: Must have ≥2 PRINCIPAL movements in different currencies that balance
- **Transfer**: Must be net-zero per currency except explicit FEE/GAS movements
- **All Types**: Total debits must equal total credits (including fees/gas)

**Enforcement**: Add to Zod schema validation with specific balance error messages

### 2. CSV Shim Behavior for Netted Rows

**Problem**: Current CSV processors net fees (`netAmount = amount - fee`)
**Solution**: Shim must reconstruct separate movements

**Example Transformation**:

```typescript
// Current CSV netted format
{ amount: '99.50', fee: '0.50', currency: 'USD' }

// Must become three movements
[
  { amount: '100.00', currency: 'USD', direction: 'out' },  // Principal spend
  { amount: '0.50', currency: 'USD', direction: 'out' },   // Fee
  { amount: 'X.XX', currency: 'BTC', direction: 'in' }     // Principal receive
]
```

**Testing**: Golden test using LedgerLive CSV samples to prove reconstruction

### 3. Processor Purpose Prohibition (CI-Enforced)

**Rule**: Processors MUST NOT set purpose except for indisputable GAS fees
**Enforcement**: Linting rules + failing tests in CI
**Exception**: Blockchain gas fees can be auto-classified as GAS

**Guard Implementation**:

```typescript
// Only Purpose Classifier can set classification
class MovementClassified {
  private constructor() {} // Prevent direct instantiation
  static fromClassifier(movement: MovementUnclassified, info: ClassificationInfo) {
    return new MovementClassified(movement, info);
  }
}
```

### 4. Precision Requirements (Hard Constraints)

**Decision**: Decimal strings with up to 18 on-chain digits, 28 internal precision
**Rationale**: Crypto precision requirements exceed JavaScript number limits

**Schema Enforcement**:

```typescript
const DecimalStringSchema = z
  .string()
  .refine((val) => /^-?\d+(\.\d{1,18})?$/.test(val), 'Max 18 decimal places')
  .brand('DecimalString');

type DecimalString = z.infer<typeof DecimalStringSchema>;
```

### 5. Confidence Score Inert (MVP Scope Control)

**Decision**: Include confidence in metadata but ban behavioral branching
**Rationale**: Prevent scope creep while preserving future extensibility

**Rule**: No UX changes, thresholds, or business logic based on confidence in MVP
**Implementation**: Accept all confidence scores 0-1, log but don't act

### 6. Constitution Gate Enforcement

**Rule**: Phase 1 outputs must not include any Non-Goals from spec
**Enforcement**: Template validation fails if DeFi/bridges/NFTs/pricing/SLAs appear
**Mechanism**: Automated checks in constitution review process

## Risk Assessment

### Technical Risks (Medium - Mitigated)

- **CSV Un-netting Complexity**: Golden tests with LedgerLive samples reduce risk
- **Balance Validation Performance**: Early validation prevents expensive processing
- **Processor Guard Circumvention**: CI enforcement makes violation impossible

### Business Risks (Low)

- **Classification Accuracy**: Three-purpose model + fail-fast prevents bad data
- **Migration Risk**: Shim approach preserves existing transaction data
- **Scope Creep**: Explicit Non-Goals enforcement prevents feature expansion

## Conclusion

Research confirms that ProcessedTransaction + Purpose Classifier architecture is well-aligned with existing codebase patterns and capabilities. The implementation can leverage mature foundations in error handling, financial precision, and deterministic processing while providing clear separation between transaction movements and their business purposes.

**Next Steps**: Proceed to Phase 1 design with confidence in technical approach and integration strategy.
