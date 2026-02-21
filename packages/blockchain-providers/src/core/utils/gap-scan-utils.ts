import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { BlockchainProviderManager } from '../manager/provider-manager.js';

const logger = getLogger('GapScanUtils');

/**
 * Configuration for BIP44-compliant gap scanning
 */
export interface GapScanConfig {
  /** The blockchain identifier (e.g., 'bitcoin', 'cardano') */
  blockchain: string;
  /** Pre-derived addresses to scan, in interleaved order */
  derivedAddresses: string[];
  /** Number of consecutive unused addresses before stopping (BIP44 standard) */
  gapLimit: number;
  /** Maximum consecutive API errors before aborting */
  maxErrors?: number | undefined;
}

/**
 * Result of BIP44 gap scanning
 */
export interface GapScanResult {
  /** Trimmed address set: all addresses up to highestUsedIndex + gapLimit */
  addresses: string[];
}

/**
 * Perform BIP44-compliant gap scanning to determine the active derived address set.
 *
 * Scans addresses in order, tracking the highest index with on-chain activity.
 * Stops after `gapLimit` consecutive unused addresses and returns ALL addresses
 * up to highestUsedIndex + gapLimit (ensuring fresh change addresses are tracked).
 *
 * Shared by Bitcoin and Cardano xpub wallet initialization.
 */
export async function performAddressGapScanning(
  config: GapScanConfig,
  providerManager: BlockchainProviderManager
): Promise<Result<GapScanResult, Error>> {
  const { blockchain, derivedAddresses, gapLimit, maxErrors = 3 } = config;

  if (derivedAddresses.length === 0) {
    return ok({ addresses: [] });
  }

  logger.info(`Performing gap scan on ${blockchain} (gap limit: ${gapLimit})`);

  let consecutiveUnusedCount = 0;
  let highestUsedIndex = -1;
  let errorCount = 0;

  for (let i = 0; i < derivedAddresses.length; i++) {
    const address = derivedAddresses[i];
    if (!address) continue;

    const result = await providerManager.executeWithFailoverOnce(blockchain, {
      address,
      getCacheKey: (params) => `${blockchain}:has-txs:${(params as { address: string }).address}`,
      type: 'hasAddressTransactions',
    });

    if (result.isErr()) {
      errorCount++;
      logger.warn(`Could not check activity for address ${address} - Error: ${result.error.message}`);

      if (errorCount >= maxErrors) {
        return err(new Error(`Failed to scan addresses: ${result.error.message}`));
      }

      consecutiveUnusedCount++;
      continue;
    }

    // Reset error count on successful API call
    errorCount = 0;

    const hasActivity = result.value.data;
    if (hasActivity) {
      highestUsedIndex = i;
      consecutiveUnusedCount = 0;
      logger.debug(`Found activity at index ${i}: ${address}`);
    } else {
      consecutiveUnusedCount++;
      logger.debug(`No activity at index ${i}, consecutive unused: ${consecutiveUnusedCount}`);

      if (consecutiveUnusedCount >= gapLimit) {
        logger.info(`Reached gap limit of ${gapLimit} unused addresses, stopping scan at index ${i}`);
        break;
      }
    }
  }

  // Include ALL addresses up to highestUsedIndex + gapLimit
  const targetIndex = highestUsedIndex >= 0 ? highestUsedIndex + gapLimit : gapLimit - 1;
  const lastIndex = Math.min(targetIndex, derivedAddresses.length - 1);
  const addresses = derivedAddresses.slice(0, lastIndex + 1);

  const addressesWithActivity = highestUsedIndex + 1;
  const addressesForFutureUse = addresses.length - addressesWithActivity;

  logger.info(
    `Derived address set: ${addresses.length} addresses ` +
      `(${addressesWithActivity} with activity, ${addressesForFutureUse} for future use)`
  );

  return ok({ addresses });
}
