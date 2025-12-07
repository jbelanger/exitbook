# UTXO Per-Address Model: Implementation Plan

## Overview

UTXO chains (Bitcoin, Cardano) currently duplicate transactions across addresses. Change: Store one record per (address, tx_hash) with that address's perspective. Wallet balance = sum all addresses.

**Core change**: Don't pass `derivedAddresses` to Bitcoin processor. Sum all per-address records for wallet balance.

## Problem

**Current**: Each address processes with `derivedAddresses`, consolidates UTXOs across wallet, creates N duplicate records showing wallet-wide perspective.

**Example**: Transaction touching 2 addresses creates 2 identical records both showing "0.01615042 BTC outflow" → 33 records for 18 unique transactions (45% duplication).

## Solution

**Per-Address UTXO Model**: Each address records only its own UTXOs. One unique record per (account, tx_hash). Wallet balance = simple sum.

**Same Example**: Account 2 shows "0.01916264 BTC outflow", Account 13 shows "0.00301222 BTC inflow". Net = -0.01615042 BTC. Result: 18 unique records, math works via aggregation.

## Implementation

### 1. Blockchain Adapter Configuration

**File**: `packages/ingestion/src/infrastructure/blockchains/shared/blockchain-adapter.ts`

Add `isUTXOChain` property to the interface:

```typescript
export interface BlockchainAdapter {
  blockchain: string;
  normalizeAddress: (address: string) => Result<string, Error>;
  createImporter: (providerManager: BlockchainProviderManager, providerName?: string) => IImporter;
  createProcessor: (tokenMetadataService?: ITokenMetadataService) => Result<ITransactionProcessor, Error>;

  /**
   * Indicates whether this blockchain uses the UTXO model (Bitcoin, Cardano).
   * UTXO chains store one transaction record per (address, tx_hash) without deduplication.
   * Account-based chains (Solana, NEAR, Substrate) require deduplication and use derivedAddresses.
   */
  isUTXOChain?: boolean;

  // ... other properties
}
```

**Files**: `packages/ingestion/src/infrastructure/blockchains/bitcoin/adapter.ts` and `cardano/adapter.ts`

Set `isUTXOChain: true` in the adapter registration:

```typescript
registerBlockchain({
  blockchain: 'bitcoin', // or 'cardano'
  isUTXOChain: true,
  // ... rest of config
});
```

### 2. Per-Address Fund Flow Analysis

**File**: `packages/ingestion/src/infrastructure/blockchains/bitcoin/processor-utils.ts`

Update fund flow analysis to work with single address only:

```typescript
export function analyzeBitcoinFundFlow(
  normalizedTx: BitcoinTransaction,
  sessionMetadata: Record<string, unknown>
): Result<BitcoinFundFlow, string> {
  if (!sessionMetadata.address || typeof sessionMetadata.address !== 'string') {
    return err('Missing user address in session metadata');
  }

  const walletAddress = sessionMetadata.address.toLowerCase();

  // Per-address mode: only check this single address
  const addressSet = new Set([walletAddress]);

  // Check inputs/outputs against this address only
  for (const input of normalizedTx.inputs) {
    if (input.address && addressSet.has(input.address.toLowerCase())) {
      walletInput += value;
    }
  }

  for (const output of normalizedTx.outputs) {
    if (output.address && addressSet.has(output.address.toLowerCase())) {
      walletOutput += value;
    }
  }

  // Rest of logic unchanged
}
```

**File**: `packages/ingestion/src/infrastructure/blockchains/bitcoin/processor.ts`

Simplify transaction type to generic 'transfer':

```typescript
export function determineBitcoinTransactionType(
  fundFlow: BitcoinFundFlow,
  _sessionMetadata: Record<string, unknown>
): 'transfer' {
  // Without derivedAddresses, can't reliably distinguish external vs internal.
  // Use generic 'transfer' - balance calculations work correctly regardless.
  // Transaction linking can provide semantic labels for display if needed.
  return 'transfer';
}
```

**File**: `packages/ingestion/src/services/process-service.ts`

Check adapter's `isUTXOChain` property to skip `derivedAddresses`:

```typescript
// For blockchain accounts with parent (xpub/HD wallet), augment metadata with sibling addresses
// Skip for UTXO chains (Bitcoin, Cardano) which use per-address model
if (sourceType === 'blockchain' && account.parentAccountId) {
  const adapter = getBlockchainAdapter(account.blockchain!);
  const isUTXOChain = adapter?.isUTXOChain ?? false;

  if (!isUTXOChain) {
    const siblingsResult = await this.accountRepository.findByParent(account.parentAccountId);
    if (siblingsResult.isOk()) {
      const siblings = siblingsResult.value;
      const derivedAddresses = siblings
        .filter((sibling) => sibling.id !== account.id)
        .map((sibling) => sibling.identifier);

      processorMetadata = {
        ...processorMetadata,
        derivedAddresses,
      };
    }
  }
}
```

### 3. Transaction Linking (Optional)

**File**: `packages/accounting/src/services/transaction-linker.ts`

Simple linking for internal transfers (same tx_hash across accounts):

```typescript
async detectInternalBlockchainTransfers(
  accountIds: number[]
): Promise<Result<TransactionLink[], Error>> {
  const matches = await this.db
    .selectFrom('transactions as t1')
    .innerJoin('transactions as t2', (join) =>
      join
        .onRef('t1.blockchain_transaction_hash', '=', 't2.blockchain_transaction_hash')
        .on('t1.account_id', '!=', 't2.account_id')
    )
    .where('t1.blockchain_transaction_hash', 'is not', null)
    .where('t1.account_id', 'in', accountIds)
    .where('t2.account_id', 'in', accountIds)
    .select(['t1.id as source_id', 't2.id as target_id'])
    .execute();

  const links: TransactionLink[] = matches.map(match => ({
    source_transaction_id: match.source_id,
    target_transaction_id: match.target_id,
    link_type: 'blockchain_internal'
  }));

  return ok(links);
}
```

### 4. Database

No migration needed - existing schema already supports this.

### 5. Testing

Test that wallet balance from multiple addresses sums correctly.

**Note**: Balance aggregation now works via simple summation - no deduplication needed since UTXO chains use per-address model and account-based chains don't create duplicates.

## Rollout

1. Update Bitcoin processor to remove `derivedAddresses` usage
2. Update balance service to skip deduplication for Bitcoin
3. Test with xpub import
4. Deploy

No database migration. No breaking changes. Old duplicates remain but don't break anything.

## Benefits

1. **Correctness**: Per-address UTXO amounts are mathematically correct
2. **Storage Efficiency**: Eliminate 45% duplicate records for Bitcoin
3. **Performance**: No sibling address queries during processing
4. **Simplicity**: Each record shows true per-address perspective
5. **Maintainability**: Clearer mental model, easier to debug

## Files to Modify

**Blockchain Adapter:**

- `packages/ingestion/src/infrastructure/blockchains/shared/blockchain-adapter.ts` - Add `isUTXOChain` property to interface
- `packages/ingestion/src/infrastructure/blockchains/bitcoin/adapter.ts` - Set `isUTXOChain: true`
- `packages/ingestion/src/infrastructure/blockchains/cardano/adapter.ts` - Set `isUTXOChain: true`

**Processing:**

- `packages/ingestion/src/infrastructure/blockchains/bitcoin/processor-utils.ts` - Remove `derivedAddresses` from fund flow
- `packages/ingestion/src/infrastructure/blockchains/bitcoin/processor.ts` - Return 'transfer' for all transaction types
- `packages/ingestion/src/services/process-service.ts` - Check `isUTXOChain` to skip sibling address aggregation

**Balance:**

- `packages/ingestion/src/services/balance/balance-service.ts` - Check `isUTXOChain` to skip deduplication

**Linking (Optional):**

- `packages/accounting/src/services/transaction-linker.ts` - Add simple internal transfer detection

**Tests:**

- Update Bitcoin processor tests
- Add balance aggregation tests
