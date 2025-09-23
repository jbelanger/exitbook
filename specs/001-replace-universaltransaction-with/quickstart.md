# Quickstart: ProcessedTransaction + Purpose Classifier

**Date**: 2025-09-23
**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

## Overview

This guide demonstrates the new three-stage transaction processing pipeline that separates financial flow description from business purpose assignment and accounting rules.

**New Pipeline**: `Processor → ProcessedTransaction → Classifier → ClassifiedTransaction → Transformer`

## Installation & Setup

### 1. Install Dependencies
```bash
# Core packages already installed:
# - decimal.js (financial precision)
# - zod (runtime validation)
# - reflect-metadata (decorator support)

pnpm install
```

### 2. Build New Types
```bash
# Build the updated core package with new types
pnpm -F @crypto/core build
pnpm -F @crypto/import build
```

## Basic Usage

### 1. Create ProcessedTransaction from Raw Data

```typescript
import { ProcessedTransaction, MovementDirection } from '@crypto/core';

// Example: Bitcoin transfer with network fee
const processedTx: ProcessedTransaction = {
  id: 'btc-tx-abc123',
  source: 'mempool.space',
  sourceUid: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  eventType: 'transfer',
  description: 'Bitcoin transfer with network fee',
  timestamp: '2025-09-23T14:30:00.000Z',
  movements: [
    {
      movementId: 'btc-out-1',
      currency: 'BTC',
      quantity: '0.05000000',
      direction: 'OUT',
      metadata: {
        purposeHint: 'principal',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      }
    },
    {
      movementId: 'btc-fee-1',
      currency: 'BTC',
      quantity: '0.00015000',
      direction: 'OUT',
      purpose: 'gas', // Indisputable - can be set at processor time
      metadata: {
        feeType: 'network',
        relatedMovementId: 'btc-out-1'
      }
    }
  ],
  sourceDetails: {
    kind: 'blockchain',
    chain: 'bitcoin',
    txHash: 'abc123def456...',
    blockHeight: 850000,
    gasUsed: '0.00015000',
    addressScope: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
  }
};
```

### 2. Classify Transaction Purposes

```typescript
import { PurposeClassifier } from '@crypto/import';

// Initialize classifier
const classifier = new PurposeClassifier({
  minConfidence: 0.8,
  strictMode: true,
  maxOtherPercentage: 10,
  enableDebugLogging: false
});

// Classify the transaction
const classifiedTx = classifier.classify(processedTx);

// Result includes finalized purposes and audit trail
console.log(classifiedTx.movements[0]);
/*
{
  movementId: 'btc-out-1',
  currency: 'BTC',
  quantity: '0.05000000',
  direction: 'OUT',
  purpose: 'principal', // Finalized by classifier
  metadata: { ... },
  classification: {
    ruleId: 'transfer-principal-rule',
    confidence: 0.95,
    reason: 'Single currency outbound movement in transfer event',
    version: '1.0.0'
  }
}
*/
```

### 3. Exchange Trade Example

```typescript
// Example: Kraken BTC/USD trade with trading fee
const tradeTx: ProcessedTransaction = {
  id: 'kraken-trade-xyz789',
  source: 'kraken',
  sourceUid: 'account-123',
  eventType: 'trade',
  description: 'Buy BTC with USD',
  timestamp: '2025-09-23T14:35:00.000Z',
  movements: [
    {
      movementId: 'usd-out-1',
      currency: 'USD',
      quantity: '2500.00',
      direction: 'OUT',
      groupId: 'trade-1',
      metadata: {
        purposeHint: 'principal'
      }
    },
    {
      movementId: 'btc-in-1',
      currency: 'BTC',
      quantity: '0.04950000',
      direction: 'IN',
      groupId: 'trade-1',
      metadata: {
        purposeHint: 'principal'
      }
    },
    {
      movementId: 'usd-fee-1',
      currency: 'USD',
      quantity: '6.25',
      direction: 'OUT',
      metadata: {
        purposeHint: 'fee',
        feeType: 'trading',
        relatedMovementId: 'usd-out-1'
      }
    }
  ],
  sourceDetails: {
    kind: 'exchange',
    venue: 'kraken',
    accountId: 'account-123',
    orderId: 'ORDER-xyz789',
    tradeId: 'TRADE-xyz789',
    symbol: 'BTC/USD',
    side: 'buy'
  }
};

const classifiedTrade = classifier.classify(tradeTx);
// All movements get finalized purposes: 'principal', 'principal', 'fee'
```

## Validation

### 1. Processor-Time Validation

```typescript
import { ProcessorValidator } from '@crypto/import';

const validator = new ProcessorValidator({
  rules: {
    NON_ZERO_SUM_TRANSFER: { enabled: true, severity: 'error' },
    INSUFFICIENT_TRADE_MOVEMENTS: { enabled: true, severity: 'error' }
  },
  failFast: false,
  maxIssuesPerTransaction: 10
});

const result = validator.validate(processedTx);
if (!result.ok) {
  console.error('Validation failed:', result.issues);
}
```

### 2. Classification Validation

```typescript
import { ClassifierValidator } from '@crypto/import';

const classifierValidator = new ClassifierValidator();
const classificationResult = classifierValidator.validate(classifiedTx);

if (!classificationResult.ok) {
  console.error('Classification validation failed:', classificationResult.issues);
}
```

## Migration from UniversalTransaction

### Before (UniversalTransaction)
```typescript
const oldTx: UniversalTransaction = {
  id: 'tx-123',
  source: 'kraken',
  type: 'trade',
  amount: { amount: new Decimal('0.05'), currency: 'BTC' },
  fee: { amount: new Decimal('6.25'), currency: 'USD' },
  timestamp: 1695472500000,
  // ... other fields mixed with business logic
};
```

### After (ProcessedTransaction)
```typescript
const newTx: ProcessedTransaction = {
  id: 'tx-123',
  source: 'kraken',
  eventType: 'trade',
  timestamp: '2025-09-23T14:30:00.000Z',
  movements: [
    {
      movementId: 'btc-in-1',
      currency: 'BTC',
      quantity: '0.05000000',
      direction: 'IN',
      metadata: { purposeHint: 'principal' }
    },
    {
      movementId: 'usd-fee-1',
      currency: 'USD',
      quantity: '6.25',
      direction: 'OUT',
      metadata: { purposeHint: 'fee', feeType: 'trading' }
    }
  ],
  sourceDetails: { kind: 'exchange', venue: 'kraken' }
};
```

## Testing

### 1. Contract Tests
```bash
# Run contract validation tests
pnpm test --grep "ProcessedTransaction contract"
pnpm test --grep "PurposeClassifier contract"
```

### 2. Integration Tests
```bash
# Test full pipeline
pnpm test --grep "processor to classifier to transformer"
```

### 3. Migration Tests
```bash
# Validate migration correctness
pnpm test --grep "UniversalTransaction migration"
```

## Performance Considerations

### Batch Processing
```typescript
// Process large batches efficiently
const largeBatch: ProcessedTransaction[] = [...]; // 1000+ transactions

const batchClassifier = new PurposeClassifierBatch();
const classifiedBatch = batchClassifier.classifyMany(largeBatch);

// Monitor performance
const metrics = batchClassifier.getMetrics();
console.log(`Processed ${metrics.transactionsProcessed} transactions`);
console.log(`Average confidence: ${metrics.averageConfidence}`);
console.log(`OTHER percentage: ${metrics.otherPercentage}%`);
```

## Troubleshooting

### Common Issues

1. **Low Classification Confidence**
   - Review transaction patterns and add more specific rules
   - Check if `sourceDetails` provides sufficient context

2. **Validation Errors**
   - Ensure all required fields are present
   - Verify movement directions match event types
   - Check currency formatting (use DecimalString)

3. **Migration Issues**
   - Use provided migration utilities
   - Validate data consistency during transition
   - Monitor classification metrics for anomalies

### Debug Logging
```typescript
const classifier = new PurposeClassifier({
  enableDebugLogging: true,
  minConfidence: 0.7 // Lower threshold for debugging
});
```

This quickstart covers the core concepts and common usage patterns. For advanced scenarios and detailed API documentation, see the full implementation guide.