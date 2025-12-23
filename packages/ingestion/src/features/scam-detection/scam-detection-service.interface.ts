import type { TransactionNote, TokenMetadataRecord } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

/**
 * Movement context for scam detection (token movements only).
 * Contains all information needed to detect scams without fetching metadata.
 */
export interface MovementWithContext {
  contractAddress: string;
  asset: string;
  amount: Decimal;
  isAirdrop: boolean;
  transactionIndex: number;
}

/**
 * Service for detecting scam tokens using pre-fetched metadata.
 * Pure logic service - does NOT fetch metadata, expects it to be provided.
 */
export interface IScamDetectionService {
  /**
   * Detect scams in movements using pre-fetched metadata.
   * Does NOT fetch metadata - expects it to be provided by the caller.
   *
   * @param movements - Movements with context (contract, amount, isAirdrop, txIndex)
   * @param metadataMap - Pre-fetched metadata keyed by contract address (may contain undefined for unfound contracts)
   * @returns Map of transaction index to scam note (first scam found per transaction)
   */
  detectScams(
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>
  ): Map<number, TransactionNote>;
}
