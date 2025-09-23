# Data Model: ProcessedTransaction + Purpose Classifier

**Date**: 2025-09-23
**Feature**: Replace UniversalTransaction with ProcessedTransaction + Purpose Classifier

## Entity Overview

### ProcessedTransaction
**Purpose**: Intermediate representation of financial movements without accounting decisions
**Location**: `packages/core/src/types.ts` (replaces UniversalTransaction)

**Fields**:
- `id: ExternalId` - Upstream-stable identifier
- `source: string` - Data source identifier (e.g., 'kraken', 'mempool.space')
- `sourceUid?: string` - Account/address scope at the source
- `eventType: EventType` - High-level event classification
- `description?: string` - Human-readable description
- `timestamp: IsoTimestamp` - ISO-8601 timestamp (UTC)
- `movements: MovementUnclassified[]` - Array of financial movements
- `sourceDetails: SourceDetails` - Tagged union of source-specific metadata

**Validation Rules**:
- `id` must be unique within source scope
- `timestamp` must be valid ISO-8601
- `movements` array must not be empty
- `eventType` must match movement patterns (e.g., 'trade' requires 2+ movements)

### Movement (Base)
**Purpose**: Individual asset flow within a transaction

**Common Fields**:
- `movementId: MovementId` - Unique identifier within transaction
- `groupId?: string` - Clusters related movements (e.g., trade legs)
- `currency: string` - Asset identifier (e.g., 'BTC', 'USDT', 'ETH')
- `quantity: DecimalString` - Always positive amount (Decimal.js serialized)
- `direction: MovementDirection` - 'IN' (to user) or 'OUT' (from user)

### MovementUnclassified extends Movement
**Purpose**: Movement before purpose classification

**Additional Fields**:
- `purpose?: MovementPurpose` - Optional hint (only when indisputable)
- `metadata?: MovementMetadata` - Classification hints and context

### MovementClassified extends Movement
**Purpose**: Movement after purpose classification

**Additional Fields**:
- `purpose: MovementPurpose` - Required, finalized purpose
- `metadata?: MovementMetadata` - Classification hints and context
- `classification: ClassificationInfo` - Audit trail for classification decision

### ClassifiedTransaction
**Purpose**: ProcessedTransaction with all movements classified

**Fields**: Same as ProcessedTransaction except:
- `movements: MovementClassified[]` - All movements have finalized purposes
- `purposeRulesetVersion: string` - Version stamp for audit trail

## Supporting Types

### MovementPurpose (Enum)
**Values**:
- `PRINCIPAL` - Main asset being traded/transferred
- `FEE` - Exchange or platform fees
- `GAS` - Blockchain network fees
- `REWARD` - Staking, mining, or referral rewards
- `INTEREST` - Lending/borrowing interest
- `COLLATERAL` - Collateral for lending/trading
- `FUNDING_RATE` - Perpetual funding payments
- `REBATE` - Fee rebates or cashbacks
- `REFERRAL_BONUS` - Referral program rewards
- `COLLATERAL_UNLOCK` - Released collateral
- `LIQUIDATION_PENALTY` - Liquidation fees/penalties
- `OTHER` - Fallback (requires detailed metadata)

### EventType
**Values**: 'trade' | 'transfer' | 'fee_only' | 'reward' | 'interest' | 'bridge' | 'lend' | 'borrow' | 'liquidation' | 'other'

### SourceDetails (Tagged Union)
**Variants**:
```typescript
| { kind: 'exchange'; venue: string; accountId?: string; orderId?: string; tradeId?: string; symbol?: string; side?: 'buy' | 'sell' }
| { kind: 'blockchain'; chain: string; txHash: string; blockHeight?: number; gasUsed?: DecimalString; gasPrice?: DecimalString; addressScope?: string }
| { kind: 'other'; subtype?: string; [k: string]: unknown }
```

### MovementMetadata
**Fields**:
- `purposeHint?: MovementPurpose` - Soft hint for classifier
- `feeType?: FeeType` - Distinguishes venue vs network fees
- `relatedMovementId?: MovementId` - Links movements (e.g., principal to fee)
- `accountId?: string` - Sub-account scope if needed
- `address?: string` - Wallet/exchange address context
- `[key: string]: unknown` - Extensible for future metadata

### ClassificationInfo
**Fields**:
- `ruleId: string` - Stable rule identifier for debugging
- `confidence: number` - Classification confidence (0..1)
- `reason: string` - Human-readable explanation
- `version: string` - Ruleset version (e.g., "1.0.0")

## State Transitions

### Processing Flow
1. **Raw Data → ProcessedTransaction**: Processors convert source data to movements
2. **ProcessedTransaction → ClassifiedTransaction**: Classifier assigns purposes
3. **ClassifiedTransaction → Accounting Records**: Transformer applies business rules

### Movement State Progression
1. **Unclassified**: Optional purpose hint, rich metadata
2. **Classified**: Required purpose, classification audit trail

## Validation Constraints

### Processor-Time Validation
- **Zero-sum transfers**: Net movements per currency must equal zero (excluding fees)
- **Trade validation**: Must have 2+ movements with different currencies
- **Required fields**: All mandatory fields present and valid

### Classifier-Time Validation
- **Complete classification**: Every movement must have finalized purpose
- **Rule application**: Classification info must be complete and valid
- **Confidence thresholds**: Low confidence classifications flagged for review

### Business Rule Examples
- **Trade Pattern**: 2+ PRINCIPAL movements in different currencies + optional FEE movements
- **Transfer Pattern**: 1 OUT movement + 1 IN movement (same currency) + optional GAS
- **Reward Pattern**: 1+ IN movements with REWARD purpose + optional FEE/GAS

## Migration Mapping

### From UniversalTransaction
- `amount` → Multiple `Movement` entries with `quantity` and `direction`
- `fee` → Separate `Movement` with `purpose: FEE`
- `type` → `eventType` + movement `purpose` classifications
- `metadata` → Distributed across `sourceDetails` and movement `metadata`
- Single transaction → Multiple movements representing all asset flows

### Key Changes
- **Multi-movement support**: Complex transactions properly represented
- **Purpose separation**: Business classification separate from flow description
- **Audit trail**: Complete classification history for compliance
- **Type safety**: Stronger validation through Zod schemas