# Processor Architecture Refactoring Plan

## Overview

This document outlines the implementation plan for refactoring the provider architecture to separate API clients from processors with decorator-based registration.

**GitHub Issue**: [#30](https://github.com/jbelanger/crypto-portfolio/issues/30)  
**Status**: Bitcoin implementation ✅ COMPLETED | Remaining blockchains ⏳ PENDING

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
**Estimated effort**: 3-4 days total

1. **Solana**: `HeliusProvider` → client + processor
2. **Injective**: `InjectiveExplorerProvider` + `InjectiveLCDProvider` → clients + processors
3. **Polkadot**: `SubstrateProvider` → client + processor
4. **Avalanche**: Current providers → clients + processors

### Step-by-Step Migration Checklist

For **each blockchain**, follow this proven process:

#### 🔄 Step 1: Convert Providers to ApiClients

- [ ] Rename `XProvider.ts` → `XApiClient.ts` in new `clients/` directory
- [ ] Remove all validation and transformation methods
- [ ] Keep only raw data fetching methods (`getRawAddressTransactions`, `getAddressBalance`, etc.)
- [ ] Update `supportedOperations` to focus on raw data only

#### ⚙️ Step 2: Create Processors

- [ ] Create `XProcessor.ts` in `processors/` directory
- [ ] Add `@RegisterProcessor('provider-name')` decorator
- [ ] Implement `IProviderProcessor<TRawData>` interface:
  - `validate(rawData): ValidationResult`
  - `transform(rawData, walletAddresses): UniversalTransaction`
- [ ] Use proper transaction type mapping (`deposit`/`withdrawal`/`transfer`)
- [ ] Follow UniversalTransaction field pattern (see above)

#### 🔗 Step 3: Update Core Files

- [ ] Update transaction-importer to return `SourcedRawData<T>[]`
- [ ] Update transaction-processor to use `ProcessorFactory.create(providerId)`
- [ ] Create barrel files: `processors/index.ts` and `clients/index.ts`
- [ ] Import processors in transaction-processor

#### ✅ Step 4: Verify

- [ ] Run `pnpm run workspace:build` - zero TypeScript errors
- [ ] Run `pnpm run lint` - zero linting issues
- [ ] Update imports in test files if needed

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
- **Architecture**: Processor factory, interfaces, validation patterns
- **Type Safety**: All compilation and linting errors resolved

### ⏳ PENDING

- **Ethereum**: 2 providers to migrate
- **Solana**: 1 provider to migrate
- **Injective**: 2 providers to migrate
- **Polkadot**: 1 provider to migrate
- **Avalanche**: Check current providers

### 🎯 Next Immediate Steps

1. **Start with Ethereum** - most similar to Bitcoin
2. **Follow the proven Bitcoin pattern exactly**
3. **Test each blockchain individually before moving to next**

**Total remaining effort**: ~4-6 days for all blockchains
