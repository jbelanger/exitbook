import { type TokenMetadataRecord } from '@exitbook/blockchain-providers';
import type { TransactionDiagnostic } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { MovementWithContext, ScamDetectionResult } from './contracts.js';
import { detectScamFromSymbol, detectScamToken } from './scam-detection-utils.js';

const logger = getLogger('ScamDetectionService');

/**
 * Service for detecting scam tokens using pre-fetched metadata.
 * Pure logic service - does NOT fetch metadata, expects it to be provided.
 */
export class ScamDetectionService {
  /**
   * Detect scams in movements using pre-fetched metadata.
   * Returns a map of transaction index to scam diagnostics.
   *
   * @param movements - Movements with context (contract, amount, isAirdrop, txIndex)
   * @param metadataMap - Pre-fetched metadata keyed by contract address (may contain undefined for unfound contracts)
   * @returns Map of transaction index to scam diagnostics
   */
  detectScams(
    movements: MovementWithContext[],
    metadataMap: ReadonlyMap<string, TokenMetadataRecord | undefined>
  ): ScamDetectionResult {
    const scamDiagnostics = new Map<number, TransactionDiagnostic[]>();

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
      }
    }

    return scamDiagnostics;
  }
}
