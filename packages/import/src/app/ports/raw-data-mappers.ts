import type { Result } from 'neverthrow';

import type { ImportSessionMetadata } from './processors.ts';

/**
 * Universal blockchain transaction structure that captures the essential
 * transaction data across all blockchain types in a normalized format.
 */
export interface UniversalBlockchainTransaction {
  amount: string; // Primary transaction amount (preserves precision)
  // Block context (optional for pending)
  blockHeight?: number | undefined; // Block number/height/slot
  blockId?: string | undefined; // Block hash/ID

  currency: string; // Primary currency symbol (BTC, ETH, AVAX, SOL, INJ)
  // Fee (single field, not nested object)
  feeAmount?: string | undefined; // Fee amount as string for precision
  feeCurrency?: string | undefined; // Fee currency (usually same as primary currency)
  // Transaction participants and value
  from: string; // Source address

  // Core transaction identity
  id: string; // hash/txid/signature
  // Provider metadata
  providerId: string; // Which provider fetched this data

  status: 'success' | 'failed' | 'pending';
  timestamp: number; // Unix timestamp in milliseconds

  to: string; // Destination address

  // Token context (for token transfers)
  tokenAddress?: string | undefined; // Contract/mint address
  tokenDecimals?: number | undefined; // Token decimal places
  tokenSymbol?: string | undefined; // Token symbol

  // Transaction classification
  type:
    | 'transfer'
    | 'transfer_in'
    | 'transfer_out'
    | 'contract_call'
    | 'token_transfer'
    | 'internal'
    | 'delegate'
    | 'undelegate';
}

/**
 * Interface for provider-specific processors that handle validation and transformation
 */
export interface IRawDataMapper<TRawData, TNormalizedData = UniversalBlockchainTransaction> {
  map(rawData: TRawData, sessionContext: ImportSessionMetadata): Result<TNormalizedData, string>;
}
