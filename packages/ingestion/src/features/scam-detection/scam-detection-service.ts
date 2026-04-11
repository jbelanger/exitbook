import { type TokenMetadataRecord } from '@exitbook/blockchain-providers';
import type { TransactionDiagnostic } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';

import type { IngestionEvent } from '../../events.js';

import type { IScamDetectionService, MovementWithContext } from './contracts.js';
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
   * Returns a map of transaction index to scam diagnostics.
   * Emits scam.batch.summary event after processing.
   *
   * @param movements - Movements with context (contract, amount, isAirdrop, txIndex)
   * @param metadataMap - Pre-fetched metadata keyed by contract address (may contain undefined for unfound contracts)
   * @param blockchain - Blockchain identifier for event emission
   * @returns Map of transaction index to scam diagnostics
   */
  detectScams(
    movements: MovementWithContext[],
    metadataMap: Map<string, TokenMetadataRecord | undefined>,
    blockchain?: string
  ): Map<number, TransactionDiagnostic[]> {
    this.batchCounter += 1;
    const scamDiagnostics = new Map<number, TransactionDiagnostic[]>();
    const exampleSymbols: string[] = [];
    let totalScamDiagnostics = 0;

    for (const movement of movements) {
      let scamDiagnostic: TransactionDiagnostic | undefined;

      // Tier 1: Metadata-based detection (contract address expected for token movements)
      const metadata = metadataMap.get(movement.contractAddress);
      if (metadata) {
        scamDiagnostic = detectScamToken(movement.contractAddress, metadata, {
          amount: movement.amount,
          isAirdrop: movement.isAirdrop,
        });

        if (scamDiagnostic) {
          scamDiagnostic = {
            ...scamDiagnostic,
            metadata: {
              ...(scamDiagnostic.metadata ?? {}),
              assetSymbol: movement.asset,
              contractAddress: movement.contractAddress.toLowerCase(),
            },
          };
        }

        if (scamDiagnostic) {
          logger.debug(
            {
              contractAddress: movement.contractAddress,
              asset: movement.asset,
              detectionSource: scamDiagnostic.metadata?.['detectionSource'],
              indicators: scamDiagnostic.metadata?.['indicators'],
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
      if (!scamDiagnostic) {
        const scamResult = detectScamFromSymbol(movement.asset);
        if (scamResult.isScam) {
          scamDiagnostic = {
            message: `⚠️ Potential scam token (${movement.asset}): ${scamResult.reason}`,
            metadata: {
              assetSymbol: movement.asset,
              contractAddress: movement.contractAddress.toLowerCase(),
              scamReason: scamResult.reason,
              scamAsset: movement.asset,
              detectionSource: 'symbol',
            },
            severity: 'warning' as const,
            code: 'SCAM_TOKEN',
          };

          logger.debug({ asset: movement.asset, reason: scamResult.reason }, 'Scam detected via symbol check');
        }
      }

      // Store the scam diagnostic for this transaction when detection succeeds.
      if (scamDiagnostic) {
        const existing = scamDiagnostics.get(movement.transactionIndex) ?? [];
        existing.push(scamDiagnostic);
        scamDiagnostics.set(movement.transactionIndex, existing);
        totalScamDiagnostics += 1;

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
        scamsFound: totalScamDiagnostics,
        exampleSymbols,
      });
    }

    return scamDiagnostics;
  }
}
