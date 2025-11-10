import type { SubstrateChainConfig } from './chain-config.interface.js';

/**
 * Augments transaction objects with chain configuration metadata.
 * This adds native currency, decimals, and display name to each transaction
 * for use in downstream processing.
 *
 * @param transactions - Array of transaction objects to augment
 * @param chainConfig - Substrate chain configuration
 * @returns Array of transactions with added chain metadata fields
 */
export function augmentWithChainConfig<T extends Record<string, unknown>>(
  transactions: T[],
  chainConfig: SubstrateChainConfig
): (T & {
  _chainDisplayName: string;
  _nativeCurrency: string;
  _nativeDecimals: number;
})[] {
  return transactions.map((tx) => ({
    ...tx,
    _nativeCurrency: chainConfig.nativeCurrency,
    _nativeDecimals: chainConfig.nativeDecimals,
    _chainDisplayName: chainConfig.displayName,
  }));
}
