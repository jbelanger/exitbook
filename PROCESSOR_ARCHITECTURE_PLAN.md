# Processor Architecture Refactoring Plan

## Overview

This document outlines the implementation plan for refactoring the provider architecture to separate API clients from processors with decorator-based registration.

**GitHub Issue**: [#30](https://github.com/jbelanger/crypto-portfolio/issues/30)  
**Status**: Bitcoin ✅ COMPLETED | Injective ✅ COMPLETED | Remaining blockchains ⏳ PENDING

## Target Architecture

### New Responsibilities

- **ApiClient**: Fetch raw data only (thin HTTP/RPC client)
- **Processor**: Validate and transform provider-specific data
- **Factory**: Auto-dispatch to correct processor based on data provenance

### Target File Structure (Applied Pattern)

```
packages/import/src/blockchains/{blockchain}/
├── clients/
│   ├── Provider1ApiClient.ts       # @RegisterProvider - fetch only
│   └── Provider2ApiClient.ts       # @RegisterProvider - fetch only
├── processors/
│   ├── Provider1Processor.ts       # @RegisterProcessor - validate/transform
│   └── Provider2Processor.ts       # @RegisterProcessor - validate/transform
├── transaction-importer.ts         # Returns SourcedRawData with provenance
└── transaction-processor.ts        # Uses ProcessorFactory for dispatch
```

## ✅ Bitcoin Implementation - COMPLETED

### What Was Accomplished

**🏗️ Foundation Infrastructure:**

- ✅ Core interfaces for `IProviderProcessor<TRawData>`, `ValidationResult`, `SourcedRawData<TRawData>`
- ✅ `ProcessorFactory` with `@RegisterProcessor` decorator support
- ✅ Updated `BlockchainProviderManager` to return `FailoverExecutionResult<T>`

**🪙 Bitcoin Pilot Implementation:**

- ✅ **3 ApiClients**: MempoolSpace, Blockstream, BlockCypher (fetch raw data only)
- ✅ **3 Processors**: Each with validation + transformation to `UniversalTransaction`
- ✅ **Transaction Importer**: Returns `SourcedRawData` with provenance tracking
- ✅ **Transaction Processor**: Uses `ProcessorFactory` for auto-dispatch
- ✅ **Type Safety**: All TypeScript and linting errors resolved

### Key Implementation Patterns Established

**📁 File Structure Pattern:**

```
packages/import/src/blockchains/bitcoin/
├── clients/              # Raw data fetching only
├── processors/           # Validation + transformation
├── transaction-importer.ts    # Provenance tracking
└── transaction-processor.ts   # Factory dispatch
```

**🔄 Transaction Type Mapping:**

- **`'deposit'`** - Money coming into wallet (was `transfer_in`)
- **`'withdrawal'`** - Money leaving wallet (was `transfer_out`)
- **`'transfer'`** - Internal wallet movement

**🎯 UniversalTransaction Fields:**

```typescript
{
  amount: Money,           // Using createMoney() with Decimal
  datetime: string,        // ISO timestamp
  fee?: Money,
  from?: string,
  id: string,
  metadata: Record<string, unknown>,  // Provider-specific data
  source: string,          // e.g., 'bitcoin'
  status: TransactionStatus,
  symbol?: string,
  timestamp: number,
  to?: string,
  type: TransactionType,
}
```

## ✅ Injective Implementation - COMPLETED

### What Was Accomplished

**💫 Injective Migration Success:**

- ✅ **2 ApiClients**: InjectiveExplorer, InjectiveLCD (raw data fetching only)
- ✅ **2 Processors**: Each with validation + transformation to `UniversalTransaction`
- ✅ **Transaction Processor**: Uses `ProcessorFactory` for auto-dispatch
- ✅ **Adapter Bridge**: Backward compatibility with old import system
- ✅ **Live Testing**: Successfully imports real Injective transactions (6 raw → 3 relevant)
- ✅ **Type Extensions**: Added `getRawAddressBalance`, `getRawTokenBalances` operation types

### 🌉 Critical Bridge Pattern Discovery

The **adapter bridge** enables backward compatibility while maintaining new architecture:

```typescript
// In InjectiveAdapter.transformTransactions() - BRIDGE LAYER
protected async transformTransactions(
  rawTxs: InjectiveTransaction[],
  params: UniversalFetchParams
): Promise<UniversalTransaction[]> {
  // BRIDGE: Temporary compatibility for old import system
  // Replicates processor logic for backward compatibility
  // New system uses InjectiveTransactionProcessor via ProcessorFactory

  const universalTransactions: UniversalTransaction[] = [];

  for (const tx of rawTxs) {
    // Parse blockchain-specific transaction format
    // Extract from/to/amount from message structures
    // Apply wallet address filtering for relevance
    // Transform to UniversalTransaction format
  }

  return universalTransactions;
}
```

**Key Bridge Benefits:**

- ✅ Old system (`import-old`) works immediately
- ✅ New processor architecture ready for future
- ✅ Zero breaking changes to existing workflows
- ✅ Type-safe transformation with proper validation

**🔧 Required Type System Extensions:**

When migrating new blockchains, these types need to be added to `shared/types.ts`:

```typescript
// Add to ProviderOperationType union
export type ProviderOperationType =
  | 'getRawAddressBalance' // For balance API clients
  | 'getRawTokenBalances'; // For token balance API clients
// ... existing types

// Add to ProviderOperationParams union
export type ProviderOperationParams =
  | { address: string; contractAddresses?: string[]; type: 'getRawAddressBalance' }
  | { address: string; contractAddresses?: string[]; type: 'getRawTokenBalances' };
// ... existing params
```

**📋 Injective-Specific Patterns:**

- **Complex Message Parsing**: Injective uses `messages[]` array with different message types (`/cosmos.bank.v1beta1.MsgSend`, `/ibc.applications.transfer.v1.MsgTransfer`)
- **Multi-Denomination Support**: Handles INJ and other tokens via `denom` field
- **Relevance Filtering**: Only processes transactions involving user wallet addresses
- **Gas Fee Parsing**: Extracts fees from `gas_fee.amount[]` array structure

## 🚀 Next Phase: Remaining Blockchains

### Phase 3: Apply Bitcoin Patterns to Other Blockchains

The Bitcoin implementation provides the proven template. Each blockchain should follow this **exact same pattern**:

#### Ethereum Implementation

**Status**: ⏳ PENDING  
**Estimated effort**: 1-2 days  
**Current providers to migrate**:

- `AlchemyProvider` → `AlchemyApiClient` + `AlchemyProcessor`
- `MoralisProvider` → `MoralisApiClient` + `MoralisProcessor`

#### Remaining Blockchains

**Status**: ⏳ PENDING  
**Estimated effort**: 2-3 days total (reduced due to bridge pattern)

1. **Solana**: `HeliusProvider` → client + processor
2. **Polkadot**: `SubstrateProvider` → client + processor
3. **Avalanche**: Current providers → clients + processors

**✅ COMPLETED:**

- ~~**Injective**: `InjectiveExplorerProvider` + `InjectiveLCDProvider` → clients + processors~~

### 🚀 Improved Migration Checklist (v2.0)

**Based on successful Bitcoin & Injective migrations**

For **each blockchain**, follow this proven process:

#### 🔄 Step 1: Convert Providers to ApiClients

- [ ] Create `clients/` directory: `mkdir -p clients/`
- [ ] Rename `XProvider.ts` → `XApiClient.ts` in new `clients/` directory
- [ ] Remove all validation and transformation methods
- [ ] Keep only raw data fetching methods (`getRawAddressTransactions`, `getRawAddressBalance`, etc.)
- [ ] Update `supportedOperations` to focus on raw data only
- [ ] **NEW**: Ensure operation names match `ProviderOperationType` union

#### ⚙️ Step 2: Create Processors

- [ ] Create `processors/` directory: `mkdir -p processors/`
- [ ] Create `XProcessor.ts` in `processors/` directory
- [ ] Add `@RegisterProcessor('provider-name')` decorator (must match client name)
- [ ] Implement `IProviderProcessor<TRawData>` interface:
  - `validate(rawData): ValidationResult`
  - `transform(rawData, walletAddresses): UniversalTransaction`
- [ ] Use proper transaction type mapping (`deposit`/`withdrawal`/`transfer`)
- [ ] Follow UniversalTransaction field pattern with `createMoney()` for amounts

#### 🔗 Step 3: Update Adapter (Bridge Pattern)

- [ ] **CRITICAL**: Add `getAddressTransactions` to adapter's `supportedOperations` array
- [ ] Update `fetchRawTransactions()` to return blockchain-specific raw type (e.g., `SolanaTransaction[]`)
- [ ] **Bridge Pattern**: Update `transformTransactions()` method:
  ```typescript
  protected async transformTransactions(
    rawTxs: BlockchainSpecificTransaction[],
    params: UniversalFetchParams
  ): Promise<UniversalTransaction[]> {
    // BRIDGE: Temporary compatibility for old import system
    // Replicate processor transformation logic here
    // This enables immediate backward compatibility
  }
  ```
- [ ] Import new clients to ensure registration: `import './clients/XApiClient.ts'`

#### 🔧 Step 4: Extend Type System (If Needed)

- [ ] **Check**: Do new operations exist in `ProviderOperationType`?
- [ ] **If not**: Add to `blockchains/shared/types.ts`:

  ```typescript
  export type ProviderOperationType =
    | 'getRawAddressBalance' // Add if needed
    | 'getRawTokenBalances'; // Add if needed
  // ... existing types

  export type ProviderOperationParams = { address: string; type: 'getRawAddressBalance' }; // Add if needed
  // ... existing params
  ```

#### 🏗️ Step 5: Create Transaction Processor

- [ ] Create `transaction-processor.ts` based on Injective/Bitcoin pattern
- [ ] Import all processors to trigger registration
- [ ] Implement `IProcessor<SourcedRawData<BlockchainTransaction>>` interface

#### 📦 Step 6: Create Barrel Files

- [ ] Create `processors/index.ts`: Export all processors
- [ ] Create `clients/index.ts`: Export all clients

#### ✅ Step 7: Test & Verify

- [ ] **Build**: `pnpm run build` - zero TypeScript errors
- [ ] **Lint**: `pnpm run lint` - zero linting issues
- [ ] **CRITICAL TEST**: Run import with real address:
  ```bash
  pnpm run dev import-old --blockchain BLOCKCHAIN --addresses ADDRESS
  ```
- [ ] **Verify**: Successful transaction import with proper counts
- [ ] **Debug**: Check logs for validation errors or transformation issues

### Success Criteria

**✅ When blockchain migration is complete:**

- [ ] All providers separated into ApiClient + Processor pairs
- [ ] Zero switch statements or `canParse()` methods
- [ ] Clean separation: fetch vs validate vs transform
- [ ] Full TypeScript compliance and linting
- [ ] `ProcessorFactory` auto-dispatch working
- [ ] Provenance tracking with `SourcedRawData`

## Current Status

### ✅ COMPLETED

- **Bitcoin (100%)**: Foundation + 3 providers fully migrated and tested
- **Injective (100%)**: 2 providers migrated + bridge pattern + live testing ✨
- **Architecture**: Processor factory, interfaces, validation patterns, bridge compatibility
- **Type Safety**: All compilation and linting errors resolved

### ⏳ PENDING

- **Ethereum**: 2 providers to migrate
- **Solana**: 1 provider to migrate
- **Polkadot**: 1 provider to migrate
- **Avalanche**: Check current providers

### 🎯 Next Immediate Steps

1. **Start with Ethereum** - most similar to Bitcoin
2. **Apply bridge pattern** - enables immediate backward compatibility
3. **Test each blockchain individually** before moving to next

### 📊 Progress Summary

**Completion Rate**: 2/5 blockchains (40%)  
**Remaining Effort**: ~3-4 days total (reduced due to proven patterns)  
**Key Innovation**: Bridge pattern allows instant compatibility with old system

**Major Breakthrough**: Injective migration proved the bridge pattern works perfectly, enabling:

- ✅ Zero breaking changes for existing workflows
- ✅ New architecture ready for future full migration
- ✅ Real-world validation with live blockchain data
- ✅ Reduced migration complexity for remaining blockchains
