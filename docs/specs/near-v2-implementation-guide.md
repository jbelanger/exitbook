# NEAR V2 Implementation Guide

## Overview

This document provides the complete implementation plan for refactoring the NEAR blockchain integration to follow NEAR's native receipt-based execution model. This is a ground-up rewrite that fixes fundamental architectural issues in the V1 implementation.

## Table of Contents

1. [Problems with V1](#problems-with-v1)
2. [V2 Architecture](#v2-architecture)
3. [Data Model Layers](#data-model-layers)
4. [Schema Definitions](#schema-definitions)
5. [Implementation Plan](#implementation-plan)
6. [File Structure](#file-structure)
7. [Migration Strategy](#migration-strategy)
8. [Testing Strategy](#testing-strategy)
9. [Acceptance Criteria](#acceptance-criteria)

---

## Problems with V1

### Architectural Issues

1. **Wrong Event Granularity**: Treats NEAR transactions as single flat events (Solana-style) instead of receipt-based execution trees
2. **Wrong Schema Fields**: Uses generic `from/to/amount` (required) instead of NEAR-native `signer_id/receiver_id/attached_deposit`
3. **Missing Core Identity**: No `receipt_id` field, which is the fundamental unit of execution in NEAR
4. **Incorrect Amount Semantics**: Calculates `amount = sum(attached_deposit)` which does NOT represent actual fund transfers
5. **Lost NEAR Semantics**: Cannot represent multi-receipt transactions, receipt kinds, or per-receipt outcomes
6. **Forced Solana Model**: Primary data in generic fields, NEAR-specific data relegated to optional arrays

### Code Evidence

```typescript
// V1 Schema - WRONG
export const NearTransactionSchema = NormalizedTransactionBaseSchema.extend({
  amount: DecimalStringSchema, // ❌ Required generic field
  currency: z.string().min(1), // ❌ Required generic field
  from: NearAccountIdSchema, // ❌ Required generic field
  to: NearAccountIdSchema, // ❌ Required generic field

  // NEAR-native fields are optional/secondary
  actions: z.array(NearActionSchema).optional(),
  accountChanges: z.array(NearAccountChangeSchema).optional(),
});

// V1 Mapper - WRONG
const normalized: NearTransaction = {
  amount: totalDeposit, // ❌ Sum of deposits ≠ transfer amount!
  from: rawData.signer_account_id, // ❌ Loses NEAR semantics
  to: rawData.receiver_account_id, // ❌ Loses NEAR semantics
};
```

---

## V2 Architecture

### Core Principles

1. **Receipt-First Event Model**: One receipt = one normalized event (with arrays of changes/transfers)
2. **NEAR-Native Schemas**: Use NEAR field names (`signer_id`, `receiver_id`, `attached_deposit`, etc.)
3. **Stable Event Identity**: `receipt_id` is the unique event identifier
4. **Fees as Metadata**: Fees attached to events (from `tokens_burnt`, payer = `predecessor`)
5. **Layered Data Flow**: Raw Provider Data → NEAR-Native Normalized → Accounting Projection
6. **Separation of Concerns**: Don't corrupt normalized data with accounting assumptions

### Data Flow

```
NearBlocks API Responses
  ↓
Raw Provider Schemas (minimal normalization: types only)
  ↓
NEAR-Native Normalized Models (preserve NEAR semantics)
  ↓
Accounting Projection (derive fund flows for portfolio tracking)
  ↓
Universal Transaction (existing accounting pipeline)
```

### Key Design Decisions

1. **Event Granularity = Receipt Level**
   - One transaction can spawn multiple receipts
   - Each receipt becomes exactly one event
   - Event ID is the `receipt_id` (globally unique)

2. **No Inferred Transfers**
   - `attached_deposit` is NOT a transfer amount (it's gas/stake/contract payment)
   - Actual fund flows come from `NearBalanceChange` (account deltas)
   - Token transfers come from `NearTokenTransfer` (NEP-141 events)

3. **Hierarchical Data Structure**
   - `NearTransaction` (envelope with transaction-level metadata)
   - `NearReceipt[]` (array of receipts spawned by transaction)
   - Each receipt has actions, outcome, balance changes, token transfers

4. **Accounting is Derived**
   - Build `NearFundFlow` projection from balance deltas and token transfers
   - Map fund flows to `UniversalTransaction` in processor
   - Keep normalized layer clean of accounting logic

---

## Data Model Layers

### Layer 1: Raw Provider Schemas

**Purpose**: Preserve NearBlocks API responses with minimal transformation

**Transformations Allowed**:

- Type normalization (string numbers → `DecimalStringSchema`)
- Null/undefined normalization
- Date/timestamp parsing to Unix milliseconds

**Transformations NOT Allowed**:

- Semantic interpretation (don't infer transfer direction, amounts, etc.)
- Field renaming or restructuring
- Aggregation or derivation

**Location**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/nearblocks.schemas.ts`

### Layer 2: NEAR-Native Normalized Schemas

**Purpose**: Provider-agnostic NEAR data models that preserve blockchain semantics

**Key Models**:

- `NearTransaction`: Transaction envelope (signer initiates)
- `NearReceipt`: Receipt execution (where state changes happen)
- `NearAction`: Individual action within a receipt
- `NearBalanceChange`: Account balance delta (NEAR native token)
- `NearTokenTransfer`: NEP-141 token transfer
- `NearReceiptOutcome`: Execution result (status, gas, logs)

**Location**: `packages/blockchain-providers/src/blockchains/near/schemas.ts`

### Layer 3: Accounting Projection

**Purpose**: Derive fund flows for portfolio tracking

**Key Models**:

- `NearFundFlow`: A single asset movement (source → destination)
- Maps to `UniversalTransaction` for accounting pipeline

**Location**: `packages/ingestion/src/sources/blockchains/near/types.ts`

---

## Schema Definitions

### Core NEAR Schemas

#### NearReceiptOutcome

```typescript
/**
 * Execution outcome for a NEAR receipt
 * Represents the result of executing a receipt's actions
 */
export const NearReceiptOutcomeSchema = z.object({
  /** Execution status - true if successful, false if failed */
  status: z.boolean(),

  /** Gas consumed during execution (in gas units, not yoctoNEAR) */
  gasBurnt: DecimalStringSchema,

  /** NEAR tokens burned as fees (in yoctoNEAR) */
  tokensBurntYocto: DecimalStringSchema,

  /** Execution logs emitted during receipt processing */
  logs: z.array(z.string()).optional(),

  /** Executor account that processed this receipt */
  executorAccountId: NearAccountIdSchema,
});

export type NearReceiptOutcome = z.infer<typeof NearReceiptOutcomeSchema>;
```

#### NearAction

```typescript
/**
 * Individual action within a NEAR receipt
 * Actions are the atomic operations performed by a receipt
 */
export const NearActionSchema = z.object({
  /**
   * Type of action (e.g., "CreateAccount", "Transfer", "FunctionCall")
   * Normalized to snake_case: "function_call", "create_account", etc.
   */
  actionType: z.string().min(1),

  /** Method name for FunctionCall actions */
  methodName: z.string().optional(),

  /** Method arguments (base64 or parsed JSON) */
  args: z.unknown().optional(),

  /**
   * Attached deposit in yoctoNEAR
   * NOT the same as transfer amount - used for gas, staking, contract calls
   */
  attachedDeposit: DecimalStringSchema.optional(),

  /** Gas allocation for this action (in gas units) */
  gas: DecimalStringSchema.optional(),

  /** Public key for AddKey/DeleteKey actions */
  publicKey: z.string().optional(),

  /** Beneficiary account for DeleteAccount action */
  beneficiaryId: NearAccountIdSchema.optional(),
});

export type NearAction = z.infer<typeof NearActionSchema>;
```

#### NearReceipt

```typescript
/**
 * NEAR receipt - the fundamental unit of execution
 * A transaction spawns one or more receipts, and receipts can spawn more receipts
 */
export const NearReceiptSchema = z.object({
  /** Unique receipt identifier (primary identity for execution events) */
  receiptId: z.string().min(1),

  /** Parent transaction hash that spawned this receipt */
  transactionHash: z.string().min(1),

  /** Account that triggered the receipt (may differ from transaction signer) */
  predecessorId: NearAccountIdSchema,

  /** Account that receives/executes the receipt */
  receiverId: NearAccountIdSchema,

  /**
   * Receipt kind: "ACTION", "DATA", or "REFUND"
   * Most receipts are ACTION receipts with executable actions
   */
  receiptKind: z.enum(['ACTION', 'DATA', 'REFUND']),

  /** Block height where receipt was executed */
  blockHeight: z.number().nonnegative(),

  /** Block hash where receipt was executed */
  blockHash: z.string().optional(),

  /** Block timestamp (Unix milliseconds) */
  blockTimestamp: z.number().positive(),

  /** Actions executed by this receipt (for ACTION receipts) */
  actions: z.array(NearActionSchema).optional(),

  /** Execution outcome (status, gas, fees) */
  outcome: NearReceiptOutcomeSchema.optional(),

  /** Account balance changes caused by this receipt */
  balanceChanges: z.array(NearBalanceChangeSchema).optional(),

  /** Token transfers caused by this receipt (NEP-141) */
  tokenTransfers: z.array(NearTokenTransferSchema).optional(),
});

export type NearReceipt = z.infer<typeof NearReceiptSchema>;
```

#### NearTransaction

```typescript
/**
 * NEAR transaction envelope
 * The transaction initiates execution but receipts perform the actual state changes
 */
export const NearTransactionSchema = z.object({
  /** Transaction hash (primary transaction identity) */
  transactionHash: z.string().min(1),

  /** Account that signed and initiated the transaction */
  signerId: NearAccountIdSchema,

  /** Intended receiver of the transaction (becomes first receipt's receiver) */
  receiverId: NearAccountIdSchema,

  /** Block where transaction was included */
  blockHeight: z.number().nonnegative(),

  /** Block hash */
  blockHash: z.string().optional(),

  /** Block timestamp (Unix milliseconds) */
  blockTimestamp: z.number().positive(),

  /**
   * Transaction-level actions (may differ from receipt actions)
   * The transaction actions are converted into receipt actions
   */
  actions: z.array(NearActionSchema),

  /** Overall transaction status (derived from receipt outcomes) */
  status: z.enum(['success', 'failed', 'pending']),

  /**
   * Receipts spawned by this transaction
   * One transaction can create multiple receipts
   */
  receipts: z.array(NearReceiptSchema),

  /** Provider that supplied this data */
  providerName: z.string().min(1),
});

export type NearTransaction = z.infer<typeof NearTransactionSchema>;
```

#### NearBalanceChange

```typescript
/**
 * Account balance change for NEAR native token
 * Represents the actual fund movement, not attached deposits
 */
export const NearBalanceChangeSchema = z.object({
  /** Account whose balance changed */
  accountId: NearAccountIdSchema,

  /** Balance before the receipt execution (in yoctoNEAR) */
  preBalance: DecimalStringSchema,

  /** Balance after the receipt execution (in yoctoNEAR) */
  postBalance: DecimalStringSchema,

  /**
   * Receipt that caused this balance change (optional, provided by NearBlocks)
   * When present, allows direct correlation to receipt
   */
  receiptId: z.string().min(1).optional(),

  /** Parent transaction hash (usually present) */
  transactionHash: z.string().min(1).optional(),

  /** Block timestamp (for fallback correlation) */
  blockTimestamp: z.number().positive(),
});

export type NearBalanceChange = z.infer<typeof NearBalanceChangeSchema>;
```

#### NearTokenTransfer

```typescript
/**
 * NEP-141 fungible token transfer
 * These are parsed from FunctionCall actions and logs
 */
export const NearTokenTransferSchema = z.object({
  /** Token contract address */
  contractId: NearAccountIdSchema,

  /** Sender account */
  from: NearAccountIdSchema,

  /** Recipient account */
  to: NearAccountIdSchema,

  /** Transfer amount (normalized by decimals) */
  amount: DecimalStringSchema,

  /** Token decimals */
  decimals: z.number().nonnegative(),

  /** Token symbol (if known) */
  symbol: z.string().optional(),

  /** Receipt that contained this transfer */
  receiptId: z.string().min(1),

  /** Parent transaction hash */
  transactionHash: z.string().min(1),

  /** Block timestamp */
  blockTimestamp: z.number().positive(),
});

export type NearTokenTransfer = z.infer<typeof NearTokenTransferSchema>;
```

### Normalized Event Schema

The "normalized event" that flows through the ingestion pipeline needs a stable identity:

```typescript
/**
 * Normalized NEAR event for ingestion pipeline
 * Represents a single receipt execution event
 *
 * Event granularity: ONE RECEIPT = ONE EVENT
 * - One receipt may have multiple balance changes and token transfers (stored as arrays)
 * - The accounting projection extracts multiple fund flows from a single event
 * - This avoids fee duplication and maintains semantic correctness
 */
export const NearReceiptEventSchema = NormalizedTransactionBaseSchema.extend({
  /** Transaction hash (parent transaction) */
  id: z.string().min(1),

  /** Receipt ID (unique event identifier) */
  receiptId: z.string().min(1),

  /** NEAR-native fields */
  signerId: NearAccountIdSchema,
  receiverId: NearAccountIdSchema,
  predecessorId: NearAccountIdSchema,

  /** Receipt metadata */
  receiptKind: z.enum(['ACTION', 'DATA', 'REFUND']),
  actions: z.array(NearActionSchema).optional(),

  /** Receipt outcome */
  status: z.enum(['success', 'failed', 'pending']),
  gasBurnt: DecimalStringSchema.optional(),
  tokensBurntYocto: DecimalStringSchema.optional(),

  /**
   * Fee paid for this receipt execution
   * Derived from tokens_burnt (already in yoctoNEAR)
   * Payer is the predecessor (who pays for this receipt's execution)
   */
  fee: z
    .object({
      amountYocto: DecimalStringSchema,
      payer: NearAccountIdSchema,
    })
    .optional(),

  /** Block data */
  blockHeight: z.number().nonnegative(),
  blockHash: z.string().optional(),
  timestamp: z.number().positive(),

  /**
   * Balance changes for NEAR native token (may be multiple)
   * Note: Deltas already include fee impact - don't double-subtract
   */
  balanceChanges: z.array(NearBalanceChangeSchema).optional(),

  /**
   * Token transfers for NEP-141 tokens (may be multiple)
   */
  tokenTransfers: z.array(NearTokenTransferSchema).optional(),

  /** Provider */
  providerName: z.string().min(1),
});

export type NearReceiptEvent = z.infer<typeof NearReceiptEventSchema>;
```

### Accounting Projection Schema

```typescript
/**
 * Fund flow derived from NEAR receipt events for accounting
 * One receipt event may produce multiple fund flows
 *
 * Important: Balance changes already include fee impact in their net deltas.
 * Fee flows are extracted separately for informational/tracking purposes.
 * The accounting pipeline must not double-subtract fees from balance change flows.
 */
export const NearFundFlowSchema = z.object({
  /** Receipt ID (links to NearReceiptEvent) */
  receiptId: z.string().min(1),

  /** Transaction hash */
  transactionHash: z.string().min(1),

  /** Flow type */
  flowType: z.enum(['native_balance_change', 'token_transfer', 'fee']),

  /** Asset (symbol or contract address) */
  asset: z.string().min(1),

  /** Amount (normalized to asset decimals) */
  amount: DecimalStringSchema,

  /** Decimals */
  decimals: z.number().nonnegative(),

  /** Source account (undefined for receives) */
  from: NearAccountIdSchema.optional(),

  /** Destination account (undefined for sends) */
  to: NearAccountIdSchema.optional(),

  /** Direction from queried account's perspective */
  direction: z.enum(['in', 'out', 'self']),

  /** Token contract (for token transfers) */
  contractId: NearAccountIdSchema.optional(),

  /** Timestamp */
  timestamp: z.number().positive(),
});

export type NearFundFlow = z.infer<typeof NearFundFlowSchema>;
```

---

## Implementation Plan

### Phase 1: Schema Layer

**Goal**: Define all schemas and validate them with tests

#### Step 1.1: Create New Schemas File

**File**: `packages/blockchain-providers/src/blockchains/near/schemas.v2.ts`

**Tasks**:

1. Create all NEAR-native schemas from [Schema Definitions](#schema-definitions)
2. Add JSDoc comments explaining NEAR semantics
3. Export types inferred from schemas

**Validation**:

- [ ] All schemas compile without errors
- [ ] Schemas match NEAR protocol documentation
- [ ] Field names match NEAR's terminology

#### Step 1.2: Schema Unit Tests

**File**: `packages/blockchain-providers/src/blockchains/near/__tests__/schemas.v2.test.ts`

**Tasks**:

1. Test valid NEAR data passes validation
2. Test invalid data is rejected with clear errors
3. Test edge cases (empty arrays, missing optional fields, etc.)
4. Test account ID validation (implicit accounts, named accounts, sub-accounts)

**Validation**:

- [ ] 100% schema coverage
- [ ] All validation rules tested
- [ ] Clear error messages for validation failures

#### Step 1.3: Fee Extraction Utility

**File**: `packages/blockchain-providers/src/blockchains/near/utils.v2.ts`

**Function**:

```typescript
/**
 * Extract fee information from receipt outcome
 *
 * @param tokensBurntYocto - Fee amount in yoctoNEAR (from receipt outcome)
 * @param predecessorId - The account that pays for this receipt's execution
 * @returns Fee object or undefined if no fee
 */
export function extractReceiptFee(params: {
  tokensBurntYocto?: string;
  predecessorId: string;
}): { amountYocto: string; payer: string } | undefined {
  if (!params.tokensBurntYocto || new Decimal(params.tokensBurntYocto).isZero()) {
    return undefined;
  }

  return {
    amountYocto: params.tokensBurntYocto,
    payer: params.predecessorId, // Predecessor pays for receipt execution
  };
}
```

**Tests**:

- [ ] Returns fee when tokensBurntYocto present
- [ ] Returns undefined when tokensBurntYocto is zero or missing
- [ ] Uses predecessorId as payer
- [ ] Preserves exact yoctoNEAR amount

### Phase 2: NearBlocks Provider V2

**Goal**: Rewrite NearBlocks provider to emit receipt-based events

#### Step 2.1: Update NearBlocks Raw Schemas

**File**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/nearblocks.schemas.ts`

**Tasks**:

1. Add receipt-level raw schemas:
   - `NearBlocksReceiptSchema`
   - `NearBlocksReceiptOutcomeSchema`
   - `NearBlocksActionSchema`
2. Update transaction schema to include receipts array
3. Keep existing schemas for backward compatibility during migration

**Validation**:

- [ ] Schemas match NearBlocks API responses
- [ ] Handle all NearBlocks API quirks (null vs undefined, missing fields, etc.)

#### Step 2.2: API Client Updates

**File**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/nearblocks.api-client.ts`

**New Endpoints**:

```typescript
/**
 * Fetch receipts for a transaction
 * Endpoint: GET /v1/account/{account}/receipts
 * Uses cursor-based pagination for consistency with activities endpoint
 */
async fetchTransactionReceipts(params: {
  accountId: string;
  cursor?: string;
  perPage?: number;
}): Promise<Result<{ receipts: NearBlocksReceipt[]; nextCursor?: string }, Error>>

/**
 * Fetch account activity (balance changes)
 * Endpoint: GET /v1/account/{account}/activities
 * Uses cursor-based pagination (NearBlocks API provides cursor in response)
 */
async fetchAccountActivity(params: {
  accountId: string;
  cursor?: string;
  perPage?: number;
}): Promise<Result<{ activities: NearBlocksActivity[]; nextCursor?: string }, Error>>

/**
 * Fetch account FT (fungible token) transfers
 * Endpoint: GET /v1/account/{account}/ft-txns
 * Uses cursor-based pagination
 */
async fetchAccountFtTransfers(params: {
  accountId: string;
  cursor?: string;
  perPage?: number;
}): Promise<Result<{ transfers: NearBlocksFtTransaction[]; nextCursor?: string }, Error>>
```

**Validation**:

- [ ] New endpoints return correct data
- [ ] Error handling for missing receipts
- [ ] Cursor-based pagination works correctly and cursors are persisted for resume
- [ ] Safety cap still prevents unbounded enrichment fetches

#### Step 2.3: Mapper V2 - Transaction Enrichment

**File**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/mapper-utils.v2.ts`

**Strategy**: Multi-step enrichment process

```typescript
/**
 * Map NearBlocks transaction to NEAR-native normalized model
 *
 * Process:
 * 1. Map base transaction data (signer, receiver, actions, status)
 * 2. Fetch and map receipts for this transaction
 * 3. Fetch and map account activity (balance changes)
 * 4. Fetch and map FT transfers
 * 5. Correlate receipts with balance changes and token transfers
 * 6. Generate events (one receipt = one event with arrays)
 */
export function mapNearBlocksTransactionToReceiptEvents(params: {
  transaction: NearBlocksTransaction;
  receipts: NearBlocksReceipt[];
  activity: NearBlocksActivity[];
  ftTransfers: NearBlocksFtTransaction[];
  accountId: string;
}): Result<NearReceiptEvent[], NormalizationError>;
```

**Key Mapping Functions**:

1. **`mapNearBlocksReceipt`**: Receipt raw → normalized
2. **`mapNearBlocksActivity`**: Activity → NearBalanceChange
3. **`mapNearBlocksFtTransfer`**: FT transfer → NearTokenTransfer
4. **`correlateReceiptWithChanges`**: Link balance changes to receipts
5. **`generateReceiptEvent`**: Build one event from a receipt (arrays + fee metadata)

**Correlation Logic**:

```typescript
/**
 * Correlate balance changes and token transfers with receipts
 *
 * NearBlocks provides:
 * - /txns endpoint: transaction + first receipt
 * - /receipts endpoint: all receipts for a transaction
 * - /activities endpoint: balance changes with receipt_id (optional) and transaction_hash
 * - /ft-txns endpoint: token transfers with receipt_id (required)
 *
 * Correlation strategy:
 * 1. Primary: Match by receipt_id (direct link) ✓
 * 2. Fallback: Match by transaction_hash + account heuristics (log warn)
 * 3. Last resort: Match by timestamp (log warn)
 * 4. If still uncorrelated, emit an event with `correlation: "unlinked"` in metadata and warn
 */
function correlateBalanceChanges(
  receipts: NearReceipt[],
  balanceChanges: NearBalanceChange[]
): Map<string, NearBalanceChange[]>;
```

**Event Generation**:

```typescript
/**
 * Generate receipt event from a single receipt
 *
 * Rule: ONE RECEIPT = ONE EVENT
 * - Receipt may have 0..N balance changes (stored as array)
 * - Receipt may have 0..N token transfers (stored as array)
 * - Fee is attached as metadata (from tokens_burnt, payer = predecessor)
 * - eventId = receiptId
 * - Accounting layer extracts multiple flows from this single event
 */
function generateReceiptEvent(receipt: NearReceipt): NearReceiptEvent;
```

**Validation**:

- [ ] All receipts are mapped (one receipt = one event)
- [ ] Balance changes correctly correlated to receipts (as arrays)
- [ ] Token transfers correctly correlated to receipts (as arrays)
- [ ] Fees extracted from tokensBurntYocto with predecessor as payer
- [ ] Multi-receipt transactions handled correctly
- [ ] Failed receipts include fee but may have empty balance changes

#### Step 2.4: Integration into API Client

**File**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/nearblocks.api-client.ts`

**New Method**:

```typescript
/**
 * Fetch enriched transaction with all related data
 * This is the V2 endpoint that returns receipt-based events
 */
async fetchReceiptEventsForTransaction(params: {
  accountId: string;
  transactionHash: string;
}): Promise<Result<NearReceiptEvent[], Error>> {
  // 1. Fetch base transaction
  const txnResult = await this.fetchTransactionDetails(params);

  // 2. Fetch receipts (use cursor pagination if needed for large batches)
  const receiptsResult = await this.fetchTransactionReceipts({
    accountId: params.accountId,
  });

  // 3. Fetch activity (balance changes, use cursor pagination)
  const activityResult = await this.fetchAccountActivity({
    accountId: params.accountId,
  });

  // 4. Fetch FT transfers
  const ftResult = await this.fetchFtTransfers({
    accountId: params.accountId,
    // Filter by transaction hash if possible
  });

  // 5. Map and correlate
  return mapNearBlocksTransactionToReceiptEvents({
    transaction: txnResult.value,
    receipts: receiptsResult.value.receipts,
    activity: activityResult.value.activities,
    ftTransfers: ftResult.value,
    accountId: params.accountId,
  });
}
```

**Validation**:

- [ ] Method correctly orchestrates multiple API calls
- [ ] Errors from any call are propagated
- [ ] Result combines all data correctly

### Phase 3: Processor V2

**Goal**: Rewrite processor to handle receipt-based events and generate accounting projections

#### Step 3.1: Accounting Projection Types

**File**: `packages/ingestion/src/sources/blockchains/near/types.v2.ts`

**Types**:

```typescript
/** Fund flow derived from NEAR event */
export interface NearFundFlow {
  eventId: string;
  transactionHash: string;
  receiptId: string;
  flowType: 'native_balance_change' | 'token_transfer' | 'fee';
  asset: string;
  amount: Decimal;
  decimals: number;
  from?: string;
  to?: string;
  direction: 'in' | 'out' | 'self';
  contractId?: string;
  timestamp: number;
}

/** Analysis of a NEAR event for accounting */
export interface NearEventAnalysis {
  event: NearReceiptEvent;
  flows: NearFundFlow[];
  operationType: OperationType;
  classification: OperationClassification;
}
```

#### Step 3.2: Processor Utilities V2

**File**: `packages/ingestion/src/sources/blockchains/near/processor-utils.v2.ts`

**Core Functions**:

1. **Analyze Event**:

```typescript
/**
 * Analyze a NEAR event and extract fund flows
 *
 * Process:
 * 1. Determine operation type from receipt actions
 * 2. Extract balance changes (NEAR native)
 * 3. Extract token transfers (NEP-141)
 * 4. Calculate fees (tokens_burnt)
 * 5. Determine flow direction relative to queried account
 * 6. Classify operation
 */
export function analyzeNearEvent(event: NearReceiptEvent, accountId: string): Result<NearEventAnalysis, Error>;
```

2. **Extract Native Flows**:

```typescript
/**
 * Extract NEAR native token flows from balance changes (array)
 *
 * Rules:
 * - Positive delta = receive
 * - Negative delta = send
 * - Zero delta = no flow (just action execution)
 * - Multiple balance changes = multiple flows (one per account affected)
 *
 * Important: Deltas already include fee impact - do not subtract fee again
 */
export function extractNativeFlows(event: NearReceiptEvent, accountId: string): NearFundFlow[];
```

3. **Extract Token Flows**:

```typescript
/**
 * Extract NEP-141 token flows from token transfers (array)
 * One flow per token transfer
 */
export function extractTokenFlows(event: NearReceiptEvent, accountId: string): NearFundFlow[];
```

4. **Extract Fee Flow**:

```typescript
/**
 * Extract fee flow from receipt fee metadata
 *
 * Fee is already computed in the event (from tokens_burnt)
 * This is informational - balance changes already reflect fee impact
 *
 * @returns Fee flow if queried account is the payer, undefined otherwise
 */
export function extractFeeFlow(event: NearReceiptEvent, accountId: string): NearFundFlow | undefined;
```

5. **Classify Operation**:

```typescript
/**
 * Classify NEAR operation based on receipt actions and flows
 *
 * Classification logic:
 * - FunctionCall with ft_transfer method → token_transfer
 * - FunctionCall with stake method → staking
 * - Transfer action + balance change → transfer
 * - No balance change → contract_interaction
 */
export function classifyNearOperation(
  event: NearReceiptEvent,
  flows: NearFundFlow[]
): {
  type: OperationType;
  classification: OperationClassification;
};
```

**Validation**:

- [ ] All event types correctly analyzed
- [ ] Flows correctly extracted for in/out/self directions
- [ ] Fees correctly calculated from tokens_burnt
- [ ] Classifications match expected operation types

#### Step 3.3: Processor V2 Main Class

**File**: `packages/ingestion/src/sources/blockchains/near/processor.v2.ts`

**Class Structure**:

```typescript
export class NearProcessorV2 implements IProcessor {
  async process(
    rawTransactions: RawTransactionData[],
    context: ProcessingContext
  ): Promise<Result<UniversalTransactionData[], Error>> {
    const results: UniversalTransactionData[] = [];

    for (const raw of rawTransactions) {
      // 1. Parse as NearReceiptEvent
      const eventResult = this.parseNormalizedEvent(raw);
      if (eventResult.isErr()) continue;

      // 2. Analyze event
      const analysisResult = analyzeNearEvent(eventResult.value, context.accountId);
      if (analysisResult.isErr()) continue;

      // 3. Convert to UniversalTransaction
      const universalResult = this.toUniversalTransaction(analysisResult.value, context);
      if (universalResult.isErr()) continue;

      results.push(universalResult.value);
    }

    return ok(results);
  }

  /**
   * Convert NEAR event analysis to UniversalTransaction
   */
  private toUniversalTransaction(
    analysis: NearEventAnalysis,
    context: ProcessingContext
  ): Result<UniversalTransactionData, Error> {
    // Map flows to movements
    // Map receipt data to universal fields
    // Preserve NEAR-specific data in metadata
  }
}
```

**Validation**:

- [ ] All event types processed correctly
- [ ] Flows correctly converted to movements
- [ ] Universal transactions pass schema validation
- [ ] Metadata preserves NEAR-specific details

### Phase 4: Testing

#### Step 4.1: Provider Unit Tests

**Files**:

- `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/__tests__/mapper-utils.v2.test.ts`
- `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/__tests__/nearblocks.api-client.v2.test.ts`

**Test Cases**:

1. **Simple Transfer**
   - 1 transaction → 1 receipt → 1 balance change
   - Verify event ID, amount, direction

2. **Multi-Receipt Transaction**
   - 1 transaction → 3 receipts → multiple balance changes
   - Verify all receipts mapped, events correlated correctly

3. **Token Transfer**
   - FunctionCall with ft_transfer → receipt with token transfer
   - Verify token data, contract address, direction

4. **Complex DeFi Transaction**
   - Multiple receipts, multiple token transfers, cross-contract calls
   - Verify all events extracted, correlations correct

5. **Failed Transaction**
   - Transaction with failed receipt
   - Verify status propagated, no balance changes recorded

6. **Staking Transaction**
   - Deposit and stake action
   - Verify attached_deposit NOT treated as transfer

#### Step 4.2: Processor Unit Tests

**File**: `packages/ingestion/src/sources/blockchains/near/__tests__/processor-utils.v2.test.ts`

**Test Cases**:

1. **Balance Change Analysis**
   - Positive delta → receive flow
   - Negative delta → send flow
   - Zero delta → no flow
   - Multiple balance changes → multiple flows

2. **Token Transfer Analysis**
   - FT transfer to account → receive flow
   - FT transfer from account → send flow
   - Multiple token transfers → multiple flows

3. **Fee Extraction**
   - tokensBurntYocto present → fee flow for payer
   - Fee payer is predecessorId (not signerId)
   - Zero tokensBurntYocto → no fee flow
   - Failed receipt still has fee

4. **Operation Classification**
   - Transfer action → transfer
   - FT transfer → token_transfer
   - Stake action → staking
   - Generic function call → contract_interaction

5. **Multi-Flow Events**
   - Receipt with 2 balance changes + 3 token transfers → 5 flows + 1 fee
   - Receipt with no changes but fee → 1 fee flow only
   - Failed receipt with fee → 1 fee flow, no balance changes

#### Step 4.3: Integration Tests

**File**: `packages/ingestion/src/sources/blockchains/near/__tests__/integration.v2.test.ts`

**Test Cases**:

1. **End-to-End Simple Transfer**
   - Mock NearBlocks API responses
   - Fetch → Map → Process
   - Verify final UniversalTransaction

2. **End-to-End Token Transfer**
   - Mock FT transfer responses
   - Verify token metadata, amounts

3. **End-to-End Multi-Receipt**
   - Mock complex transaction
   - Verify all events generated

#### Step 4.4: E2E Tests (Real API)

**File**: `packages/blockchain-providers/src/blockchains/near/providers/nearblocks/__tests__/nearblocks.e2e.v2.test.ts`

**Test Cases**:

1. Real NEAR transfer transaction
2. Real NEP-141 token transfer
3. Real staking transaction
4. Real DeFi swap transaction

**Validation**:

- [ ] All test suites pass
- [ ] Edge cases handled
- [ ] Error messages clear and actionable

### Phase 5: Migration & Cleanup

#### Step 5.1: Parallel Operation

**Strategy**: Run V1 and V2 side-by-side, compare outputs

**File**: `packages/ingestion/src/sources/blockchains/near/processor-comparison.ts`

```typescript
/**
 * Temporary comparison harness for V1 vs V2 validation
 */
export async function compareV1andV2(
  rawData: RawTransactionData[],
  context: ProcessingContext
): Promise<ComparisonReport> {
  const v1Results = await processorV1.process(rawData, context);
  const v2Results = await processorV2.process(rawData, context);

  return {
    v1Count: v1Results.value.length,
    v2Count: v2Results.value.length,
    differences: findDifferences(v1Results.value, v2Results.value),
  };
}
```

**Validation**:

- [ ] V2 produces more accurate events (receipt-level)
- [ ] V2 correctly handles multi-receipt transactions
- [ ] V2 fees match actual tokens_burnt
- [ ] V2 amount calculations based on deltas, not deposits

#### Step 5.2: Database Migration

**Strategy**: Since database is dropped during development (per CLAUDE.md), just replace V1 with V2

**File**: `packages/data/src/migrations/001_initial_schema.ts`

**Changes**:

- Add `receipt_id` column to `raw_transactions` table (for NEAR events)
- Update indexes to include receipt_id for NEAR blockchain
- No need for data migration (dev database is ephemeral)

**Validation**:

- [ ] Migration runs successfully
- [ ] Indexes created correctly
- [ ] NEAR events stored with receipt_id

#### Step 5.3: Cutover

**Actions**:

1. Remove V1 files:
   - `schemas.ts` → `schemas.v2.ts` becomes `schemas.ts`
   - `mapper-utils.ts` → `mapper-utils.v2.ts` becomes `mapper-utils.ts`
   - `processor-utils.ts` → `processor-utils.v2.ts` becomes `processor-utils.ts`
   - `processor.ts` → `processor.v2.ts` becomes `processor.ts`

2. Update imports across codebase

3. Update exports in `index.ts` files

**Validation**:

- [ ] All imports resolve correctly
- [ ] Build succeeds
- [ ] All tests pass

#### Step 5.4: Documentation Update

**Files to Update**:

- `docs/specs/near-normalization-model.md` - Mark as implemented
- `README.md` - Update NEAR provider documentation
- Code comments - Ensure all functions well-documented

**Validation**:

- [ ] Documentation reflects V2 implementation
- [ ] Examples updated
- [ ] Architecture diagrams updated (if any)

---

## File Structure

### After V2 Implementation

```
packages/
├── blockchain-providers/
│   └── src/
│       └── blockchains/
│           └── near/
│               ├── schemas.ts                    # V2 NEAR-native schemas
│               ├── utils.ts                      # Fee extraction, helpers
│               ├── balance-utils.ts              # Balance calculation utilities
│               ├── index.ts                      # Public exports
│               ├── register-apis.ts              # Provider registration
│               ├── providers/
│               │   └── nearblocks/
│               │       ├── nearblocks.api-client.ts        # API client with V2 endpoints
│               │       ├── nearblocks.schemas.ts           # Raw NearBlocks schemas
│               │       ├── mapper-utils.ts                 # V2 mappers (raw → normalized)
│               │       ├── index.ts
│               │       └── __tests__/
│               │           ├── mapper-utils.test.ts
│               │           ├── nearblocks.api-client.test.ts
│               │           └── nearblocks.e2e.test.ts
│               └── __tests__/
│                   ├── schemas.test.ts
│                   ├── utils.test.ts
│                   └── balance-utils.test.ts
└── ingestion/
    └── src/
        └── sources/
            └── blockchains/
                └── near/
                    ├── processor.ts              # V2 processor
                    ├── processor-utils.ts        # V2 analysis & flow extraction
                    ├── types.ts                  # Accounting projection types
                    ├── importer.ts               # Importer (minimal changes)
                    ├── register.ts               # Registration
                    └── __tests__/
                        ├── processor.test.ts
                        ├── processor-utils.test.ts
                        ├── processor-fee-accounting.test.ts
                        └── integration.test.ts
```

---

## Migration Strategy

### For Development Environment

**Strategy**: Clean break (per CLAUDE.md: database dropped during dev)

**Steps**:

1. Implement V2 in parallel (`.v2.ts` files)
2. Test V2 thoroughly
3. Replace V1 files with V2
4. Drop and recreate database with new schema
5. Re-import test data with V2

**Validation**:

- [ ] All V1 files removed
- [ ] No V1 references remain
- [ ] Database schema matches V2 requirements

### For Production (Future)

**Strategy**: Dual-write during transition

**Steps** (when production exists):

1. Deploy V2 code alongside V1
2. Write to both V1 and V2 tables
3. Backfill V2 tables from V1 data (best-effort)
4. Validate V2 data accuracy
5. Switch reads to V2 tables
6. Stop writing to V1 tables
7. Drop V1 tables after validation period

---

## Testing Strategy

### Test Pyramid

```
        E2E Tests (5%)
       /            \
      /   Real API   \
     /________________\

    Integration Tests (15%)
   /                      \
  /  Provider + Processor  \
 /__________________________\

      Unit Tests (80%)
   /                    \
  /  Schemas, Mappers,   \
 /   Utils, Processor     \
/___________________________\
```

### Test Coverage Requirements

- **Unit Tests**: 90%+ coverage
  - All mapper functions
  - All processor utilities
  - All schema validations
  - All event ID generation

- **Integration Tests**: Key flows
  - Simple transfer (1 receipt)
  - Multi-receipt transaction
  - Token transfer
  - Failed transaction
  - Staking transaction

- **E2E Tests**: Real scenarios
  - At least one test per transaction type
  - Real NearBlocks API calls (with rate limiting)
  - Verify end-to-end correctness

### Test Data

**Location**: `packages/ingestion/src/sources/blockchains/near/__tests__/fixtures/`

**Files**:

- `simple-transfer.json` - Single receipt, balance change
- `multi-receipt.json` - Multiple receipts, cross-contract
- `token-transfer.json` - NEP-141 FT transfer
- `failed-transaction.json` - Failed receipt
- `staking.json` - Staking action
- `defi-swap.json` - Complex DeFi interaction

### Test Execution

```bash
# Unit tests
pnpm --filter @exitbook/blockchain-providers test
pnpm --filter @exitbook/ingestion test

# Specific test file
pnpm vitest run packages/blockchain-providers/src/blockchains/near/__tests__/mapper-utils.test.ts

# E2E tests (requires API keys)
pnpm vitest run --config vitest.e2e.config.ts packages/blockchain-providers/src/blockchains/near/providers/nearblocks/__tests__/nearblocks.e2e.test.ts

# Full test suite
pnpm test
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] **Receipt-Based Events**: One receipt = one event (may contain arrays of changes/transfers)
- [ ] **Event Identity**: Receipt ID is the unique event identifier
- [ ] **NEAR-Native Fields**: Uses signer_id, receiver_id, predecessor_id, attached_deposit, etc.
- [ ] **Correct Amount Semantics**: Amounts derived from balance deltas, not attached deposits
- [ ] **Multi-Receipt Support**: Transactions with multiple receipts handled correctly
- [ ] **Token Transfers**: NEP-141 transfers correctly parsed and linked to receipts (as arrays)
- [ ] **Fee Accuracy**: Fees from tokens_burnt, payer is predecessor, fee included in events
- [ ] **No Fee Double-Counting**: Balance deltas already include fee impact - don't subtract again
- [ ] **Failed Receipts**: Status=failed events include fee but may have no balance changes
- [ ] **Operation Classification**: Staking, transfers, contract calls correctly identified
- [ ] **Balance Reconciliation**: Account balance changes match actual on-chain deltas

### Non-Functional Requirements

- [ ] **Test Coverage**: 90%+ unit test coverage
- [ ] **Performance**: No significant regression vs V1
- [ ] **Error Handling**: Clear error messages for all failure modes
- [ ] **Logging**: Comprehensive logging for debugging
- [ ] **Documentation**: All public functions documented
- [ ] **Type Safety**: No `any` types, full TypeScript coverage

### Migration Requirements

- [ ] **Clean Cutover**: V1 files completely removed, no V1 references remain
- [ ] **Database Migration**: New schema deployed successfully
- [ ] **Import Updates**: All imports across codebase updated to V2

---

## Appendix: Key Differences V1 vs V2

| Aspect                 | V1 (Wrong)                                    | V2 (Correct)                                           |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------ |
| **Event Granularity**  | Transaction-level (1 tx = 1 event)            | Receipt-level (1 receipt = 1 event)                    |
| **Event Identity**     | `transaction_hash` only                       | `receipt_id` (unique per receipt)                      |
| **Primary Fields**     | `from`, `to`, `amount`, `currency` (required) | `signerId`, `receiverId`, `receiptId`, `actions`       |
| **Amount Semantics**   | `amount = sum(attached_deposit)` ❌           | Amounts from balance deltas (arrays) ✓                 |
| **Fee Handling**       | Estimated from outcomes_agg                   | `tokens_burnt` as event metadata, payer=predecessor ✓  |
| **Fee Payer**          | Unclear/assumed signer                        | Predecessor (correct NEAR semantics) ✓                 |
| **Structure**          | Flat transaction with optional arrays         | One event per receipt with arrays of changes/transfers |
| **Token Transfers**    | Optional `tokenTransfers` array               | Array in each receipt event ✓                          |
| **Balance Changes**    | Optional `accountChanges` array               | Array in each receipt event, includes fee impact ✓     |
| **Schema Orientation** | Generic (Solana-style)                        | NEAR-native ✓                                          |
| **Failed Receipts**    | Not clearly handled                           | Status=failed, fee present, empty changes ✓            |

---

## Appendix: NearBlocks API Endpoints

### Endpoints Used

| Endpoint                                | Purpose             | V1  | V2  |
| --------------------------------------- | ------------------- | --- | --- |
| `GET /v1/account/{account}/txns`        | List transactions   | ✓   | ✓   |
| `GET /v1/account/{account}/txns/{hash}` | Transaction details | ✓   | ✓   |
| `GET /v1/account/{account}/receipts`    | Receipt details     | ✗   | ✓   |
| `GET /v1/account/{account}/activities`  | Balance changes     | ✗   | ✓   |
| `GET /v1/account/{account}/ft-txns`     | Token transfers     | ✓   | ✓   |

**Pagination Strategy**: All endpoints support cursor-based pagination (NearBlocks returns `cursor` field in responses). V2 uses cursors instead of page numbers, persists cursors in `CursorState.metadata.custom` for resume, and retains a safety cap to prevent unbounded enrichment loops.

### Response Correlation

**Challenge**: NearBlocks endpoints return related but separate data

**V2 Solution**: Multi-step enrichment with ID-based correlation

1. Fetch transaction (gets first receipt only)
2. Fetch all receipts (gets receipt actions and outcomes)
3. Fetch activities (gets balance changes with receipt_id and transaction_hash)
4. Fetch FT transfers (has receipt_id)
5. Correlate by receipt_id (primary), transaction_hash (fallback), or timestamp (last resort)

---

## Appendix: Testing Examples

### Unit Test Example

```typescript
describe('mapNearBlocksReceipt', () => {
  it('should map a simple action receipt', () => {
    const rawReceipt: NearBlocksReceipt = {
      receipt_id: 'ABC123',
      predecessor_account_id: 'alice.near',
      receiver_account_id: 'bob.near',
      receipt_kind: 'ACTION',
      actions: [
        {
          action: 'TRANSFER',
          deposit: '1000000000000000000000000', // 1 NEAR in yocto
        },
      ],
      outcome: {
        status: true,
        gas_burnt: '2428000000000',
        tokens_burnt: '242800000000000000000',
      },
      block_height: 123456,
      block_timestamp: '1234567890000000000',
    };

    const result = mapNearBlocksReceipt(rawReceipt);

    expect(result.isOk()).toBe(true);
    const receipt = result.value;

    expect(receipt.receiptId).toBe('ABC123');
    expect(receipt.predecessorId).toBe('alice.near');
    expect(receipt.receiverId).toBe('bob.near');
    expect(receipt.receiptKind).toBe('ACTION');
    expect(receipt.actions).toHaveLength(1);
    expect(receipt.actions[0].actionType).toBe('transfer');
    expect(receipt.actions[0].attachedDeposit).toBe('1000000000000000000000000');
    expect(receipt.outcome?.status).toBe(true);
    expect(receipt.outcome?.tokensBurntYocto).toBe('242800000000000000000');
  });
});
```

### Integration Test Example

```typescript
describe('NEAR V2 Integration', () => {
  it('should process a simple transfer end-to-end', async () => {
    // Arrange: Mock API responses
    const mockTransaction = createMockTransaction();
    const mockReceipts = createMockReceipts();
    const mockActivity = createMockActivity();

    mockApiClient.fetchTransactionDetails.mockResolvedValue(ok(mockTransaction));
    mockApiClient.fetchTransactionReceipts.mockResolvedValue(ok(mockReceipts));
    mockApiClient.fetchAccountActivity.mockResolvedValue(ok(mockActivity));

    // Act: Fetch and process
    const eventsResult = await apiClient.fetchReceiptEventsForTransaction({
      accountId: 'alice.near',
      transactionHash: 'TX123',
    });

    expect(eventsResult.isOk()).toBe(true);
    const events = eventsResult.value;

    const processResult = await processor.process(events.map(toRawTransactionData), { accountId: 'alice.near' });

    expect(processResult.isOk()).toBe(true);
    const universalTxns = processResult.value;

    // Assert: Verify output
    expect(universalTxns).toHaveLength(1);
    expect(universalTxns[0].type).toBe('transfer');
    expect(universalTxns[0].movements).toHaveLength(1);
    expect(universalTxns[0].movements[0].asset).toBe('NEAR');
    expect(universalTxns[0].movements[0].direction).toBe('out');
  });
});
```

---

## Questions & Answers

### Q: Why not just fix V1 incrementally?

**A**: The architectural issues are fundamental. V1 forces NEAR into a Solana-shaped model. Incremental fixes would leave technical debt and confusion. A clean V2 implementation following NEAR's actual model is faster and cleaner.

### Q: What about backward compatibility?

**A**: Since the database is dropped during development (per CLAUDE.md), there's no backward compatibility needed. For future production, we'd use a dual-write migration strategy.

### Q: How do we handle NearBlocks API rate limits?

**A**:

- Use existing circuit breaker and retry logic from BaseApiClient
- Implement request batching where possible
- Add caching for receipt/activity data (receipts don't change)
- For E2E tests, use rate-limited test suite with delays

### Q: What if a receipt has no balance changes?

**A**: Still create an event for the receipt execution. The event represents the on-chain action even if no funds moved. This is important for tracking contract interactions, staking, etc.

### Q: How do we handle cross-contract calls (receipts spawning receipts)?

**A**: Each receipt is a separate event with its own `receipt_id`. The `transaction_hash` links them together. The processor doesn't need to reconstruct the call tree - each receipt is accountable independently.

### Q: What about performance vs V1?

**A**: V2 makes more API calls (receipts, activity) but the data is more accurate. We can optimize with:

- Parallel API calls (Promise.all)
- Response caching
- Batch processing

Accuracy > speed for a financial application.

### Q: How are fees handled to avoid double-counting?

**A**: Critical distinction:

1. **Balance changes from NearBlocks already include fee impact** - the deltas are net of fees paid
2. **Fee metadata is extracted separately** (from `tokens_burnt`) for informational/tracking purposes
3. **The accounting pipeline must NOT subtract fees again** from balance change flows
4. Fee flows are emitted as separate `flowType: 'fee'` entries for analysis
5. When building `UniversalTransaction`, fees go in the `fee` field, not as a movement

Example: Alice sends 1 NEAR with 0.001 fee

- Balance change: `-1.001 NEAR` (already includes fee)
- Fee metadata: `0.001 NEAR` (informational)
- Accounting flows: `{ flowType: 'native_balance_change', amount: '-1.001' }` + `{ flowType: 'fee', amount: '0.001' }`
- Universal transaction: `movements: [{ amount: 1, direction: out }]`, `fee: { amount: 0.001 }`

### Q: Who pays the fee for a receipt?

**A**: The **predecessor** pays for receipt execution, not necessarily the original signer. For the first receipt in a transaction, `predecessor == signer`. For subsequent receipts spawned by cross-contract calls, the predecessor is the contract that spawned the receipt. This is why `fee.payer` must be `predecessorId`, not `signerId`.

---

## Summary

This refactor is a **fundamental architectural fix**, not an incremental improvement. The V2 implementation:

1. **Follows NEAR's Native Model**: Receipt-based execution, NEAR-specific fields
2. **Provides Accurate Data**: Amounts from deltas, fees from tokens_burnt, no inferred transfers
3. **Enables Better Accounting**: Separate projection layer for fund flows
4. **Supports Complex Transactions**: Multi-receipt, cross-contract, DeFi interactions
5. **Maintains Clean Architecture**: Layered data flow, NEAR-native normalized layer

The implementation plan provides a clear path forward with:

- Detailed schemas
- Step-by-step implementation phases
- Comprehensive testing strategy
- Clear acceptance criteria

With AI assistance, this refactor can be completed efficiently by following the phases sequentially and leveraging automated code generation for schemas, mappers, and tests.
