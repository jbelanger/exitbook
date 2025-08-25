# Processor Architecture Refactoring Plan

## Overview

This document outlines the implementation plan for refactoring the provider architecture to separate API clients from processors with decorator-based registration.

**GitHub Issue**: [#30](https://github.com/jbelanger/crypto-portfolio/issues/30)  
**Status**: Bitcoin ✅ COMPLETED | Injective ✅ COMPLETED | Ethereum ✅ COMPLETED | Avalanche ✅ COMPLETED | Remaining blockchains ⏳ PENDING

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

#### ✅ Ethereum Implementation - COMPLETED

**Status**: ✅ COMPLETED  
**Actual effort**: 4 hours  
**Successfully migrated**:

- ✅ `AlchemyProvider` → `AlchemyApiClient` + `AlchemyProcessor`
- ✅ `MoralisProvider` → `MoralisApiClient` + `MoralisProcessor`
- ✅ **Live Testing**: Successfully imported 29 transactions (3 ETH + 26 tokens)
- ✅ **Bridge Pattern**: Full backward compatibility with old system
- ✅ **Registry Integration**: Using `BaseRegistryProvider` + `@RegisterProvider`

### 🔍 Key Lessons Learned from Ethereum Migration

#### 🎯 Critical Success Patterns Discovered

**1. Registry Architecture Pattern (Injective-Style)**

- ✅ **Use BaseRegistryProvider**: Extends `BaseRegistryProvider` instead of implementing `IBlockchainProvider` directly
- ✅ **Constructor Pattern**: `super('blockchain', 'provider-name', 'network')` only
- ✅ **No Manual Config**: Registry automatically handles API keys, URLs, rate limits from metadata
- ❌ **Don't use old provider interfaces**: Avoid implementing `IBlockchainProvider` manually

```typescript
@RegisterProvider({
  blockchain: 'ethereum',
  name: 'alchemy', // MUST match config file name
  displayName: 'Alchemy',
  type: 'rest', // NOT 'api'
  requiresApiKey: true,
  capabilities: { supportedOperations: ['getRawAddressTransactions', ...] }
})
export class AlchemyApiClient extends BaseRegistryProvider {
  constructor() {
    super('ethereum', 'alchemy', 'mainnet'); // Only this!
  }
}
```

**2. Configuration Integration Requirements**

- ✅ **Update blockchain-explorers.json**: Add new providers with priority order
- ✅ **Match Names Exactly**: Config `name` field must match `@RegisterProvider` name
- ✅ **Disable Old Providers**: Set `enabled: false` for legacy providers
- ✅ **Operation Types**: Use `getRawAddressTransactions`, `getRawAddressBalance`, etc.

**3. Client Registration - CRITICAL**

- ✅ **Import Pattern**: Create `clients/index.ts` that imports (not exports) all clients
- ✅ **Trigger Registration**: Import the index file in adapter: `import './clients/index.ts'`
- ❌ **Export vs Import**: Exporting doesn't trigger decorators - must import!

```typescript
// clients/index.ts - CORRECT
import './AlchemyApiClient.ts';
import './MoralisApiClient.ts';
// adapter.ts - REQUIRED
import './clients/index.ts';

// Triggers registration
```

**4. BaseAdapter Capability Requirements**

- ✅ **Add `getAddressTransactions`**: Must be in adapter's `getInfo().capabilities.supportedOperations`
- ❌ **Missing Capability Error**: `"Ethereum does not support address-based transaction fetching"`
- ✅ **Validation Check**: BaseAdapter validates operations before execution

```typescript
async getInfo(): Promise<UniversalAdapterInfo> {
  return {
    capabilities: {
      supportedOperations: ['fetchTransactions', 'fetchBalances', 'getAddressTransactions'], // CRITICAL
    },
  };
}
```

#### 🔄 Bridge Pattern Implementation

**5. Provider-Specific Data Processing**

- ✅ **Bridge Methods**: Add provider-specific processing methods in adapter
- ✅ **Provider Name Switching**: Route by `providerName` from failover result
- ✅ **Type Safety**: Cast raw data to provider-specific types

```typescript
private processRawTransactions(rawData: unknown, providerName: string, userAddress: string): BlockchainTransaction[] {
  switch (providerName) {
    case 'alchemy':
      return AlchemyProcessor.processAddressTransactions(rawData as AlchemyAssetTransfer[], userAddress);
    case 'moralis':
      return MoralisProcessor.processAddressTransactions(rawData as MoralisTransaction[], userAddress);
    default:
      throw new Error(`Unsupported provider for transaction processing: ${providerName}`);
  }
}
```

**6. Operation Type Mapping**

- ✅ **Raw Operations**: Use `getRawAddressTransactions` for fetching
- ✅ **Token Operations**: Separate `getTokenTransactions` for ERC-20/token data
- ✅ **Balance Operations**: Use `getRawAddressBalance` + `getRawTokenBalances`

#### ⚠️ Common Pitfalls and Solutions

**7. API Key URL Structure**

- ❌ **Wrong URL**: `baseUrl: 'https://eth-mainnet.g.alchemy.com/v2/${apiKey}'`
- ✅ **Correct Pattern**: `baseUrl: 'https://eth-mainnet.g.alchemy.com/v2'` + endpoint `/${this.apiKey}`

**8. Logger Context Issues**

- ❌ **Global Logger**: `const logger = getLogger('ProviderName')`
- ✅ **Instance Logger**: Use `this.logger` from `BaseRegistryProvider`

**9. Provider Discovery Flow**

- ✅ **System checks registry first**: `ProviderRegistry.isRegistered(blockchain, name)`
- ✅ **Then validates API keys**: Skips if key missing or invalid
- ✅ **Creates instances**: Only for valid, registered providers

#### ✅ Avalanche Implementation - COMPLETED

**Status**: ✅ COMPLETED  
**Actual effort**: 2 hours  
**Successfully migrated**:

- ✅ `SnowtraceProvider` → `SnowtraceApiClient` + `SnowtraceProcessor`
- ✅ **Live Testing**: Successfully validated architecture with real address imports
- ✅ **Bridge Pattern**: Full backward compatibility with old system
- ✅ **Registry Integration**: Using `BaseRegistryProvider` + `@RegisterProvider`

#### 🔍 Key Lessons Learned from Avalanche Migration

**🎯 Critical Success Patterns Confirmed**

**1. Simplified Processor Architecture**

- ✅ **Static Methods Pattern**: Use static processing methods instead of IProviderProcessor interface
- ✅ **No Registry Decoration**: Processors don't need @RegisterProcessor decorator
- ✅ **Direct Bridge Calls**: Call processor methods directly from adapter bridge layer
- ❌ **Don't use IProviderProcessor**: Complex array-to-single transform doesn't fit interface

```typescript
export class SnowtraceProcessor {
  static processAddressTransactions(rawData: SnowtraceRawData, userAddress: string): BlockchainTransaction[] {
    // Process both normal and internal transactions
    const transactions: BlockchainTransaction[] = [];
    // Transform and return array
    return transactions;
  }
}
```

**2. Multi-Transaction Handling Pattern**

- ✅ **Composite Raw Data**: Handle multiple transaction types in single response
- ✅ **Unified Processing**: Combine normal + internal transactions in one method
- ✅ **Type-Safe Structure**: Use interfaces to define complex raw data shapes

```typescript
export interface SnowtraceRawData {
  normal: SnowtraceTransaction[];
  internal: SnowtraceInternalTransaction[];
}
```

**3. Transaction Type Mapping Consistency**

- ✅ **Consistent Types**: Use `transfer_in`, `transfer_out`, `internal_transfer_in`, `token_transfer_in`, etc.
- ✅ **Bridge Transform**: Let adapter handle final type mapping to UniversalTransaction
- ✅ **User Address Context**: All processors need user address to determine direction

#### Remaining Blockchains

**Status**: ⏳ PENDING  
**Estimated effort**: 2-3 days total (reduced due to proven patterns)

1. **Solana**: `HeliusProvider` → client + processor
2. **Polkadot**: `SubstrateProvider` → client + processor

**✅ COMPLETED:**

- ~~**Avalanche**: `SnowtraceProvider` → client + processor~~
- ~~**Injective**: `InjectiveExplorerProvider` + `InjectiveLCDProvider` → clients + processors~~

### 🚀 Updated Migration Checklist (v3.0)

**Based on successful Bitcoin, Injective & Ethereum migrations**

For **each blockchain**, follow this proven process:

#### 🔄 Step 1: Convert Providers to ApiClients

- [ ] Create `clients/` directory: `mkdir -p clients/`
- [ ] **CRITICAL**: Use `BaseRegistryProvider` pattern (Injective-style, not Bitcoin-style)
- [ ] Rename `XProvider.ts` → `XApiClient.ts` in new `clients/` directory
- [ ] **NEW**: Extend `BaseRegistryProvider` instead of implementing `IBlockchainProvider`
- [ ] **NEW**: Constructor only: `super('blockchain', 'provider-name', 'network')`
- [ ] Remove all validation and transformation methods
- [ ] Keep only raw data fetching methods (`getRawAddressTransactions`, `getRawAddressBalance`, etc.)
- [ ] **CRITICAL**: Use correct decorator metadata:
  ```typescript
  @RegisterProvider({
    blockchain: 'ethereum',
    name: 'provider-name', // MUST match config file
    type: 'rest', // NOT 'api'
    capabilities: { supportedOperations: [...] }
  })
  ```

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
- [ ] **CRITICAL**: Import clients index to trigger registration: `import './clients/index.ts'`
- [ ] **NEW**: Add bridge processing methods in adapter:
  ```typescript
  private processRawTransactions(rawData: unknown, providerName: string, userAddress: string): BlockchainTransaction[] {
    switch (providerName) {
      case 'provider-name':
        return ProviderProcessor.processAddressTransactions(rawData as ProviderRawType[], userAddress);
      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }
  }
  ```
- [ ] **NEW**: Update `fetchRawTransactions()` to use bridge pattern:
  ```typescript
  const rawResult = await this.providerManager.executeWithFailover('blockchain', {
    type: 'getRawAddressTransactions',
    // ...
  });
  const processed = this.processRawTransactions(rawResult.data, rawResult.providerName, address);
  ```
- [ ] **Bridge Pattern**: Update `transformTransactions()` to use processor:
  ```typescript
  protected async transformTransactions(rawTxs: BlockchainTransaction[], params: UniversalFetchParams): Promise<UniversalTransaction[]> {
    return BlockchainTransactionProcessor.processTransactions(rawTxs, params.addresses || []);
  }
  ```

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

- [ ] **CRITICAL**: Create `clients/index.ts` that **imports** (not exports) all clients:
  ```typescript
  // Import all API clients to trigger their registration
  import './Provider1ApiClient.ts';
  import './Provider2ApiClient.ts';
  ```
- [ ] Create `processors/index.ts`: Export all processors (optional)

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
- **Ethereum (100%)**: 2 providers migrated + comprehensive lessons learned
- **Avalanche (100%)**: 1 provider migrated + simplified processor patterns ✨
- **Architecture**: Processor factory, interfaces, validation patterns, bridge compatibility
- **Type Safety**: All compilation and linting errors resolved

### ⏳ PENDING

- **Solana**: 1 provider to migrate
- **Polkadot**: 1 provider to migrate

### 🎯 Next Immediate Steps

1. **Start with Solana** - most complex transaction processing
2. **Apply simplified processor patterns** from Avalanche migration
3. **Test each blockchain individually** before moving to next

### 📊 Progress Summary

**Completion Rate**: 4/5 blockchains (80%)  
**Remaining Effort**: ~1-2 days total (reduced due to proven patterns)  
**Key Innovation**: Bridge pattern allows instant compatibility with old system

**Major Breakthrough**: Avalanche migration simplified the processor architecture, enabling:

- ✅ Zero breaking changes for existing workflows
- ✅ New architecture ready for future full migration
- ✅ Real-world validation with live blockchain data
- ✅ Simplified processor patterns without complex interfaces
- ✅ Reduced migration complexity for remaining blockchains
