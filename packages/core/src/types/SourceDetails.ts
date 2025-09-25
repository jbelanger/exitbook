/**
 * Source Details for ProcessedTransaction
 *
 * Discriminated union tracking the origin of transaction data.
 * Open union supporting any exchange venue or blockchain chain.
 */

import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import { ProcessingError } from '../errors/index.js';

import type { ExternalId, ImportSessionId } from './primitives.js';

/**
 * Source details discriminated union
 *
 * Tracks where transaction data originated:
 * - Exchange: Trading venue transactions
 * - Blockchain: On-chain transactions
 */
export type SourceDetails =
  | {
      readonly externalId: ExternalId; // Exchange transaction ID
      readonly importSessionId: ImportSessionId; // Import tracking
      readonly kind: 'exchange';
      readonly venue: string;
    }
  | {
      readonly chain: string;
      readonly importSessionId: ImportSessionId; // Import tracking
      readonly kind: 'blockchain';
      readonly txHash: string; // Transaction hash
    };

/**
 * Type guards for source details
 */
export function isExchangeSource(source: SourceDetails): source is Extract<SourceDetails, { kind: 'exchange' }> {
  return source.kind === 'exchange';
}

export function isBlockchainSource(source: SourceDetails): source is Extract<SourceDetails, { kind: 'blockchain' }> {
  return source.kind === 'blockchain';
}

/**
 * Get primary external identifier from source
 */
export function getSourceExternalId(source: SourceDetails): Result<string, ProcessingError> {
  switch (source.kind) {
    case 'exchange':
      return ok(source.externalId);
    case 'blockchain':
      return ok(source.txHash);
    default:
      // This case should not be reachable with proper type checking
      return err(new ProcessingError(`Unknown source kind: ${JSON.stringify(source)}`));
  }
}
