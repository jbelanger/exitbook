# Data Model: ProcessedTransaction + Purpose Classifier (MVP)

**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)
**Branch**: `003-replace-universaltransaction-with`
**Date**: 2025-09-24

## Domain Model Overview

Clean separation between "what happened" (money movements) vs "why it happened" (business purposes). Processors emit **unclassified** movements; the **classifier** produces classified ones. MVP scope: Kraken spot trades + Ethereum L1 transfers only.

## Core Data Types

### Primitives

```typescript
export type IsoTimestamp = string; // ISO-8601 UTC
export type DecimalString = string; // Validated: up to 18+ decimal places
export type ExternalId = string; // Upstream ID (venue tx id, txHash)
export type MovementId = string;
export type Currency = string; // Currency code
export type MovementSequence = number; // Movement order within transaction
export type RulesetVersion = string; // Semver for classifier rules

export type MovementDirection = 'IN' | 'OUT';
export type MovementPurpose = 'PRINCIPAL' | 'FEE' | 'GAS';
export type MovementHint = 'FEE' | 'GAS';
```

### Money Value Object

```typescript
export interface Money2 {
  readonly amount: DecimalString; // JSON-safe; parse to Decimal at the edge
  readonly currency: Currency; // 'BTC', 'ETH', 'USDT', 'CAD', etc.
}

// Validation schema
export const DecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, 'Max 18 decimals, no leading zeros')
  .refine((v) => v !== '0', 'Amount must be > 0');

export const MoneySchema2 = z.object({
  amount: DecimalStringSchema,
  currency: z.string().min(1, 'Currency required'),
});
```

### Source Details

```typescript
export type SourceDetails =
  | {
      kind: 'exchange';
      venue: 'kraken';
      externalId: ExternalId;
      importSessionId: string;
    }
  | {
      kind: 'blockchain';
      chain: 'ethereum';
      txHash: string;
      importSessionId: string;
    };
```

## Core Entities

### MovementUnclassified

Individual money flow emitted by processors - **no purpose assigned yet**.

```typescript
export interface MovementUnclassified {
  readonly id: MovementId;
  readonly money: Money2; // Amount is always POSITIVE
  readonly direction: MovementDirection; // IN to user, OUT from user
  readonly hint?: MovementHint | undefined; // Optional hint; classifier decides purpose
  readonly sequence?: MovementSequence | undefined; // Order within transaction
  readonly metadata?: Record<string, unknown> | undefined;
}
```

### ClassificationInfo

Metadata about how purpose was determined by classifier.

```typescript
export interface ClassificationInfo {
  purpose: MovementPurpose;
  ruleId: string; // e.g., "exchange.kraken.trade.v1", "chain.eth.transfer.gas.v1"
  reason: string; // Brief explanation
  version: string; // Classifier ruleset version (semver)
  confidence: number; // 0..1 (do not branch on this in MVP)
  classifiedAt: IsoTimestamp;
}
```

### MovementClassified

Movement after purpose classification by classifier service.

```typescript
export interface MovementClassified extends Omit<MovementUnclassified, 'hint'> {
  classification: ClassificationInfo;
}
```

### ProcessedTransaction

Complete financial event with **unclassified** movements from processors.

```typescript
export interface ProcessedTransaction {
  readonly id: ExternalId; // Stable upstream identifier
  readonly timestamp: IsoTimestamp;
  readonly source: SourceDetails;
  readonly movements: MovementUnclassified[]; // Processors emit UNCLASSIFIED only
}
```

### ClassifiedTransaction

Result of running classifier on ProcessedTransaction.

```typescript
export interface ClassifiedTransaction extends Omit<ProcessedTransaction, 'movements'> {
  readonly movements: MovementClassified[];
  readonly purposeRulesetVersion: RulesetVersion;
}
```

## Processing Pipeline Architecture

### Two-Stage Processing

The system maintains clear separation between processors and classifiers:

1. **Stage 1 - Processors**: Convert raw transaction data to `ProcessedTransaction` with unclassified movements
2. **Stage 2 - Classifier**: Run as separate service after processors; processors remain unaware of classification logic

```
Raw Data → Mapper → UniversalBlockchainTransaction → Processor → ProcessedTransaction
                                                                       ↓
                                                                 PurposeClassifier
                                                                       ↓
                                                              ClassifiedTransaction
```

## Classifier Contract

### PurposeClassifier Interface

```typescript
export interface PurposeClassifier {
  /**
   * Pure, deterministic classification function.
   * Same input always produces identical output.
   */
  classify(tx: ProcessedTransaction): Result<ClassifiedTransaction, ClassificationError>;

  /**
   * Get current ruleset version for tracking.
   */
  getRulesetVersion(): string;
}

export class ClassificationError extends Error {
  constructor(
    public readonly transactionId: ExternalId,
    public readonly failedMovements: MovementId[],
    message: string
  ) {
    super(`Classification failed for transaction ${transactionId}: ${message}`);
  }
}
```

### Deterministic Rule Implementation (MVP)

```typescript
export interface ClassificationRule {
  id: string;
  version: string;
  description: string;

  // Simple condition matching for MVP
  matches: (movement: MovementUnclassified, tx: ProcessedTransaction) => boolean;
  classify: (movement: MovementUnclassified) => ClassificationInfo;
}

// Hard-coded rules for MVP scope only
export const MVP_CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: 'exchange.kraken.trade.principal.v1',
    version: '1.0.0',
    description: 'Kraken trade principal movements',
    matches: (movement, tx) => tx.source.kind === 'exchange' && tx.source.venue === 'kraken' && !movement.hint,
    classify: (movement) => ({
      purpose: 'PRINCIPAL',
      ruleId: 'exchange.kraken.trade.principal.v1',
      reason: 'Kraken trade principal movement',
      version: '1.0.0',
      confidence: 1.0,
      classifiedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'exchange.kraken.trade.fee.v1',
    version: '1.0.0',
    description: 'Kraken trade fees',
    matches: (movement, tx) =>
      tx.source.kind === 'exchange' &&
      tx.source.venue === 'kraken' &&
      movement.hint === 'FEE' &&
      movement.direction === 'OUT',
    classify: (movement) => ({
      purpose: 'FEE',
      ruleId: 'exchange.kraken.trade.fee.v1',
      reason: 'Kraken trading fee',
      version: '1.0.0',
      confidence: 1.0,
      classifiedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'chain.eth.transfer.gas.v1',
    version: '1.0.0',
    description: 'Ethereum gas fees',
    matches: (movement, tx) =>
      tx.source.kind === 'blockchain' &&
      tx.source.chain === 'ethereum' &&
      movement.hint === 'GAS' &&
      movement.direction === 'OUT' &&
      movement.money.currency === 'ETH',
    classify: (movement) => ({
      purpose: 'GAS',
      ruleId: 'chain.eth.transfer.gas.v1',
      reason: 'Ethereum gas fee',
      version: '1.0.0',
      confidence: 1.0,
      classifiedAt: new Date().toISOString(),
    }),
  },
  {
    id: 'chain.eth.transfer.principal.v1',
    version: '1.0.0',
    description: 'Ethereum transfer principals',
    matches: (movement, tx) => tx.source.kind === 'blockchain' && tx.source.chain === 'ethereum' && !movement.hint,
    classify: (movement) => ({
      purpose: 'PRINCIPAL',
      ruleId: 'chain.eth.transfer.principal.v1',
      reason: 'Ethereum transfer principal',
      version: '1.0.0',
      confidence: 1.0,
      classifiedAt: new Date().toISOString(),
    }),
  },
];
```

## Validation Rules (MVP)

### Balance Invariants

```typescript
export interface BalanceRule {
  name: string;
  validate: (movements: MovementClassified[]) => ValidationResult;
}

export interface ValidationResult {
  isValid: boolean;
  rule: string;
  message: string;
  violations?: string[];
}

export const MVP_BALANCE_RULES: BalanceRule[] = [
  {
    name: 'FEES_AND_GAS_OUT',
    validate: (movements) => {
      const feesAndGas = movements.filter(
        (m) => m.classification.purpose === 'FEE' || m.classification.purpose === 'GAS'
      );
      const allOutbound = feesAndGas.every((m) => m.direction === 'OUT');

      return {
        isValid: allOutbound,
        rule: 'FEES_AND_GAS_OUT',
        message: allOutbound ? 'All fees and gas are OUT direction' : 'FEE and GAS must be OUT direction',
        violations: allOutbound
          ? undefined
          : feesAndGas
              .filter((m) => m.direction !== 'OUT')
              .map((m) => `Movement ${m.id} has ${m.classification.purpose} but direction ${m.direction}`),
      };
    },
  },
  {
    name: 'TRADE_PRINCIPALS_BALANCE',
    validate: (movements) => {
      const principals = movements.filter((m) => m.classification.purpose === 'PRINCIPAL');
      if (principals.length < 2) {
        return { isValid: true, rule: 'TRADE_PRINCIPALS_BALANCE', message: 'No trade detected' };
      }

      // Group by currency and sum IN vs OUT
      const balances: Record<string, { in: Decimal; out: Decimal }> = {};

      for (const movement of principals) {
        const currency = movement.money.currency;
        if (!balances[currency]) {
          balances[currency] = { in: new Decimal(0), out: new Decimal(0) };
        }

        const amount = new Decimal(movement.money.amount);
        if (movement.direction === 'IN') {
          balances[currency].in = balances[currency].in.plus(amount);
        } else {
          balances[currency].out = balances[currency].out.plus(amount);
        }
      }

      // Trades: principals must net to zero by currency; fees are separate OUT
      const imbalances: string[] = [];
      for (const [currency, balance] of Object.entries(balances)) {
        if (!balance.in.equals(balance.out)) {
          imbalances.push(`${currency}: IN=${balance.in} OUT=${balance.out}`);
        }
      }

      return {
        isValid: imbalances.length === 0,
        rule: 'TRADE_PRINCIPALS_BALANCE',
        message:
          imbalances.length === 0
            ? 'Trade principals balance correctly'
            : 'Trade principals do not balance by currency',
        violations: imbalances.length > 0 ? imbalances : undefined,
      };
    },
  },
  {
    name: 'TRANSFER_BALANCE',
    validate: (movements) => {
      const principals = movements.filter((m) => m.classification.purpose === 'PRINCIPAL');
      const gas = movements.filter((m) => m.classification.purpose === 'GAS');

      // Transfers: transferred currency principals net to zero; GAS may net OUT in gas currency
      const principalBalances: Record<string, Decimal> = {};

      for (const movement of principals) {
        const currency = movement.money.currency;
        const amount = new Decimal(movement.money.amount);
        const signedAmount = movement.direction === 'IN' ? amount : amount.neg();

        principalBalances[currency] = (principalBalances[currency] || new Decimal(0)).plus(signedAmount);
      }

      // Check if this looks like a transfer (single currency principals net zero)
      const principalCurrencies = Object.keys(principalBalances);
      if (principalCurrencies.length !== 1) {
        return { isValid: true, rule: 'TRANSFER_BALANCE', message: 'Not a simple transfer' };
      }

      const [transferCurrency] = principalCurrencies;
      const principalBalance = principalBalances[transferCurrency];

      const isBalanced = principalBalance.equals(0);
      const gasOk = gas.every((g) => g.direction === 'OUT');

      return {
        isValid: isBalanced && gasOk,
        rule: 'TRANSFER_BALANCE',
        message:
          isBalanced && gasOk
            ? 'Transfer balances correctly'
            : `Transfer invalid: principals=${principalBalance}, gas directions OK=${gasOk}`,
        violations:
          !isBalanced || !gasOk
            ? [
                `Principal balance: ${principalBalance} ${transferCurrency}`,
                `Gas directions: ${gas.map((g) => `${g.direction}`).join(', ')}`,
              ]
            : undefined,
      };
    },
  },
];
```

### Validation Pipeline

```typescript
export interface TransactionValidator {
  validate(tx: ClassifiedTransaction): ValidationResult[];
}

export class MVPTransactionValidator implements TransactionValidator {
  validate(tx: ClassifiedTransaction): ValidationResult[] {
    return MVP_BALANCE_RULES.map(rule => rule.validate(tx.movements));
  }
}

### System Response to Validation Failures

**Failed Balance = Reject Transaction + Log**: When any validation rule fails, the entire transaction is rejected (no partials) and logged for manual review. The system continues processing other transactions in the batch.
```

## Repository Interface (MVP)

### Minimal Repository Contract

```typescript
export interface ProcessedTransactionRepository {
  // Core operations only
  save(tx: ProcessedTransaction): Promise<Result<void, RepositoryError>>;
  findById(id: ExternalId): Promise<Result<ProcessedTransaction, RepositoryError>>;

  // Batch operations for import performance
  saveBatch(transactions: ProcessedTransaction[]): Promise<Result<void, RepositoryError>>;
}

export interface ClassifiedTransactionRepository {
  save(tx: ClassifiedTransaction): Promise<Result<void, RepositoryError>>;
  findById(id: ExternalId): Promise<Result<ClassifiedTransaction, RepositoryError>>;
}

export class RepositoryError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONSTRAINT_VIOLATION',
    message: string
  ) {
    super(message);
  }
}
```

## Database Schema (MVP-Trimmed)

### SQLite Tables

```sql
-- Processed transactions (unclassified movements)
CREATE TABLE processed_transactions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL, -- ISO-8601
  source_kind TEXT NOT NULL CHECK (source_kind IN ('exchange', 'blockchain')),
  source_venue_or_chain TEXT NOT NULL,
  external_id TEXT NOT NULL,
  import_session_id TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Unclassified movements
CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  tx_id TEXT NOT NULL REFERENCES processed_transactions(id),
  amount_value TEXT NOT NULL, -- DecimalString
  amount_currency TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  hint TEXT CHECK (hint IN ('FEE', 'GAS')),
  sequence INTEGER,
  metadata TEXT, -- JSON
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Classifications (separate table for classified results)
CREATE TABLE movement_classifications (
  movement_id TEXT PRIMARY KEY REFERENCES movements(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('PRINCIPAL', 'FEE', 'GAS')),
  rule_id TEXT NOT NULL,
  version TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  classified_at TEXT NOT NULL, -- ISO-8601
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for performance
CREATE INDEX idx_transactions_source ON processed_transactions(source_kind, source_venue_or_chain);
CREATE INDEX idx_movements_tx ON movements(tx_id);
CREATE INDEX idx_classifications_purpose ON movement_classifications(purpose);
```

## UniversalTransaction Bridge (MVP)

### Legacy Conversion

```typescript
export interface UniversalTransactionBridge {
  convertToProcessed(universal: UniversalTransaction): Result<ProcessedTransaction, ConversionError>;
}

export class MVPUniversalTransactionBridge implements UniversalTransactionBridge {
  convertToProcessed(universal: UniversalTransaction): Result<ProcessedTransaction, ConversionError> {
    const movements: MovementUnclassified[] = [];

    // Un-net CSV data: if we had netAmount = amount - fee, reconstruct separate movements
    const primaryAmount = universal.fee
      ? new Decimal(universal.amount.amount).plus(new Decimal(universal.fee.amount))
      : new Decimal(universal.amount.amount);

    // Primary movement
    movements.push({
      id: `${universal.id}-principal`,
      money: {
        amount: primaryAmount.toString(),
        currency: universal.amount.currency,
      },
      direction: universal.type.startsWith('deposit') ? 'IN' : 'OUT',
      sequence: 1,
      metadata: { originalType: universal.type },
    });

    // Fee movement if present (always OUT with hint)
    if (universal.fee && !new Decimal(universal.fee.amount).isZero()) {
      movements.push({
        id: `${universal.id}-fee`,
        money: {
          amount: universal.fee.amount,
          currency: universal.fee.currency,
        },
        direction: 'OUT',
        hint: 'FEE', // Hint for classifier
        sequence: 2,
        metadata: { feeType: 'unknown' },
      });
    }

    return ok({
      id: universal.id,
      timestamp: universal.timestamp.toISOString(),
      source: this.mapSource(universal),
      movements,
    });
  }

  private mapSource(universal: UniversalTransaction): SourceDetails {
    // Map from existing transaction metadata to new source structure
    if (universal.blockchain) {
      return {
        kind: 'blockchain',
        chain: universal.blockchain as 'ethereum',
        txHash: universal.id,
        importSessionId: universal.sessionId || 'unknown',
      };
    } else {
      return {
        kind: 'exchange',
        venue: 'kraken', // MVP assumption
        externalId: universal.id,
        importSessionId: universal.sessionId || 'unknown',
      };
    }
  }
}
```

## Error Handling (Fail-Fast)

### Simple Error Types

```typescript
export class ConversionError extends Error {
  constructor(message: string) {
    super(`Conversion failed: ${message}`);
  }
}

export class ValidationFailedError extends Error {
  constructor(public readonly violations: ValidationResult[]) {
    super(`Validation failed: ${violations.map((v) => v.message).join('; ')}`);
  }
}
```

## Acceptance Test Scenarios

### AC-001: Kraken Trade Classification (Trade Balance)

```typescript
// Input: Kraken trade with fee
const krakenTrade: ProcessedTransaction = {
  id: 'kraken-123',
  timestamp: '2025-09-24T10:00:00Z',
  source: { kind: 'exchange', venue: 'kraken', externalId: 'trade-456', importSessionId: 'session-1' },
  movements: [
    { id: 'mov-1', money: { amount: '100.00', currency: 'USD' }, direction: 'OUT', sequence: 1 },
    { id: 'mov-2', money: { amount: '0.001', currency: 'BTC' }, direction: 'IN', sequence: 2 },
    { id: 'mov-3', money: { amount: '0.50', currency: 'USD' }, direction: 'OUT', hint: 'FEE', sequence: 3 },
  ],
};

// Expected: Two PRINCIPAL movements balance; one FEE movement
// Principals: 100.00 USD OUT, 0.001 BTC IN (balanced trade)
// Fee: 0.50 USD OUT (separate from principal balance)
```

### AC-002: Ethereum Transfer Classification (Transfer + Gas)

```typescript
// Input: ETH transfer with gas
const ethTransfer: ProcessedTransaction = {
  id: '0xabc123',
  timestamp: '2025-09-24T10:05:00Z',
  source: { kind: 'blockchain', chain: 'ethereum', txHash: '0xabc123', importSessionId: 'session-2' },
  movements: [
    { id: 'mov-1', money: { amount: '1.0', currency: 'ETH' }, direction: 'OUT', sequence: 1 },
    { id: 'mov-2', money: { amount: '1.0', currency: 'ETH' }, direction: 'IN', sequence: 2 },
    { id: 'mov-3', money: { amount: '0.01', currency: 'ETH' }, direction: 'OUT', hint: 'GAS', sequence: 3 },
  ],
};

// Expected: Principal nets to zero for ETH; gas is separate OUT
// Principals: 1.0 ETH OUT + 1.0 ETH IN = 0 (transfer balance)
// Gas: 0.01 ETH OUT (allowed net outbound)
```

### AC-003: Deterministic Classification (Repeatability)

```typescript
// Same input processed twice must produce byte-identical output
const result1 = classifier.classify(krakenTrade);
const result2 = classifier.classify(krakenTrade);

assert(JSON.stringify(result1) === JSON.stringify(result2));
```

### AC-004: Fail-Fast Validation (Reject Transaction)

```typescript
// Unbalanced principals should reject entire transaction
const unbalancedTrade: ProcessedTransaction = {
  id: 'bad-trade',
  timestamp: '2025-09-24T10:00:00Z',
  source: { kind: 'exchange', venue: 'kraken', externalId: 'bad-123', importSessionId: 'session-1' },
  movements: [
    { id: 'mov-1', money: { amount: '100.00', currency: 'USD' }, direction: 'OUT' },
    { id: 'mov-2', money: { amount: '0.002', currency: 'BTC' }, direction: 'IN' }, // Wrong amount
  ],
};

// Expected: Classification succeeds but validation fails
// Result: Transaction rejected, logged for review
```

This lean data model eliminates scope creep while maintaining deterministic processing and clear separation of concerns for the MVP.
