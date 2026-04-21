import { type TokenMetadataRecord } from '@exitbook/blockchain-providers';
import type { TransactionDiagnostic } from '@exitbook/core';
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

export type ScamDetectionResult = Map<number, TransactionDiagnostic[]>;

/**
 * Pure classification contract for scam detection.
 * Metadata fetching and event emission stay outside this boundary.
 */
export type ScamDetector = (
  movements: MovementWithContext[],
  metadataMap: ReadonlyMap<string, TokenMetadataRecord | undefined>
) => ScamDetectionResult;
