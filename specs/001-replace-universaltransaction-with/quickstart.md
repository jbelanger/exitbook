# Quickstart: ProcessedTransaction + Purpose Classifier

**Date**: 2025-09-23
**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

## Overview

This quickstart guide demonstrates the three-stage transaction processing pipeline that replaces UniversalTransaction with ProcessedTransaction + Purpose Classifier architecture.

## Prerequisites

- Node.js >= 23.0.0
- pnpm >= 10.6.2
- Existing crypto-portfolio CLI working
- Access to test transaction data

## Quick Demo

### 1. Verify Current System

```bash
# Check current system status
pnpm status

# Verify existing transaction import works
pnpm dev import --blockchain bitcoin --addresses bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
```

### 2. Test ProcessedTransaction Pipeline

```bash
# Test new processor (when implemented)
pnpm dev process --source kraken --type exchange --test

# Expected output:
# ✓ ProcessedTransaction created with 3 movements
# ✓ ID unique per (source, sourceUid, id) tuple: kraken.user123.order456
# ✓ Direction relative to user account scope
# ✓ Backward compatibility shim functional
```

### 3. Test Purpose Classification

```bash
# Test classification stage (when implemented)
pnpm dev classify --transaction-id kraken.user123.order456

# Expected output:
# ✓ Movement 1: PRINCIPAL (confidence: 0.95, rule: exchange_trade_main)
# ✓ Movement 2: TRADING_FEE (confidence: 0.98, rule: exchange_fee_standard)
# ✓ Overall confidence: 0.97
# ✓ Classification audit trail preserved
```

### 4. Test Backward Compatibility

```bash
# Test shim conversion (during migration period)
pnpm dev convert --from universal --to processed --validate

# Expected output:
# ✓ UniversalTransaction → ProcessedTransaction conversion successful
# ✓ Validation: no data loss detected
# ✓ Shim operating within time-box constraints
```

## Example Data Flow

### Input: Raw Exchange Data
```json
{
  "orderId": "456789",
  "symbol": "BTC/USD",
  "side": "buy",
  "amount": "0.1",
  "price": "45000",
  "fee": "2.25",
  "feeAsset": "USD",
  "timestamp": "2025-09-23T10:30:00Z"
}
```

### Stage 1: ProcessedTransaction
```json
{
  "id": "order456789",
  "sourceUid": "user123",
  "source": {
    "type": "EXCHANGE",
    "name": "kraken"
  },
  "eventType": "TRADE",
  "timestamp": "2025-09-23T10:30:00Z",
  "movements": [
    {
      "movementId": "btc_in",
      "currency": "BTC",
      "amount": "0.1",
      "direction": "IN",
      "metadata": {
        "accountId": "main",
        "tradingPair": "BTC/USD"
      }
    },
    {
      "movementId": "usd_out",
      "currency": "USD",
      "amount": "4500",
      "direction": "OUT",
      "metadata": {
        "accountId": "main",
        "tradingPair": "BTC/USD"
      }
    },
    {
      "movementId": "fee_out",
      "currency": "USD",
      "amount": "2.25",
      "direction": "OUT",
      "metadata": {
        "accountId": "main",
        "relatedMovementId": "usd_out"
      }
    }
  ]
}
```

### Stage 2: ClassifiedTransaction
```json
{
  "processedTransaction": { /* above */ },
  "movements": [
    {
      "movement": { /* btc_in movement */ },
      "purpose": "PRINCIPAL",
      "confidence": 0.95,
      "ruleId": "exchange_trade_main_asset"
    },
    {
      "movement": { /* usd_out movement */ },
      "purpose": "PRINCIPAL",
      "confidence": 0.95,
      "ruleId": "exchange_trade_main_asset"
    },
    {
      "movement": { /* fee_out movement */ },
      "purpose": "TRADING_FEE",
      "confidence": 0.98,
      "ruleId": "exchange_fee_standard"
    }
  ],
  "classificationInfo": {
    "ruleSetVersion": "1.0.0",
    "overallConfidence": 0.96
  }
}
```

## Integration Testing

### Test Scenario 1: Multi-leg Trade
```bash
# Import complex transaction with multiple fees
pnpm dev import --source test-data/complex-trade.json

# Verify all movements classified correctly
pnpm dev verify --transaction-id complex123 --expect-movements 4
```

### Test Scenario 2: Cross-account Direction
```bash
# Test direction perspective with multiple accounts
pnpm dev import --source test-data/multi-account.json

# Verify direction relative to correct account scope
pnpm dev verify --transaction-id multi456 --account user789
```

### Test Scenario 3: Migration Compatibility
```bash
# Test backward compatibility during migration
pnpm dev migrate --dry-run --validate-shims

# Verify no data loss during transition
pnpm dev compare --universal-vs-processed --sample-size 100
```

## Key Validations

### ProcessedTransaction Validations
- [x] ID uniqueness per (source, sourceUid, id) tuple
- [x] Direction relative to user's targeted account/scope
- [x] Zero-sum transfers balanced
- [x] Decimal.js precision maintained
- [x] Required fields populated

### Classification Validations
- [x] Every movement has assigned purpose
- [x] Confidence scores within 0.0-1.0 range
- [x] Related movements have compatible purposes
- [x] Venue-aware classification rules applied
- [x] Audit trail complete with rule identifiers

### Migration Validations
- [x] Backward compatibility shim functional
- [x] UniversalTransaction → ProcessedTransaction conversion
- [x] No data loss for supported transaction types
- [x] Time-boxed migration within 1-2 sprint constraints

## Performance Benchmarks

### Processing Performance
```bash
# Benchmark processor performance
pnpm dev benchmark --processor bitcoin --transactions 1000

# Expected: < 100ms per transaction
# Expected: Memory usage < 50MB for 1000 transactions
```

### Classification Performance
```bash
# Benchmark classification performance
pnpm dev benchmark --classifier --batch-size 1000

# Expected: Background processing in minutes
# Expected: 95%+ confidence for standard transaction types
```

## Error Handling Tests

### Low Confidence Classification
```bash
# Test handling of ambiguous transactions
pnpm dev classify --transaction-id ambiguous789

# Expected: Movement flagged for manual review
# Expected: Confidence < 0.7 threshold
```

### Missing Data Scenarios
```bash
# Test incomplete source data
pnpm dev process --source incomplete-data.json

# Expected: Graceful degradation
# Expected: Validation warnings logged
```

## Migration Timeline

### Sprint 1: Core Implementation
- [ ] ProcessedTransaction types and validation
- [ ] Basic purpose classifier
- [ ] Backward compatibility shims
- [ ] Contract tests passing

### Sprint 2: Migration & Optimization
- [ ] Processor migration (exchanges first)
- [ ] Blockchain processor migration
- [ ] Performance optimization
- [ ] Legacy cleanup

## Success Criteria

✅ **Functional Requirements Met**:
- Three-stage pipeline operational
- All movements properly classified
- Backward compatibility during transition
- Audit trails preserved

✅ **Performance Requirements Met**:
- Background processing acceptable (minutes)
- Per-user reprocessing supported
- 1-2 sprint migration timeline achieved

✅ **Quality Requirements Met**:
- All tests passing
- No data loss during migration
- Documentation complete
- Observability metrics functional

## Next Steps

1. Run `/tasks` command to generate implementation tasks
2. Implement core ProcessedTransaction types
3. Create purpose classifier with initial rules
4. Build backward compatibility shims
5. Migrate processors incrementally
6. Performance testing and optimization

## Support

For issues during implementation:
- Check existing tests in `packages/import/src/__tests__/`
- Review provider patterns in `packages/import/src/blockchains/`
- Validate against schemas in `contracts/`
- Monitor logs with `pnpm dev --verbose`