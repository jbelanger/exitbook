# Implementation: Beacon Chain Withdrawal Support

**Status:** Ready to Start - All product decisions locked
**Target:** Ethereum Mainnet (all addresses - EOA and contract)
**Priority:** High - Required for accurate balance tracking and tax calculations

✅ **READY:** All product decisions have been finalized. Implementation can proceed.

---

## ✅ Product Decisions - LOCKED

**All decisions finalized as of 2025-12-19. Implementation unblocked.**

| #   | Decision                         | Status        | Resolution                     | Impact                                          |
| --- | -------------------------------- | ------------- | ------------------------------ | ----------------------------------------------- |
| 1   | **Tax Classification**           | ✅ **Locked** | **Option B+ (Smart Default)**  | < 32 ETH = reward, ≥ 32 ETH = deposit + warning |
| 2   | **Scope (All vs Contract-Only)** | ✅ **Locked** | **Option A (All addresses)**   | Fetch for both EOA and contracts                |
| 3   | **Missing API Key UX**           | ✅ **Locked** | **Option C (Prompt + Banner)** | Interactive prompt + report warnings            |
| 4   | **Import Performance**           | ✅ **Locked** | **Option A (Fetch All)**       | Use existing cursor infrastructure              |

**See "Product Decisions" section below for detailed rationale.**

---

## Problem Statement

Any Ethereum address (EOA or contract) can receive beacon chain consensus layer withdrawals following the Shanghai upgrade (April 2023). These withdrawals are NOT regular transactions and don't appear in standard transaction APIs. Without tracking withdrawals, portfolio balances and cost basis calculations are incorrect for:

- **Validator withdrawal addresses** - Staking rewards and exited stake
- **Staking pool contracts** - Aggregated withdrawals for pool participants
- **User EOAs** - Direct validator withdrawals to personal addresses

**Example:** Address `0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913` receives beacon withdrawals that don't show up in transaction history, causing balance mismatches.

**Current Solution:** Etherscan provides a dedicated endpoint (`txsBeaconWithdrawal`) that returns withdrawal events. This is currently the only provider with this capability. **Future:** Beacon node APIs and other providers may add support; this implementation should accommodate that evolution.

---

## Architecture Decision

**Approach:** Treat beacon withdrawals as a special type of EVM transaction rather than creating a separate schema.

**Rationale:**

- Withdrawals affect balances exactly like deposits (inflow of native currency)
- Existing processor logic handles deposits perfectly
- Reuses 90% of infrastructure (streaming, caching, deduplication, correlation)
- Withdrawals map naturally to transaction concepts: timestamp, block, amount, recipient
- Avoids duplicating complex processing logic

**Trade-offs:**

- ✅ Minimal code changes, high reuse
- ✅ Automatic balance calculation integration
- ✅ Works with existing reporting/export
- ⚠️ Conceptually impure (withdrawals aren't "transactions")
- ⚠️ Etherscan-only initially (acceptable - only provider with endpoint)

---

## Product Decisions

**✅ ALL DECISIONS FINALIZED - IMPLEMENTATION UNBLOCKED**

### 1. Tax Classification of Withdrawals ✅ LOCKED

**Question:** How should beacon withdrawals be classified for tax/accounting purposes?

**Context:** Beacon withdrawals come in two types:

- **Partial withdrawals** - Validator rewards/excess balance (amounts > 32 ETH)
- **Full withdrawals** - Exited validator stake (principal + rewards)

**✅ APPROVED DECISION: Option B+ (Smart Default with Manual Override)**

**Rationale:** Treating all withdrawals as income (Option A) would create catastrophic tax liabilities on principal returns. The 32 ETH threshold provides a safe, deterministic heuristic for classification.

**Implementation Logic:**

- **Rule 1:** Withdrawal amount **< 32 ETH** → Classify as `staking/reward` (Taxable Income)
  - Covers 99% of partial withdrawals (skimming rewards)
  - Taxable at fair market value on receipt date

- **Rule 2:** Withdrawal amount **≥ 32 ETH** → Classify as `staking/deposit` (Non-taxable Transfer)
  - Treated as return of principal (non-taxable event)
  - Adds warning note with `needs_review: true` flag for user verification
  - User can manually reclassify if withdrawal contains rewards

**Impact on Implementation:**

- Operation category: Always `'staking'`
- Operation type: `'reward'` (< 32 ETH) or `'deposit'` (≥ 32 ETH)
- Notes: Include classification reasoning and warning for large withdrawals
- Add `needs_review` metadata flag for withdrawals ≥ 32 ETH

---

### 2. Scope: All Addresses vs. Warning for EOAs ✅ LOCKED

**Question:** Should we fetch withdrawals for ALL addresses or only "expected" withdrawal addresses?

**Context:** EOAs receiving withdrawals is rare but valid. Contract addresses are more common.

**✅ APPROVED DECISION: Option A (All Addresses)**

**Rationale:** Many solo stakers use simple EOA addresses (Ledger/MetaMask) as withdrawal addresses. Skipping EOAs would cause balance mismatches and destroy user trust. The performance cost of checking an EOA with zero withdrawals is negligible (one API call).

**Implementation Logic:**

- Fetch beacon withdrawals for **all** Ethereum mainnet addresses (EOA and contract)
- No special EOA detection or filtering logic required
- Return empty array for addresses with no withdrawals (standard behavior)

**Impact on Implementation:**

- No special case logic needed
- Applies to all addresses uniformly
- Simplifies implementation

---

### 3. Missing Etherscan API Key UX ✅ LOCKED

**Question:** What happens when withdrawals are enabled by default but user has no Etherscan API key?

**Context:** Etherscan requires API key. Free tier exists but requires signup.

**✅ APPROVED DECISION: Option C (Prompt + Offer) + Persistent UI Banner**

**Rationale:** Hard failures break workflows. Silent failures lead to support tickets when balances don't match. Prompting users with clear trade-offs provides the best experience.

**Implementation Logic:**

**CLI Behavior:**

1. If `blockchain == ethereum` and `ETHERSCAN_API_KEY` is missing/invalid:
   - Show high-visibility warning:
     ```
     ⚠️  Missing Etherscan API Key
     Beacon withdrawals will be skipped. Your ETH balance will likely be incorrect.
     Get free key: https://etherscan.io/apis
     Set in .env: ETHERSCAN_API_KEY=your_key_here
     ```
2. Interactive mode: Prompt "Continue without withdrawals? [Skip/Abort]"
3. Non-interactive mode: Auto-skip with warning logged

**Report/Export Behavior:**

- If a report is generated for Ethereum and withdrawals were skipped:
  - Add `Data Completeness: Partial` tag to report header
  - Include warning banner explaining missing data

**Impact on Implementation:**

- Add `handleMissingEtherscanKey()` method in importer
- Add metadata tracking to reports: `includesBeaconWithdrawals: boolean`
- Update export format to include data completeness flags

---

### 4. Import Performance for High-Withdrawal Addresses ✅ LOCKED

**Question:** How to handle addresses with 10k+ withdrawals (active validators)?

**Context:** Active validators may have hundreds of withdrawals. Large staking pool contracts may have 10,000+ withdrawals.

**✅ APPROVED DECISION: Option A (Fetch All)**

**Rationale:** Existing cursor/checkpoint infrastructure already handles incremental imports and pagination. No need to artificially limit or complicate the initial fetch. The provider streaming adapters will handle large result sets appropriately.

**Implementation Logic:**

- Fetch all withdrawals in single operation (let provider handle pagination internally)
- Rely on existing cursor infrastructure for incremental re-imports
- Provider's streaming adapter manages rate limits and chunking
- Log progress for visibility during large fetches

**Typical Performance:**

- Solo validator (200-500 withdrawals): < 5 seconds
- Small pool (1,000-5,000 withdrawals): 10-30 seconds
- Large pool (10,000+ withdrawals): 1-2 minutes (handled by streaming)

**Impact on Implementation:**

- No special pagination logic needed in importer
- Leverage existing `StreamingOperationParams` infrastructure
- Standard progress logging applies
- No artificial limits or caps

---

## Technical Specification

### 1. Core Type System Changes

#### 1.1 Provider Operations

**File:** `packages/blockchain-providers/src/core/types/operations.ts`

**Changes:**

```typescript
// Line 3-23: Add new operation parameter type
export type ProviderOperationParams =
  | {
      address: string;
      limit?: number | undefined;
      type: 'getAddressTransactions';
    }
  | {
      address: string;
      limit?: number | undefined;
      type: 'getAddressInternalTransactions';
    }
  | {
      address: string;
      limit?: number | undefined;
      type: 'getAddressBeaconWithdrawals'; // ← NEW
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressBalances' }
  | { address: string; type: 'hasAddressTransactions' }
  | {
      address: string;
      contractAddress?: string | undefined;
      limit?: number | undefined;
      type: 'getAddressTokenTransactions';
    }
  | { address: string; contractAddresses?: string[] | undefined; type: 'getAddressTokenBalances' }
  | { contractAddress: string; type: 'getTokenMetadata' };

// Line 30-35: Add to streaming operations (withdrawals are paginated)
type StreamingOperationParams = Extract<
  ProviderOperationParams,
  | { type: 'getAddressTransactions' }
  | { type: 'getAddressInternalTransactions' }
  | { type: 'getAddressBeaconWithdrawals' } // ← NEW
  | { type: 'getAddressTokenTransactions' }
>;

// Line 44-51: Add to operation type enum
export type ProviderOperationType =
  | 'getAddressTransactions'
  | 'getAddressBalances'
  | 'hasAddressTransactions'
  | 'getAddressTokenTransactions'
  | 'getAddressTokenBalances'
  | 'getAddressInternalTransactions'
  | 'getAddressBeaconWithdrawals' // ← NEW
  | 'getTokenMetadata';
```

#### 1.2 EVM Transaction Schema

**File:** `packages/blockchain-providers/src/blockchains/evm/schemas.ts`

**Changes:**

```typescript
// Line 42-79: Add 'beacon_withdrawal' to type enum
export const EvmTransactionSchema = NormalizedTransactionBaseSchema.extend({
  // EVM-specific transaction data
  type: z.enum([
    'transfer',
    'token_transfer',
    'internal',
    'contract_call',
    'beacon_withdrawal'  // ← NEW: Consensus layer withdrawals (post-Shanghai)
  ]),
  // ... rest unchanged
```

**Update schema documentation comment:**

```typescript
/**
 * Schema for unified EVM transaction
 *
 * Validates transactions from all EVM-compatible chains (Ethereum, Avalanche, etc.)
 * Supports the superset of features across all chains.
 *
 * Transaction types:
 * - transfer: Regular ETH/native currency transfer
 * - token_transfer: ERC20/ERC721/ERC1155 token transfer
 * - internal: Internal transaction (contract-to-contract, contract-to-EOA)
 * - contract_call: Contract interaction with no value transfer
 * - beacon_withdrawal: Consensus layer withdrawal (Ethereum post-Shanghai only)
 *   - Validator rewards or exited stake withdrawn to execution layer
 *   - No transaction hash (uses withdrawal index as identifier)
 *   - Always successful, no fees, from beacon chain (0x000...000)
 *
 * ... rest of existing comment
 */
```

### 2. Etherscan Provider Implementation

**Directory:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/`

**Files to create:**

#### 2.1 Provider Metadata and Registration

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/metadata.ts`

```typescript
import type { ProviderMetadata } from '../../../../core/types/index.js';

export const etherscanMetadata: ProviderMetadata = {
  name: 'etherscan',
  displayName: 'Etherscan',
  blockchain: 'ethereum',
  type: 'api',
  requiresApiKey: true,
  apiKeyEnvVar: 'ETHERSCAN_API_KEY',
  capabilities: {
    operations: [
      'getAddressTransactions',
      'getAddressInternalTransactions',
      'getAddressTokenTransactions',
      'getAddressTokenBalances',
      'getAddressBalances',
      'getAddressBeaconWithdrawals', // ← NEW: Etherscan-only capability
      'getTokenMetadata',
    ],
    streaming: {
      transactions: true,
      internalTransactions: true,
      tokenTransactions: true,
      beaconWithdrawals: true, // ← NEW
    },
  },
  defaultConfig: {
    baseUrl: 'https://api.etherscan.io',
    rateLimit: {
      requestsPerSecond: 4, // Etherscan free tier: 5/sec
      requestsPerMinute: 240,
      requestsPerHour: 14400,
      burstLimit: 5,
    },
    retries: 3,
    timeout: 30000,
  },
  chainConfigs: {
    ethereum: {
      mainnet: {
        baseUrl: 'https://api.etherscan.io',
      },
      // Testnets can be added later if needed
    },
  },
};
```

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/register-api.ts`

```typescript
import { RegisterApiClient } from '../../../../core/decorators/register-api-client.js';
import { BaseApiClient } from '../../../../core/base/api-client.js';
import type { ProviderConfig } from '../../../../core/types/index.js';
import { etherscanMetadata } from './metadata.js';

@RegisterApiClient(etherscanMetadata)
export class EtherscanApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
  }

  // Implementation in next section
}
```

#### 2.2 Type Definitions

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/etherscan.types.ts`

```typescript
import { z } from 'zod';

/**
 * Raw API response from Etherscan txsBeaconWithdrawal endpoint
 *
 * Docs: https://docs.etherscan.io/api-endpoints/accounts#get-beacon-chain-withdrawals-by-address-and-block-range
 */
export const EtherscanBeaconWithdrawalSchema = z.object({
  withdrawalIndex: z.string(), // Unique withdrawal identifier
  validatorIndex: z.string(), // Validator that initiated withdrawal
  address: z.string(), // Withdrawal recipient address
  amount: z.string(), // Amount in Gwei (not Wei!)
  blockNumber: z.string(), // Execution layer block
  timestamp: z.string(), // Unix timestamp (seconds)
});

export const EtherscanBeaconWithdrawalResponseSchema = z.object({
  status: z.enum(['0', '1']), // '0' = error, '1' = success
  message: z.string(),
  result: z.union([
    z.array(EtherscanBeaconWithdrawalSchema),
    z.string(), // Error message when status='0'
  ]),
});

export type EtherscanBeaconWithdrawal = z.infer<typeof EtherscanBeaconWithdrawalSchema>;
export type EtherscanBeaconWithdrawalResponse = z.infer<typeof EtherscanBeaconWithdrawalResponseSchema>;

/**
 * Special address representing the beacon chain as "sender"
 * Used as `from` field for beacon withdrawals
 */
export const BEACON_CHAIN_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
```

#### 2.3 Mapper Utilities

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/etherscan.mapper-utils.ts`

```typescript
import type { EvmChainConfig, EvmTransaction } from '../../../schemas.js';
import { generateUniqueTransactionEventId } from '../../../../../core/utils/id-utils.js';
import { normalizeEvmAddress } from '../../../utils.js';
import { Decimal } from 'decimal.js';
import { getLogger } from '@exitbook/logger';
import type { EtherscanBeaconWithdrawal } from './etherscan.types.js';
import { BEACON_CHAIN_ADDRESS } from './etherscan.types.js';

const logger = getLogger('etherscan-mapper');

/**
 * Maps Etherscan beacon withdrawal to normalized EVM transaction.
 *
 * Key differences from regular transactions:
 * - No transaction hash (uses withdrawal index as unique ID)
 * - Amount is in Gwei, not Wei (must convert)
 * - Always successful, no fees
 * - "From" is beacon chain (0x000...000)
 * - Includes validator metadata in notes
 */
export function mapEtherscanWithdrawalToEvmTransaction(
  raw: EtherscanBeaconWithdrawal,
  chainConfig: EvmChainConfig,
  providerName = 'etherscan'
): EvmTransaction {
  // Generate unique event ID using withdrawal index
  // Format: "beacon-withdrawal-{withdrawalIndex}"
  const syntheticHash = `beacon-withdrawal-${raw.withdrawalIndex}`;
  const eventId = generateUniqueTransactionEventId({
    transactionHash: syntheticHash,
    discriminatingFields: {
      withdrawalIndex: raw.withdrawalIndex,
      validatorIndex: raw.validatorIndex,
    },
  });

  // Convert amount from Gwei to Wei (multiply by 10^9)
  // Etherscan returns withdrawals in Gwei, not Wei like regular txs
  const amountGwei = new Decimal(raw.amount);
  const amountWei = amountGwei.times(new Decimal(10).pow(9));

  // Parse timestamp (Etherscan returns seconds, we need milliseconds)
  const timestampMs = Number(raw.timestamp) * 1000;

  // Smart tax classification: 32 ETH threshold
  // < 32 ETH = staking reward (taxable income)
  // >= 32 ETH = principal return (non-taxable deposit)
  const ETH_32_WEI = new Decimal(32).times(new Decimal(10).pow(18));
  const isPrincipalReturn = amountWei.gte(ETH_32_WEI);

  logger.debug(
    {
      withdrawalIndex: raw.withdrawalIndex,
      validatorIndex: raw.validatorIndex,
      amountGwei: raw.amount,
      amountWei: amountWei.toFixed(),
      blockNumber: raw.blockNumber,
      isPrincipalReturn,
    },
    'Mapping beacon withdrawal'
  );

  return {
    id: syntheticHash,
    eventId,
    type: 'beacon_withdrawal',
    status: 'success', // Withdrawals are always successful
    timestamp: timestampMs,
    providerName,

    // Beacon chain is conceptual "sender"
    from: BEACON_CHAIN_ADDRESS,
    to: normalizeEvmAddress(raw.address),

    // Amount in Wei (converted from Gwei)
    amount: amountWei.toFixed(),
    currency: chainConfig.nativeCurrency,

    // Block context
    blockHeight: Number(raw.blockNumber),
    blockId: raw.blockNumber,

    // No fees for beacon withdrawals (consensus layer -> execution layer)
    gasPrice: '0',
    gasUsed: '0',
    feeAmount: '0',
    feeCurrency: chainConfig.nativeCurrency,

    // Token metadata
    tokenType: 'native',

    // Tax classification based on amount threshold (see Product Decision #1)
    operation: {
      category: 'staking',
      type: isPrincipalReturn ? 'deposit' : 'reward',
    },

    // Attach metadata note with classification reasoning
    notes: [
      {
        type: 'consensus_withdrawal',
        message: isPrincipalReturn ? 'Possible principal return (>= 32 ETH)' : 'Staking reward withdrawal',
        severity: isPrincipalReturn ? 'warning' : 'info',
        metadata: {
          withdrawalIndex: raw.withdrawalIndex,
          validatorIndex: raw.validatorIndex,
          amountWei: amountWei.toFixed(),
          needsReview: isPrincipalReturn,
        },
      },
    ],
  };
}

/**
 * Validates Etherscan API response and extracts withdrawal data.
 * Returns empty array for valid "no results" responses.
 */
export function parseEtherscanWithdrawalResponse(
  response: unknown
): { success: true; data: EtherscanBeaconWithdrawal[] } | { success: false; error: string } {
  // Validate response structure
  const parseResult = EtherscanBeaconWithdrawalResponseSchema.safeParse(response);
  if (!parseResult.success) {
    return {
      success: false,
      error: `Invalid Etherscan response: ${parseResult.error.message}`,
    };
  }

  const validated = parseResult.data;

  // Check API status
  if (validated.status === '0') {
    // Status '0' means error
    const errorMsg = typeof validated.result === 'string' ? validated.result : validated.message;

    // "No transactions found" is a valid state, not an error
    if (errorMsg.toLowerCase().includes('no')) {
      logger.debug('No beacon withdrawals found for address');
      return { success: true, data: [] };
    }

    return {
      success: false,
      error: `Etherscan API error: ${errorMsg}`,
    };
  }

  // Status '1' with array result
  if (!Array.isArray(validated.result)) {
    return {
      success: false,
      error: 'Unexpected response format: result is not an array',
    };
  }

  return {
    success: true,
    data: validated.result,
  };
}
```

#### 2.4 API Client Implementation

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/etherscan.api-client.ts`

```typescript
import type { ProviderConfig, ProviderOperation } from '../../../../core/types/index.js';
import type { EvmTransaction } from '../../schemas.js';
import { getEvmChainConfig } from '../../evm-chains.js';
import { BaseApiClient } from '../../../../core/base/api-client.js';
import { err, ok, type Result } from 'neverthrow';
import { RegisterApiClient } from '../../../../core/decorators/register-api-client.js';
import { etherscanMetadata } from './metadata.js';
import { mapEtherscanWithdrawalToEvmTransaction, parseEtherscanWithdrawalResponse } from './etherscan.mapper-utils.js';

@RegisterApiClient(etherscanMetadata)
export class EtherscanApiClient extends BaseApiClient {
  private readonly chainConfig;

  constructor(config: ProviderConfig) {
    super(config);

    const chainConfigResult = getEvmChainConfig(config.chain || 'mainnet');
    if (chainConfigResult.isErr()) {
      throw new Error(`Invalid chain config: ${chainConfigResult.error}`);
    }
    this.chainConfig = chainConfigResult.value;
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    switch (operation.type) {
      case 'getAddressBeaconWithdrawals': {
        this.validateApiKey();
        const { address, limit } = operation;
        return (await this.getAddressBeaconWithdrawals(address, limit)) as Result<T, Error>;
      }

      // Other operations would be implemented here
      // (getAddressTransactions, getAddressInternalTransactions, etc.)

      default:
        return err(new Error(`Operation ${operation.type} not implemented for Etherscan`));
    }
  }

  /**
   * Fetches beacon chain withdrawals for an address.
   *
   * Note: Etherscan endpoint supports pagination via startblock/endblock,
   * but for simplicity we fetch all withdrawals initially.
   * Future optimization: implement proper pagination with block ranges.
   */
  private async getAddressBeaconWithdrawals(
    address: string,
    _limit?: number
  ): Promise<Result<EvmTransaction[], Error>> {
    this.logger.debug({ address }, 'Fetching beacon withdrawals from Etherscan');

    const response = await this.httpClient.get('/api', {
      params: {
        module: 'account',
        action: 'txsBeaconWithdrawal',
        address,
        // startblock and endblock could be added for pagination
        // page and offset not supported by this endpoint
        apikey: this.apiKey,
      },
    });

    if (response.isErr()) {
      return err(response.error);
    }

    // Parse and validate response
    const parsed = parseEtherscanWithdrawalResponse(response.value);
    if (!parsed.success) {
      return err(new Error(parsed.error));
    }

    // Map to EVM transactions
    const withdrawals = parsed.data.map((raw) =>
      mapEtherscanWithdrawalToEvmTransaction(raw, this.chainConfig, this.name)
    );

    this.logger.info({ count: withdrawals.length, address }, 'Successfully fetched beacon withdrawals');

    return ok(withdrawals);
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/api',
      method: 'GET' as const,
      validate: (response: unknown) => {
        const data = response as { status?: string };
        return data.status === '1';
      },
    };
  }
}
```

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/index.ts`

```typescript
export { EtherscanApiClient } from './etherscan.api-client.js';
export { etherscanMetadata } from './metadata.js';
export * from './etherscan.types.js';
export * from './etherscan.mapper-utils.js';
```

#### 2.5 Register Provider

**File:** `packages/blockchain-providers/src/blockchains/evm/register-apis.ts`

```typescript
// Add to existing imports and registrations
import './providers/etherscan/register-api.js'; // ← NEW
```

### 3. Processor Updates

**File:** `packages/ingestion/src/sources/blockchains/evm/processor-utils.ts`

**Changes:**

```typescript
// Line 294-520: Update analyzeEvmFundFlow to handle beacon withdrawals
// Add after line 308 (hasContractInteraction detection):

// Beacon withdrawals are always deposits from consensus layer
const hasBeaconWithdrawals = txGroup.some((tx) => tx.type === 'beacon_withdrawal');

// Line 576-579: Update isEvmNativeMovement
export function isEvmNativeMovement(tx: EvmTransaction, chainConfig: EvmChainConfig): boolean {
  const native = chainConfig.nativeCurrency.toLowerCase();

  // Beacon withdrawals are always native currency movements
  if (tx.type === 'beacon_withdrawal') {
    return true;
  }

  return tx.currency.toLowerCase() === native || (tx.tokenSymbol ? tx.tokenSymbol.toLowerCase() === native : false);
}
```

**File:** `packages/ingestion/src/sources/blockchains/evm/processor.ts`

**Add helper to attach withdrawal metadata as notes:**

```typescript
// After line 162 (scam detection):

// Attach metadata for beacon withdrawals
for (const tx of txGroup) {
  if (tx.type === 'beacon_withdrawal') {
    // Extract metadata from the synthetic transaction ID
    // Format: "beacon-withdrawal-{withdrawalIndex}"
    const withdrawalIndex = tx.id.replace('beacon-withdrawal-', '');

    universalTransaction.notes = [
      ...(universalTransaction.notes || []),
      {
        type: 'consensus_withdrawal',
        message: 'Beacon chain consensus layer withdrawal',
        severity: 'info',
        metadata: {
          withdrawalIndex,
          blockHeight: tx.blockHeight,
          // validatorIndex would need to be stored if we want it
          // (currently not in EvmTransaction schema)
        },
      },
    ];
    break; // Only need to add note once per group
  }
}
```

**✅ Tax Classification (Decision #1 Implemented):**

Tax classification is handled in the mapper (`mapEtherscanWithdrawalToEvmTransaction`), not the processor. The `operation` field is set during mapping based on the 32 ETH threshold:

- **< 32 ETH:** `operation: { category: 'staking', type: 'reward' }`
- **≥ 32 ETH:** `operation: { category: 'staking', type: 'deposit' }` + warning note

**No processor override needed** - the mapper sets the correct operation type, and the processor will use it as-is. The fund flow analysis will correctly identify these as deposits (inflows from beacon chain address).

### 4. Importer Updates

**File:** `packages/ingestion/src/sources/blockchains/evm/importer.ts`

**Add withdrawal fetching logic:**

```typescript
// Add method to check if withdrawals should be fetched
private shouldFetchBeaconWithdrawals(options: ImportOptions): boolean {
  // Only fetch for Ethereum mainnet
  if (this.chainConfig.chainName !== 'ethereum') {
    return false;
  }



  // Check if provider supports the operation
  const supportsWithdrawals = this.provider.capabilities.operations.includes(
    'getAddressBeaconWithdrawals'
  );

  if (!supportsWithdrawals) {
    this.logger.debug(
      `Provider ${this.provider.name} does not support beacon withdrawals, skipping`
    );
  }

  return supportsWithdrawals;
}

// ⚠️ REQUIRES PRODUCT DECISION #3 - Missing API Key Handling
// If Option C (Prompt + Offer) is chosen, add this method:
private async handleMissingEtherscanKey(context: ImportContext): Promise<'skip' | 'abort'> {
  // Detect if Etherscan is the provider and API key is missing/invalid
  if (this.provider.name === 'etherscan' && this.provider.apiKey === 'YourApiKeyToken') {
    this.logger.warn(
      '\n⚠️  WARNING: Etherscan API key not configured\n' +
      'Beacon withdrawals cannot be fetched without an Etherscan API key.\n' +
      'Get a free key at: https://etherscan.io/apis\n' +
      'Set in .env: ETHERSCAN_API_KEY=your_key_here\n'
    );

    // If running in interactive mode, prompt user
    if (context.options.interactive) {
      const answer = await promptUser(
        'Continue without beacon withdrawals?',
        ['Skip withdrawals (balances may be wrong)', 'Abort import']
      );
      return answer === 0 ? 'skip' : 'abort';
    }

    // Non-interactive: auto-skip with warning
    this.logger.warn('Non-interactive mode: skipping beacon withdrawals');
    return 'skip';
  }

  return 'skip';  // Not Etherscan or key is valid
}

// Add to import() method, after fetching other transaction types:
async import(context: ImportContext): Promise<Result<RawTransaction[], Error>> {
  const rawTransactions: RawTransaction[] = [];

  // ... existing transaction fetching ...

  // Fetch beacon withdrawals if supported and enabled
  if (this.shouldFetchBeaconWithdrawals(context.options)) {
    this.logger.info('Fetching beacon chain withdrawals...');

    const withdrawalsResult = await this.provider.execute<EvmTransaction[]>({
      type: 'getAddressBeaconWithdrawals',
      address: context.primaryAddress,
    });

    if (withdrawalsResult.isErr()) {
      this.logger.warn(
        { error: withdrawalsResult.error },
        'Failed to fetch beacon withdrawals, continuing without them'
      );
    } else {
      const withdrawals = withdrawalsResult.value;
      this.logger.info(
        { count: withdrawals.length },
        'Successfully fetched beacon withdrawals'
      );

      // Convert to RawTransaction format for persistence
      const rawWithdrawals = withdrawals.map((tx) => ({
        source: this.chainConfig.chainName,
        accountId: context.accountId,
        eventId: tx.eventId,
        data: tx,
      }));

      rawTransactions.push(...rawWithdrawals);
    }
  }

  return ok(rawTransactions);
}
```

### 5. Environment Variables

**File:** `.env.example`

```bash
# Add to blockchain providers section:

# Etherscan (Ethereum blockchain explorer)
# Required for beacon withdrawal tracking on Ethereum mainnet
# Get free API key: https://etherscan.io/apis
ETHERSCAN_API_KEY=YourApiKeyToken
```

### 6. Documentation Updates

#### 7.1 Internal Documentation

**File:** `CLAUDE.md`

```markdown
## Blockchain Provider System

- Auto-registered via `@RegisterApiClient` (see `*/register-apis.ts`); metadata lives in providers.
- Chain lists come from `*-chains.json` (e.g., EVM has many chains; see file instead of enumerating here).
- Core handles failover/circuit-breakers/caching (`packages/blockchain-providers/src/core/`).
- **Beacon Withdrawals (Ethereum):** Post-Shanghai consensus layer withdrawals tracked via Etherscan
  - Not regular transactions (no tx hash, uses withdrawal index)
  - Required for accurate balances on any address that receives validator withdrawals
  - Fetched by default if provider supports it
  - Requires Etherscan API key (free tier available)
```

#### 7.2 User-Facing Documentation

**File:** `docs/features/beacon-withdrawals.md` (NEW)

````markdown
# Beacon Chain Withdrawals

## What Are Beacon Withdrawals?

Following Ethereum's Shanghai upgrade (April 2023), validators can withdraw their staked ETH and accumulated rewards from the Beacon Chain (consensus layer) to the Execution Layer (where your address balance lives).

**Types of withdrawals:**

- **Partial withdrawals** - Automatic withdrawal of rewards above 32 ETH
- **Full withdrawals** - Complete exit from validation, returning 32 ETH + rewards

These withdrawals are **not regular transactions** - they have no transaction hash, gas fees, or sender signature. They're protocol-level balance updates.

## Why This Matters

**Without tracking withdrawals, your portfolio will be wrong:**

- ❌ Balances will be understated
- ❌ Income will be missing (for tax purposes)
- ❌ Cost basis calculations incorrect

**Examples of affected addresses:**

- Solo validator withdrawal address
- Staking pool contract (Lido, Rocket Pool, etc.)
- Any EOA designated as a validator withdrawal address

## How Exitbook Handles Withdrawals

### Automatic Tracking

By default, Exitbook fetches beacon withdrawals for **all Ethereum mainnet addresses**:

```bash
pnpm run dev import --blockchain ethereum --address 0x...
```

This will:

1. Fetch regular transactions (transfers, token transfers, etc.)
2. Fetch beacon withdrawals (if Etherscan API key is configured)
3. Merge both into complete transaction history
4. Calculate accurate balances

### Requirements

- **Etherscan API Key** - Free tier available at https://etherscan.io/apis
- **Ethereum Mainnet** - Withdrawals only exist on mainnet (not other EVM chains)

Set your API key in `.env`:

```bash
ETHERSCAN_API_KEY=your_api_key_here
```

## Tax Classification

**Smart Classification (32 ETH Threshold)**

Exitbook uses an intelligent classification system for beacon withdrawals:

**Withdrawals < 32 ETH:**

- **Operation Type:** `staking/reward` (taxable income)
- **Tax Treatment:** Taxable at fair market value on receipt date
- **Reasoning:** Amounts below 32 ETH are always partial withdrawals (rewards)

**Withdrawals ≥ 32 ETH:**

- **Operation Type:** `staking/deposit` (non-taxable principal return)
- **Tax Treatment:** Return of principal (cost basis already established)
- **Flag:** Marked with `needs_review: true` for manual verification
- **Reasoning:** Full validator exit (32 ETH stake + potential rewards)

**Important:**

- Large withdrawals are flagged for review in case they contain rewards
- Users can manually reclassify if needed
- Always consult your tax advisor for specific guidance

## Verification

After importing, verify withdrawals were included:

```bash
pnpm run dev export --blockchain ethereum --address 0x... --format csv
```

Look for transactions with:

- Type: `beacon_withdrawal`
- From: `0x0000000000000000000000000000000000000000` (beacon chain)
- Notes: Contains `consensus_withdrawal` metadata

Compare total balance against Etherscan to confirm accuracy.

## Troubleshooting

### "Etherscan API key not configured"

Get a free API key at https://etherscan.io/apis and add to `.env`:

```bash
ETHERSCAN_API_KEY=your_key_here
```

### Balance doesn't match Etherscan

1. Check if withdrawals were imported: `grep beacon_withdrawal data/transactions.db`
2. Verify Etherscan API key is valid

### Slow import for validator addresses

Validators with thousands of withdrawals may take longer to import. This is normal. Progress will be logged.

## Limitations

- **Etherscan only** - Currently only supported provider with withdrawal data
- **Mainnet only** - No testnet support (yet)
- **No historical partial/full distinction** - All withdrawals classified uniformly (for now)

## See Also

- [Ethereum Shanghai Upgrade](https://ethereum.org/en/roadmap/shanghai/)
- [Understanding Staking Withdrawals](https://ethereum.org/en/staking/withdrawals/)
````

#### 7.3 Balance Report Annotations

**File:** `apps/cli/src/features/balance/balance-reporter.ts` (or equivalent)

Add metadata to balance reports indicating withdrawal inclusion:

```typescript
interface BalanceReport {
  // ... existing fields
  metadata: {
    includesBeaconWithdrawals: boolean;
    withdrawalsSkippedReason?: 'no-api-key' | 'flag-disabled' | 'unsupported-chain';
  };
}

// In report output:
if (!report.metadata.includesBeaconWithdrawals) {
  console.warn(
    '\n⚠️  WARNING: Beacon withdrawals not included in this balance\n' +
      `Reason: ${report.metadata.withdrawalsSkippedReason}\n` +
      'Balance may be incorrect for addresses receiving validator withdrawals\n'
  );
}
```

---

## Implementation Checklist

### Phase 1: Core Types & Provider Infrastructure

- [ ] Update `ProviderOperationParams` to add `getAddressBeaconWithdrawals`
- [ ] Update `ProviderOperationType` enum
- [ ] Update `StreamingOperationParams` to include new operation
- [ ] Update `EvmTransactionSchema` to add `beacon_withdrawal` type
- [ ] Update EVM schema documentation comment
- [ ] Create Etherscan provider directory structure
- [ ] Implement Etherscan type definitions (`etherscan.types.ts`)
- [ ] Implement mapper utilities (`etherscan.mapper-utils.ts`)
- [ ] Write mapper unit tests (Gwei->Wei conversion, address normalization, etc.)

### Phase 2: Etherscan Provider Implementation

- [ ] Implement Etherscan metadata configuration
- [ ] Implement `EtherscanApiClient` class
- [ ] Implement `getAddressBeaconWithdrawals()` method
- [ ] Implement health check configuration
- [ ] Create provider index exports
- [ ] Register Etherscan in `register-apis.ts`
- [ ] Test provider registration (shows in `pnpm blockchain-providers:list`)
- [ ] Write integration tests for Etherscan API client

### Phase 3: Processor Integration

- [ ] Update `isEvmNativeMovement()` to handle `beacon_withdrawal` type
- [ ] Add beacon withdrawal metadata note attachment in processor
- [ ] Test withdrawal processing (should classify as deposit)
- [ ] Test correlation with other transaction types (if any)
- [ ] Write processor unit tests for beacon withdrawal scenarios

### Phase 4: Importer Integration

- [ ] Implement `shouldFetchBeaconWithdrawals()` logic
- [ ] Add withdrawal fetching to import flow
- [ ] Add logging for withdrawal fetch status
- [ ] Test withdrawal import with test address
- [ ] Verify raw_transactions table contains withdrawals

### Phase 5: CLI & User Experience

- [ ] Add warning message when withdrawals skipped
- [ ] Update CLI help text
- [ ] Add `ETHERSCAN_API_KEY` to `.env.example`
- [ ] Test end-to-end: `pnpm run dev import --blockchain ethereum --address 0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913`

### Phase 6: Documentation & Testing

- [ ] Update `CLAUDE.md` with beacon withdrawal notes
- [ ] **Add user-facing documentation** (new file: `docs/beacon-withdrawals.md`)
- [ ] **Update balance report to show withdrawal inclusion status**
- [ ] Write E2E test for withdrawal import flow
- [ ] Test balance calculation includes withdrawals
- [ ] Test export includes withdrawals in output
- [ ] Verify withdrawal amounts match Etherscan UI
- [ ] Test with address that has no withdrawals (should succeed gracefully)
- [ ] Test with provider that doesn't support withdrawals (should skip)

### Phase 7: Verification & Edge Cases

- [ ] Test with `0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913` (contract with withdrawals)
- [ ] Verify balance matches expected (including withdrawals)
- [ ] Test pagination if many withdrawals exist
- [ ] Test rate limiting behavior
- [ ] Test with invalid API key (should fail gracefully)
- [ ] Test with testnets (should skip - mainnet only)
- [ ] Verify withdrawal deduplication works (same eventId logic)

---

## Testing Strategy

### Unit Tests

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/__tests__/etherscan.mapper-utils.test.ts`

Test cases:

- ✅ Gwei to Wei conversion (multiply by 10^9)
- ✅ Timestamp conversion (seconds to milliseconds)
- ✅ Synthetic transaction hash generation
- ✅ Event ID uniqueness (different withdrawal indexes)
- ✅ Address normalization
- ✅ Zero address assignment for `from` field
- ✅ Response parsing (success, error, empty results)

**File:** `packages/ingestion/src/sources/blockchains/evm/__tests__/processor-utils.test.ts`

Test cases:

- ✅ `isEvmNativeMovement()` returns true for beacon_withdrawal
- ✅ Fund flow analysis classifies withdrawal as deposit (Pattern 4)
- ✅ Withdrawal with zero fees

### Integration Tests

**File:** `packages/blockchain-providers/src/blockchains/evm/providers/etherscan/__tests__/etherscan.api-client.e2e.test.ts`

Test cases:

- ✅ Fetch withdrawals for known address with withdrawals
- ✅ Fetch withdrawals for address with no withdrawals (returns empty)
- ✅ Handle invalid API key error
- ✅ Handle rate limiting
- ✅ Verify mapped transaction structure

**File:** `packages/ingestion/src/sources/blockchains/evm/__tests__/processor.test.ts`

Test cases:

- ✅ Process beacon withdrawal (verify movements, fees, operation classification)
- ✅ Process mixed group (regular tx + withdrawal - shouldn't happen but handle gracefully)
- ✅ Verify consensus_withdrawal note attached
- ✅ Verify metadata in notes (withdrawalIndex, blockHeight)

### E2E Tests

**File:** `apps/cli/__tests__/e2e/beacon-withdrawals.e2e.test.ts`

Test cases:

- ✅ Import for `0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913`
- ✅ Verify withdrawals saved to raw_transactions
- ✅ Verify withdrawals processed to transactions
- ✅ Verify balance calculation includes withdrawals

- ✅ Verify warning logged when skipped

### Manual Testing

1. **Address with withdrawals:**

   ```bash
   pnpm run dev import --blockchain ethereum --address 0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913
   ```

   - Should fetch transactions + withdrawals
   - Check logs for withdrawal count
   - Verify balance matches Etherscan

2. **Address without withdrawals (EOA):**

   ```bash
   pnpm run dev import --blockchain ethereum --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
   ```

   - Should succeed with 0 withdrawals
   - No errors

3. **Non-Ethereum chain:**

   ```bash
   pnpm run dev import --blockchain polygon --address 0x...
   ```

   - Should skip withdrawals (Polygon has no beacon chain)
   - No warnings

---

## Acceptance Criteria

### Functional Requirements

✅ **FR1:** Withdrawals fetched by default for Ethereum mainnet when provider supports it, unless disabled per Decisions #2/#3

✅ **FR3:** User is informed when withdrawals are skipped (manual or unsupported provider), per Decision #3 UX
✅ **FR4:** Withdrawals processed as inflows (no fees); operation category/type set per Decision #1
✅ **FR5:** Withdrawals use `0x000...000` as sender address
✅ **FR6:** Withdrawal metadata stored in transaction notes
✅ **FR7:** Balance calculations include withdrawal amounts
✅ **FR8:** Non-Ethereum chains gracefully skip (no errors)
✅ **FR9:** Addresses without withdrawals return empty array (no errors)

### Technical Requirements

✅ **TR1:** New operation type properly typed in `ProviderOperationParams`
✅ **TR2:** Etherscan provider registered and discoverable
✅ **TR3:** Gwei correctly converted to Wei (multiply by 10^9)
✅ **TR4:** Withdrawal index used for unique event ID generation
✅ **TR5:** Transaction deduplication works (same eventId = skip on re-import)
✅ **TR6:** Streaming/pagination infrastructure compatible (future optimization)
✅ **TR7:** No breaking changes to existing transaction processing
✅ **TR8:** All tests pass (unit, integration, E2E)

### Data Quality

✅ **DQ1:** Withdrawal amounts match Etherscan UI exactly
✅ **DQ2:** Timestamps accurate (converted from seconds to milliseconds)
✅ **DQ3:** Block heights match withdrawal events
✅ **DQ4:** No duplicate withdrawals after re-import
✅ **DQ5:** Balance matches expected (transactions + withdrawals)

---

## Rollout Plan

### Step 1: Development (This Implementation)

- Complete all checklist items
- Run full test suite
- Manual testing with known addresses

### Step 2: Testing Period

- Test with multiple addresses
- Monitor for rate limiting issues
- Verify balance accuracy

### Step 3: Documentation

- Update user-facing docs
- Add to troubleshooting guide
- Document Etherscan API key setup

### Step 4: Deployment

- Merge to main
- Announce feature
- Monitor for issues

---

## Known Limitations & Future Work

### Current Limitations

1. **Etherscan Dependency:** Currently the only provider with withdrawal endpoint
   - Moralis, Alchemy, Routescan don't have this endpoint (yet)
   - Users without Etherscan API key limited (see Product Decision #3)
   - **Mitigation:** Monitor for other providers adding support, abstract behind provider interface

2. **Tax Classification Simplified:** All withdrawals treated uniformly
   - No distinction between partial (rewards) vs full (principal return)
   - See Product Decision #1 for future enhancement
   - **Mitigation:** Notes contain withdrawal metadata for manual review

3. **Performance for High-Volume Addresses:** Fetches all withdrawals in single request
   - Fine for typical addresses (< 200 withdrawals over 20 months)
   - Large staking pools may have 10k+ withdrawals = slow import
   - Etherscan free tier: 5 req/sec, may hit rate limits
   - **Mitigation:** See Product Decision #4 for pagination strategy

4. **Mainnet Only:** Testnets not enabled initially
   - Easy to add later via chain config
   - Goerli/Sepolia have beacon withdrawals too
   - **Mitigation:** Config-gated, can enable when needed

5. **No Validator Metadata in Schema:** Validator index only in notes
   - Can't easily query "all withdrawals for validator X"
   - **Mitigation:** Sufficient for balance/tax, can enhance if reporting needed

### Future Enhancements

1. **Multiple Provider Support**
   - Watch for Alchemy/Moralis to add withdrawal endpoints
   - Implement when available

2. **Streaming Pagination**
   - Implement block range pagination
   - Use streaming adapter for large withdrawal sets

3. **Validator Dashboard**
   - Group withdrawals by validator
   - Show reward vs principal withdrawals
   - Staking reward tracking

4. **Testnet Support**
   - Enable Goerli/Sepolia when needed
   - Add chain config entries

---

## Risk Assessment

### Low Risk

- ✅ Non-breaking changes (additive only)
- ✅ Graceful degradation (works without Etherscan)
- ✅ No schema migrations (uses existing transaction table)
- ✅ Well-tested architecture (reuses proven patterns)

### Medium Risk

- ⚠️ Etherscan API dependency (single provider)
  - _Mitigation:_ Graceful fallback, clear error messages
- ⚠️ Gwei vs Wei confusion (unit conversion errors)
  - _Mitigation:_ Extensive unit tests, validation

### High Risk

- ❌ None identified

---

## Success Metrics

Post-implementation, we should see:

1. **Balance Accuracy:** Contract withdrawal addresses balance correctly
2. **No Errors:** Zero processing failures for withdrawal transactions
3. **Performance:** < 5s additional time to fetch withdrawals (typical address)
4. **User Adoption:** Etherscan API key in most user .env files
5. **Support Tickets:** Zero reports of "missing withdrawals" for Ethereum

---

## Questions & Decisions Log

| Question                                  | Decision                            | Rationale                                                     |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Separate schema vs extend EvmTransaction? | Extend EvmTransaction               | Reuse 90% of infrastructure, withdrawals behave like deposits |
| What address for "from" field?            | `0x0000...000` (zero address)       | Valid EVM address, conceptually represents beacon chain       |
| Fetch by default or require flag?         | Fetch by default                    | Accuracy > convenience, balances wrong without                |
| Store validator metadata?                 | In transaction notes, not schema    | Avoid schema bloat, metadata available if needed              |
| Support testnets?                         | No initially, config-gated          | Mainnet only need, easy to add later                          |
| Handle Gwei units?                        | Convert to Wei in mapper            | Consistency with all other amounts                            |
| Pagination strategy?                      | Fetch all initially, paginate later | Most addresses have < 100 withdrawals                         |

---

## Document Review & Sign-Off

### Design Review Findings (2025-12-19)

| Finding                                          | Severity     | Addressed? | Resolution                                                       |
| ------------------------------------------------ | ------------ | ---------- | ---------------------------------------------------------------- |
| Scope ambiguity (contract-only vs all addresses) | **Critical** | ✅ Yes     | Updated to "all addresses (EOA and contract)" throughout         |
| "Only Solution: Etherscan" too strong            | **Critical** | ✅ Yes     | Changed to "current solution", noted future provider support     |
| Tax semantics undefined                          | **High**     | ✅ Yes     | Added Product Decision #1 with options, blocked implementation   |
| Import cost/UX risk underspecified               | **High**     | ✅ Yes     | Added Product Decision #4, documented performance considerations |
| Default + missing API key scenario               | **Medium**   | ✅ Yes     | Added Product Decision #3 with UX options                        |
| User-facing docs missing                         | **Low**      | ✅ Yes     | Added comprehensive user documentation section                   |

### Implementation Sign-Off Checklist

All prerequisites completed:

- [x] **Product Decision #1 Locked:** Smart tax classification (32 ETH threshold) approved
- [x] **Product Decision #2 Locked:** Fetch for all addresses (EOA and contract)
- [x] **Product Decision #3 Locked:** Prompt + banner UX for missing API key
- [x] **Product Decision #4 Locked:** Fetch all withdrawals (use existing cursor infrastructure)
- [x] Architecture review complete (leverages existing transaction schema)
- [x] Security considerations documented (API key handling, data validation)
- [x] Tax classification approach documented and approved

### Sign-Off

| Role           | Name     | Date       | Status                             |
| -------------- | -------- | ---------- | ---------------------------------- |
| Product Owner  | Approved | 2025-12-19 | ✅ **Approved**                    |
| Tech Lead      | Approved | 2025-12-19 | ✅ **Approved**                    |
| Tax/Compliance | Approved | 2025-12-19 | ✅ **Approved** (32 ETH threshold) |

---

**Last Updated:** 2025-12-19
**Document Owner:** Implementation team
**Status:** ✅ **READY TO START - All decisions locked, implementation unblocked**
