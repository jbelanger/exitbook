# Quickstart: ProcessedTransaction + Purpose Classifier (MVP)

**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier (MVP)
**Branch**: `003-replace-universaltransaction-with`
**Date**: 2025-09-24

## Integration Test Scenarios

This quickstart demonstrates the key acceptance scenarios from the spec using the CQRS contracts. Each scenario validates the core user stories and shows expected system behavior.

## Scenario 1: Kraken Spot Trade with Fee

**User Story**: As a crypto portfolio user, when I import a Kraken spot trade with fee, the system should identify PRINCIPAL movements (buy/sell) and FEE movements separately with high confidence.

### Test Steps

```typescript
// 1. Process raw Kraken trade data into ProcessedTransaction
const processCommand: ProcessTransactionCommand = {
  rawData: {
    ordertxid: 'trade-456',
    time: 1695547200,
    type: 'buy',
    vol: '0.001',
    pair: 'XBTUSD',
    price: '100000.00',
    cost: '100.00',
    fee: '0.50',
    misc: '',
  },
  source: { kind: 'exchange', venue: 'kraken' },
  importSessionId: 'session-1',
  requestId: 'req-kraken-trade-001',
};

const processResult = await processHandler.execute(processCommand);
// Expected: Success with 3 unclassified movements

// 2. Classify movements by purpose
const classifyCommand: ClassifyMovementsCommand = {
  transaction: processResult.value,
  requestId: 'req-classify-001',
};

const classifyResult = await classifyHandler.execute(classifyCommand);
// Expected: Success with classified movements

// 3. Validate classified transaction
const validator = new MVPTransactionValidator();
const validationResults = validator.validate(classifyResult.value);
// Expected: All validation rules pass
```

### Expected Results

**ProcessedTransaction movements**:

- Movement 1: `$100.00 USD OUT` (unclassified)
- Movement 2: `0.001 BTC IN` (unclassified)
- Movement 3: `$0.50 USD OUT` (hint: FEE)

**ClassifiedTransaction movements**:

- Movement 1: `$100.00 USD OUT` → **PRINCIPAL** (rule: exchange.kraken.trade.principal.v1)
- Movement 2: `0.001 BTC IN` → **PRINCIPAL** (rule: exchange.kraken.trade.principal.v1)
- Movement 3: `$0.50 USD OUT` → **FEE** (rule: exchange.kraken.trade.fee.v1)

**Balance Validation**: ✅ PASS

- Trade principals balance: USD in/out = $100/$100, BTC in/out = 0.001/0.001
- Fee separate from principal balance: $0.50 USD OUT as FEE

---

## Scenario 2: Ethereum Transfer with Gas

**User Story**: As a crypto portfolio user, when I import an Ethereum transfer, the system should identify the transfer as PRINCIPAL and the gas cost as GAS movement.

### Test Steps

```typescript
// 1. Process raw Ethereum transaction data
const processCommand: ProcessTransactionCommand = {
  rawData: {
    hash: '0xabc123...',
    blockNumber: '18500000',
    from: '0x1234...',
    to: '0x5678...',
    value: '1000000000000000000', // 1 ETH in wei
    gasPrice: '20000000000',
    gasUsed: '21000',
  },
  source: { kind: 'blockchain', chain: 'ethereum' },
  importSessionId: 'session-2',
  requestId: 'req-eth-transfer-001',
};

const processResult = await processHandler.execute(processCommand);
// Expected: Success with 3 unclassified movements

// 2. Classify movements
const classifyCommand: ClassifyMovementsCommand = {
  transaction: processResult.value,
  requestId: 'req-classify-002',
};

const classifyResult = await classifyHandler.execute(classifyCommand);
// Expected: Success with classified movements
```

### Expected Results

**ProcessedTransaction movements**:

- Movement 1: `1.0 ETH OUT` (unclassified)
- Movement 2: `1.0 ETH IN` (unclassified)
- Movement 3: `0.00042 ETH OUT` (hint: GAS)

**ClassifiedTransaction movements**:

- Movement 1: `1.0 ETH OUT` → **PRINCIPAL** (rule: chain.eth.transfer.principal.v1)
- Movement 2: `1.0 ETH IN` → **PRINCIPAL** (rule: chain.eth.transfer.principal.v1)
- Movement 3: `0.00042 ETH OUT` → **GAS** (rule: chain.eth.transfer.gas.v1)

**Balance Validation**: ✅ PASS

- Transfer principals net to zero: ETH in/out = 1.0/1.0
- Gas separate outbound: 0.00042 ETH OUT as GAS

---

## Scenario 3: Deterministic Processing

**User Story**: When the same transaction data is processed multiple times, identical outputs must be produced every time (deterministic).

### Test Steps

```typescript
// Process same transaction multiple times
const baseCommand: ClassifyMovementsCommand = {
  transaction: krakenTradeProcessed,
  requestId: 'req-deterministic-test',
};

const results = await Promise.all([
  classifyHandler.execute({ ...baseCommand, requestId: 'req-det-1' }),
  classifyHandler.execute({ ...baseCommand, requestId: 'req-det-2' }),
  classifyHandler.execute({ ...baseCommand, requestId: 'req-det-3' }),
]);

// Validate identical classification results (excluding timestamps)
const normalized = results.map((r) => normalizeForComparison(r.value));
assert(JSON.stringify(normalized[0]) === JSON.stringify(normalized[1]));
assert(JSON.stringify(normalized[1]) === JSON.stringify(normalized[2]));
```

### Expected Results

**Deterministic Properties**:

- Same movement purposes: PRINCIPAL/FEE/GAS assignments identical
- Same rule IDs: classification rules match exactly
- Same confidence scores: diagnostic values consistent
- Same reasoning text: explanations identical

**Non-Deterministic Properties** (excluded from comparison):

- Classification timestamps: `classifiedAt` varies by execution time
- Event timestamps: metadata timestamps vary

---

## Scenario 4: Validation Failure (Fail-Fast)

**User Story**: When a transaction fails validation rules, the system should prevent the operation with clear error messages indicating specific validation failures.

### Test Steps

```typescript
// Create unbalanced trade (should fail validation)
const unbalancedTrade: ProcessedTransaction = {
  id: 'bad-trade-123',
  timestamp: '2025-09-24T10:00:00Z',
  source: { kind: 'exchange', venue: 'kraken', externalId: 'bad-123', importSessionId: 'session-1' },
  movements: [
    {
      id: 'mov-1',
      money: { amount: '100.00', currency: 'USD' },
      direction: 'OUT',
      sequence: 1,
    },
    {
      id: 'mov-2',
      money: { amount: '0.002', currency: 'BTC' }, // Wrong amount - doesn't balance
      direction: 'IN',
      sequence: 2,
    },
  ],
};

// Classification should succeed
const classifyResult = await classifyHandler.execute({
  transaction: unbalancedTrade,
  requestId: 'req-validation-fail',
});

// But validation should fail
const validator = new MVPTransactionValidator();
const validationResults = validator.validate(classifyResult.value);
```

### Expected Results

**Classification Result**: ✅ SUCCESS

- Both movements classified as PRINCIPAL
- Rule matching works correctly

**Validation Result**: ❌ FAILURE

```typescript
{
  isValid: false,
  rule: 'TRADE_PRINCIPALS_BALANCE',
  message: 'Trade principals do not balance by currency',
  violations: [
    'USD: IN=0 OUT=100.00',
    'BTC: IN=0.002 OUT=0'
  ]
}
```

**System Response**:

- Transaction rejected (not saved to repository)
- Error logged for manual review
- Processing continues with next transaction in batch

---

## Scenario 5: Query Classified Transaction

**User Story**: As a crypto portfolio user, I need to retrieve my processed transactions with their movement purposes, so that I can understand what each money flow represents.

### Test Steps

```typescript
// After successful classification, query the result
const query: GetClassifiedTransactionQuery = {
  transactionId: 'kraken-123',
  requestId: 'req-query-001',
};

const queryResult = await queryHandler.execute(query);
```

### Expected Results

**Query Response**:

```typescript
{
  id: 'kraken-123',
  timestamp: '2025-09-24T10:00:00Z',
  source: { kind: 'exchange', venue: 'kraken', externalId: 'trade-456', importSessionId: 'session-1' },
  movements: [
    {
      id: 'mov-1',
      money: { amount: '100.00', currency: 'USD' },
      direction: 'OUT',
      classification: {
        purpose: 'PRINCIPAL',
        ruleId: 'exchange.kraken.trade.principal.v1',
        reason: 'Kraken trade principal movement',
        version: '1.0.0',
        confidence: 1.0,
        classifiedAt: '2025-09-24T10:05:00Z'
      }
    },
    // ... other classified movements
  ],
  purposeRulesetVersion: '1.0.0'
}
```

---

## Integration Test Implementation

### Test Setup

```typescript
// Test container setup with real dependencies
const container = new TestContainer();
container.register('ProcessTransactionCommandHandler', KrakenProcessTransactionHandler);
container.register('ClassifyMovementsCommandHandler', MVPPurposeClassifier);
container.register('GetClassifiedTransactionQueryHandler', ClassifiedTransactionQueryHandler);
container.register('TransactionValidator', MVPTransactionValidator);
```

### Test Database

```sql
-- Test database setup (ephemeral SQLite)
CREATE TABLE processed_transactions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_venue_or_chain TEXT NOT NULL,
  external_id TEXT NOT NULL,
  import_session_id TEXT NOT NULL
);

CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  tx_id TEXT NOT NULL REFERENCES processed_transactions(id),
  amount_value TEXT NOT NULL,
  amount_currency TEXT NOT NULL,
  direction TEXT NOT NULL,
  hint TEXT,
  sequence INTEGER
);

CREATE TABLE movement_classifications (
  movement_id TEXT PRIMARY KEY REFERENCES movements(id),
  purpose TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  version TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  classified_at TEXT NOT NULL
);
```

### Golden Test Data

The quickstart uses golden test data files for consistent validation:

- `golden/kraken-trade-raw.json` - Raw Kraken trade data
- `golden/kraken-trade-processed.json` - Expected ProcessedTransaction
- `golden/kraken-trade-classified.json` - Expected ClassifiedTransaction
- `golden/eth-transfer-raw.json` - Raw Ethereum transaction data
- `golden/eth-transfer-processed.json` - Expected ProcessedTransaction
- `golden/eth-transfer-classified.json` - Expected ClassifiedTransaction

### Running Integration Tests

```bash
# Run quickstart integration tests
pnpm test specs/003-replace-universaltransaction-with/quickstart.test.ts

# Expected output:
# ✓ Scenario 1: Kraken spot trade classification
# ✓ Scenario 2: Ethereum transfer classification
# ✓ Scenario 3: Deterministic processing
# ✓ Scenario 4: Validation failure handling
# ✓ Scenario 5: Query classified transaction
#
# All scenarios: 5 passed, 0 failed
```

This quickstart validates the core MVP functionality while demonstrating clear separation between "what happened" (movements) vs "why it happened" (purposes) through deterministic classification rules.
