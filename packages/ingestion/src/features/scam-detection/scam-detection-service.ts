import type { TransactionNote, TokenMetadataRecord } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';

import type { IngestionEvent } from '../../events.js';

import type { IScamDetectionService, MovementWithContext } from './scam-detection-service.interface.js';
import { detectScamFromSymbol, detectScamToken } from './scam-detection-utils.js';

const logger = getLogger('ScamDetectionService');

/**
 * Service for detecting scam tokens using pre-fetched metadata.
 * Pure logic service - does NOT fetch metadata, expects it to be provided.
 */
export class ScamDetectionService implements IScamDetectionService {
  private batchCounter = 0;

  constructor(private readonly eventBus: EventBus<IngestionEvent>) {}

  /**
   * Detect scams in movements using pre-fetched metadata.
   * Returns a map of transaction index to scam note (first scam found per transaction).
   * Emits scam.batch.summary event after processing.
   *
   * @param movements - Movements with context (contract, amount, isAirdrop, txIndex)
   * @param metadataMap - Pre-fetched metadata keyed by contract address (may contain undefined for unfound contracts)
   * @param blockchain - Blockchain identifier for event emission
   * @returns Map of transaction index to scam note
   */
  detectScams(
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>,
    blockchain?: string
  ): Map<number, TransactionNote> {
    this.batchCounter += 1;
    const scamNotes = new Map<number, TransactionNote>();
    const exampleSymbols: string[] = [];

    for (const movement of movements) {
      // Skip if we already found a scam for this transaction (early exit per transaction)
      if (scamNotes.has(movement.transactionIndex)) {
        continue;
      }

      let scamNote: TransactionNote | undefined;

      // Tier 1: Metadata-based detection (contract address expected for token movements)
      const metadata = metadataMap.get(movement.contractAddress);
      if (metadata) {
        scamNote = detectScamToken(movement.contractAddress, metadata, {
          amount: movement.amount,
          isAirdrop: movement.isAirdrop,
        });

        if (scamNote) {
          logger.debug(
            {
              contractAddress: movement.contractAddress,
              asset: movement.asset,
              detectionSource: scamNote.metadata?.['detectionSource'],
              indicators: scamNote.metadata?.['indicators'],
            },
            'Scam detected via metadata'
          );
        }
      } else {
        logger.debug(
          { contractAddress: movement.contractAddress, asset: movement.asset },
          'No metadata available for contract address - falling back to symbol detection'
        );
      }

      // Tier 2: Symbol-only detection (fallback when no metadata available)
      if (!scamNote) {
        const scamResult = detectScamFromSymbol(movement.asset);
        if (scamResult.isScam) {
          scamNote = {
            message: `⚠️ Potential scam token (${movement.asset}): ${scamResult.reason}`,
            metadata: {
              scamReason: scamResult.reason,
              scamAsset: movement.asset,
              detectionSource: 'symbol',
            },
            severity: 'warning' as const,
            type: 'SCAM_TOKEN',
          };

          logger.debug({ asset: movement.asset, reason: scamResult.reason }, 'Scam detected via symbol check');
        }
      }

      // Store scam note for this transaction (if found)
      if (scamNote) {
        scamNotes.set(movement.transactionIndex, scamNote);

        // Collect first 3 example symbols
        if (exampleSymbols.length < 3) {
          exampleSymbols.push(movement.asset);
        }
      }
    }

    // Emit batch summary event (per-batch counts, not cumulative)
    if (blockchain) {
      this.eventBus.emit({
        type: 'scam.batch.summary',
        blockchain,
        batchNumber: this.batchCounter,
        totalScanned: movements.length,
        scamsFound: scamNotes.size,
        exampleSymbols,
      });
    }

    return scamNotes;
  }
}
