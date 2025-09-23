# Data Model: ProcessedTransaction + Purpose Classifier

**Date**: 2025-09-23
**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

## Overview

This document defines the data models for the three-stage transaction processing pipeline that replaces UniversalTransaction with a cleaner separation of concerns. All new types will be added to the existing `packages/core/src/types.ts` structure alongside current types.

## Core Entities

### ProcessedTransaction

Represents factual money movements with source metadata and event context, without accounting interpretations.

```typescript
interface ProcessedTransaction {
  // Identity and Source Tracking
  id: string;                    // Unique per (source, sourceUid, id) tuple
  sourceUid: string;             // User/account identifier within source
  source: TransactionSource;     // Exchange, blockchain network, etc.
  sourceSpecific: SourceDetails; // Tagged union for source-specific metadata

  // Timing and Context
  timestamp: Date;               // Transaction occurrence time
  blockNumber?: number;          // For blockchain transactions
  eventType: TransactionEventType; // TRADE, TRANSFER, REWARD, etc.

  // Financial Movements
  movements: Movement[];         // Array of individual asset flows

  // Processing Metadata
  processedAt: Date;             // When this was created by processor
  processorVersion: string;      // Version of processor used
  validationStatus: ValidationStatus;

  // Audit and Linking
  originalData?: Record<string, unknown>; // Raw source data for auditing
  relatedTransactionIds?: string[];       // Links to related transactions
}
```

**ID Uniqueness**: The `id` field must be unique per `(source, sourceUid, id)` tuple to avoid cross-account collisions at the same venue while maintaining deterministic identification.

### Movement

Individual asset flow with currency, quantity, direction, and optional classification hints.

```typescript
interface Movement {
  // Asset and Quantity
  currency: string;              // Asset symbol (BTC, ETH, USD, etc.)
  amount: DecimalString;         // Precise amount using Decimal.js serialization
  direction: MovementDirection;  // IN or OUT relative to user's account

  // Classification Hints (for classifier)
  movementHint?: MovementHint;   // Processor's suggestion for purpose
  metadata: MovementMetadata;    // Additional context for classification

  // Linking and Audit
  movementId: string;            // Unique within transaction
  linkedMovementIds?: string[];  // Links to related movements (fee→principal)
}
```

**Direction Perspective**: Movement direction (IN/OUT) is relative to the user's targeted account/scope. For multi-account sessions, use `metadata.accountId` to specify which account the direction is relative to.

### MovementDirection

```typescript
enum MovementDirection {
  IN = 'IN',    // Asset flowing into user's account
  OUT = 'OUT'   // Asset flowing out of user's account
}
```

### MovementMetadata

```typescript
interface MovementMetadata {
  // Account Context
  accountId?: string;            // Specific account for multi-account scenarios

  // Transaction Context
  orderType?: OrderType;         // MARKET, LIMIT, STOP, etc.
  executionPrice?: DecimalString; // Price at which movement occurred

  // Network Context (for blockchain)
  gasUsed?: number;              // Gas consumed
  gasPrice?: DecimalString;      // Gas price paid
  fromAddress?: string;          // Source address
  toAddress?: string;            // Destination address

  // Classification Context
  venue?: string;                // Specific trading venue or DEX
  tradingPair?: string;          // BTC/USD, ETH/USDC, etc.

  // Audit Trail
  blockHash?: string;            // Blockchain block hash
  transactionHash?: string;      // Blockchain transaction hash
  confirmations?: number;        // Blockchain confirmations
}
```

### ClassifiedTransaction

ProcessedTransaction with finalized movement purposes and classification metadata.

```typescript
interface ClassifiedTransaction {
  // Base Transaction
  processedTransaction: ProcessedTransaction;

  // Classifications
  movements: ClassifiedMovement[];

  // Classification Metadata
  classifiedAt: Date;
  classifierVersion: string;

  // Audit Information
  classificationInfo: ClassificationInfo;
}
```

### ClassifiedMovement

```typescript
interface ClassifiedMovement {
  // Original Movement
  movement: Movement;

  // Assigned Purpose
  purpose: MovementPurpose;

  // Classification Metadata
  confidence: number;            // 0.0-1.0 confidence score
  ruleId: string;               // Identifier of rule used
  reasoning?: string;           // Human-readable explanation
}
```

### MovementPurpose

Comprehensive enumeration of business purposes for movement classification.

```typescript
enum MovementPurpose {
  // Trading
  PRINCIPAL = 'PRINCIPAL',           // Main trade amount
  TRADING_FEE = 'TRADING_FEE',      // Exchange trading fees

  // Transfers
  TRANSFER_SENT = 'TRANSFER_SENT',   // Transfer to external account
  TRANSFER_RECEIVED = 'TRANSFER_RECEIVED', // Transfer from external account
  TRANSFER_FEE = 'TRANSFER_FEE',     // Network/transfer fees

  // Network Operations
  GAS_FEE = 'GAS_FEE',              // Blockchain gas costs
  NETWORK_FEE = 'NETWORK_FEE',      // General network fees

  // Rewards and Staking
  STAKING_REWARD = 'STAKING_REWARD', // Staking rewards
  MINING_REWARD = 'MINING_REWARD',   // Mining rewards
  INTEREST = 'INTEREST',             // Interest payments
  DIVIDEND = 'DIVIDEND',             // Dividend payments
  AIRDROP = 'AIRDROP',              // Token airdrops

  // DeFi Operations
  LIQUIDITY_PROVISION = 'LIQUIDITY_PROVISION', // LP token creation
  LIQUIDITY_REMOVAL = 'LIQUIDITY_REMOVAL',     // LP token burning
  LENDING = 'LENDING',                         // Lending operations
  BORROWING = 'BORROWING',                     // Borrowing operations
  COLLATERAL = 'COLLATERAL',                   // Collateral deposits

  // Margin and Derivatives
  MARGIN_FEE = 'MARGIN_FEE',        // Margin trading fees
  FUNDING_FEE = 'FUNDING_FEE',      // Perpetual funding fees
  LIQUIDATION = 'LIQUIDATION',       // Liquidation events

  // Administrative
  DEPOSIT = 'DEPOSIT',               // Fiat/crypto deposits
  WITHDRAWAL = 'WITHDRAWAL',         // Fiat/crypto withdrawals
  ADJUSTMENT = 'ADJUSTMENT',         // Exchange adjustments

  // Special Cases
  DUST_CONVERSION = 'DUST_CONVERSION', // Small balance conversions
  FORK = 'FORK',                     // Blockchain fork events
  OTHER = 'OTHER'                    // Fallback for unclassified
}
```

### ClassificationInfo

Audit metadata for classification decisions.

```typescript
interface ClassificationInfo {
  // Rule Tracking
  ruleSetVersion: string;        // Version of classification rules
  appliedRules: AppliedRule[];   // All rules evaluated

  // Confidence Metrics
  overallConfidence: number;     // 0.0-1.0 overall confidence
  lowConfidenceMovements: string[]; // Movement IDs with low confidence

  // Audit Trail
  manualOverrides?: ManualOverride[]; // Any manual classifications
  reprocessingHistory?: ReprocessingEvent[]; // Previous classifications
}
```

### AppliedRule

```typescript
interface AppliedRule {
  ruleId: string;                // Unique rule identifier
  ruleName: string;              // Human-readable rule name
  matched: boolean;              // Whether rule matched
  confidence: number;            // Rule-specific confidence
  reasoning: string;             // Why rule matched/didn't match
}
```

## Supporting Types

### TransactionSource

```typescript
interface TransactionSource {
  type: SourceType;              // EXCHANGE, BLOCKCHAIN, CSV, etc.
  name: string;                  // Kraken, Bitcoin, Ethereum, etc.
  apiVersion?: string;           // Provider API version
}

enum SourceType {
  EXCHANGE = 'EXCHANGE',
  BLOCKCHAIN = 'BLOCKCHAIN',
  CSV_IMPORT = 'CSV_IMPORT',
  MANUAL_ENTRY = 'MANUAL_ENTRY'
}
```

### SourceDetails

Tagged union capturing source-specific metadata.

```typescript
type SourceDetails =
  | ExchangeDetails
  | BlockchainDetails
  | CsvDetails
  | ManualDetails;

interface ExchangeDetails {
  type: 'EXCHANGE';
  orderId?: string;              // Exchange order identifier
  tradeId?: string;              // Exchange trade identifier
  symbol?: string;               // Trading pair symbol
  orderType?: OrderType;         // Order type
  executionPrice?: DecimalString; // Execution price
}

interface BlockchainDetails {
  type: 'BLOCKCHAIN';
  network: string;               // bitcoin, ethereum, solana, etc.
  txHash: string;                // Transaction hash
  blockNumber?: number;          // Block number
  gasUsed?: number;              // Gas consumed
  gasPrice?: DecimalString;      // Gas price
  fromAddress?: string;          // Source address
  toAddress?: string;            // Destination address
}
```

### TransactionEventType

```typescript
enum TransactionEventType {
  TRADE = 'TRADE',               // Buy/sell operations
  TRANSFER = 'TRANSFER',         // Asset transfers
  DEPOSIT = 'DEPOSIT',           // Fiat/crypto deposits
  WITHDRAWAL = 'WITHDRAWAL',     // Fiat/crypto withdrawals
  REWARD = 'REWARD',             // Staking/mining rewards
  FEE_PAYMENT = 'FEE_PAYMENT',   // Fee-only transactions
  ADJUSTMENT = 'ADJUSTMENT',     // Balance adjustments
  SWAP = 'SWAP',                 // Token swaps
  LENDING = 'LENDING',           // DeFi lending
  STAKING = 'STAKING',           // Staking operations
  OTHER = 'OTHER'                // Fallback category
}
```

## Validation Rules

### Processor-Time Validation

1. **Zero-Sum Transfers**: Transfer transactions must have balanced IN/OUT movements
2. **Required Fields**: All core fields must be present and valid
3. **Currency Consistency**: Currency codes must follow established patterns
4. **Amount Precision**: Decimal amounts must be valid and properly formatted
5. **ID Uniqueness**: Transaction ID must be unique per (source, sourceUid, id) scope

### Classifier-Time Validation

1. **Complete Classification**: Every movement must have an assigned purpose
2. **Confidence Thresholds**: Movements below confidence threshold flagged for review
3. **Purpose Consistency**: Related movements must have compatible purposes
4. **Venue Awareness**: Classification must consider venue-specific patterns

### Transformer-Time Validation

1. **Valued Requirements**: High-value transactions must meet additional validation
2. **Cost Basis Consistency**: Purchase/sale pairs must have valid cost basis
3. **Tax Compliance**: Classifications must support tax reporting requirements
4. **Audit Completeness**: Full audit trail must be preserved

## State Transitions

### ProcessedTransaction Lifecycle

```
Raw Source Data → ProcessedTransaction → ClassifiedTransaction → AccountingEntry
```

1. **Processing**: Raw data transformed to ProcessedTransaction by processor
2. **Classification**: ProcessedTransaction analyzed and classified by purpose classifier
3. **Transformation**: ClassifiedTransaction converted to accounting entries by transformer

### Movement Lifecycle

```
Movement → ClassifiedMovement → AccountingMovement
```

Each movement follows the same pipeline independently, enabling parallel processing.

## Migration Compatibility

### Backward Compatibility Shim

During the 1-2 sprint migration period, a compatibility shim will provide bidirectional conversion:

```typescript
interface UniversalTransactionShim {
  // Convert legacy to new format
  toProcessedTransaction(ut: UniversalTransaction): ProcessedTransaction;

  // Convert new format to legacy (lossy conversion)
  fromProcessedTransaction(pt: ProcessedTransaction): UniversalTransaction;

  // Validate equivalence during parallel processing
  validateEquivalence(ut: UniversalTransaction, pt: ProcessedTransaction): boolean;
}
```

**Shim Constraints**:
- Conversion from ProcessedTransaction to UniversalTransaction is lossy (multi-movement → single amount/fee)
- Validation ensures no data loss for supported transaction types
- Shim removed after migration time-box expires

## Extension Points

### Adding New MovementPurpose Values

1. Add new enum value to MovementPurpose
2. Update classification rules to handle new purpose
3. Update transformer to generate appropriate accounting entries
4. Version bump classification rule set

### Adding New Source Types

1. Extend SourceDetails tagged union with new source type
2. Implement processor for new source type
3. Add source-specific validation rules
4. Register with provider registry system

## Schema Compatibility

All types are designed to be:
- **Serializable**: JSON-compatible with proper Decimal.js handling
- **Versioned**: Include version fields for backward compatibility
- **Extensible**: Support addition of new fields without breaking changes
- **Validatable**: Compatible with Zod schema validation patterns