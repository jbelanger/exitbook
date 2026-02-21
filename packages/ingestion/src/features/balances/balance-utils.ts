import type { BlockchainProviderManager, RawBalanceData } from '@exitbook/blockchain-providers';
import type { SourceType } from '@exitbook/core';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  buildExchangeAssetId,
  parseDecimal,
  wrapError,
} from '@exitbook/core';
import type { TokenMetadataQueries } from '@exitbook/data';
import type { IExchangeClient } from '@exitbook/exchanges-providers';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getOrFetchTokenMetadata } from '../token-metadata/token-metadata-utils.js';

const logger = getLogger('balance-utils');

/**
 * Unified balance snapshot format for both exchanges and blockchains
 */
export interface UnifiedBalanceSnapshot {
  /** Balances as assetId -> amount mapping */
  balances: Record<string, string>;
  /** Asset metadata as assetId -> assetSymbol mapping for display */
  assetMetadata: Record<string, string>;
  /** Timestamp when balance was fetched */
  timestamp: number;
  /** Source type */
  sourceType: SourceType;
  /** Source identifier (exchange name or blockchain + address) */
  sourceName: string;
}

/**
 * Fetch balance from an exchange using its client.
 * Converts currency codes to proper assetIds (exchange:<exchange>:<currencyCode>).
 */
export async function fetchExchangeBalance(
  exchangeClient: IExchangeClient,
  exchangeId: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    const result = await exchangeClient.fetchBalance();

    if (result.isErr()) {
      return err(result.error);
    }

    const { balances: rawBalances, timestamp } = result.value;

    // Convert currency codes to assetIds and build metadata mapping
    const balances: Record<string, string> = {};
    const assetMetadata: Record<string, string> = {};
    for (const [currencyCode, amount] of Object.entries(rawBalances)) {
      const assetIdResult = buildExchangeAssetId(exchangeId, currencyCode);
      if (assetIdResult.isErr()) {
        logger.warn(
          { error: assetIdResult.error, exchangeId, currencyCode },
          'Failed to build assetId for exchange balance, skipping'
        );
        continue;
      }
      const assetId = assetIdResult.value;
      balances[assetId] = amount;
      assetMetadata[assetId] = currencyCode; // Store original currency code as assetSymbol
    }

    return ok({
      balances,
      assetMetadata,
      timestamp,
      sourceType: 'exchange',
      sourceName: exchangeId,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch exchange balance for ${exchangeId}`);
  }
}

/**
 * Fetch balance from a blockchain using the provider manager.
 * Fetches both native asset balance and token balances if the provider supports it.
 *
 * Automatically enriches balance data with token metadata when fields are missing.
 */
export async function fetchBlockchainBalance(
  providerManager: BlockchainProviderManager,
  tokenMetadataRepository: TokenMetadataQueries,
  blockchain: string,
  address: string,
  providerName?: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    // Auto-register providers for this blockchain with optional provider preference
    const existingProviders = providerManager.getProviders(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      providerManager.autoRegisterFromConfig(blockchain, providerName);
    }

    const balances: Record<string, string> = {};

    // 1. Fetch native asset balance
    const nativeResult = await providerManager.executeWithFailoverOnce(blockchain, {
      type: 'getAddressBalances',
      address,
    });

    if (nativeResult.isErr()) {
      return err(nativeResult.error);
    }

    // Enrich and convert native balance
    const enrichedNativeResult = await enrichBalanceData(
      nativeResult.value.data,
      blockchain,
      tokenMetadataRepository,
      providerManager
    );
    if (enrichedNativeResult.isErr()) {
      return err(enrichedNativeResult.error);
    }
    const nativeBalanceResult = convertRawBalance(enrichedNativeResult.value, blockchain);
    if (nativeBalanceResult.isErr()) {
      return err(nativeBalanceResult.error);
    }
    const { amount: nativeAmount, assetId: nativeAssetId, assetSymbol: nativeSymbol } = nativeBalanceResult.value;
    const assetMetadata: Record<string, string> = {};
    balances[nativeAssetId] = nativeAmount;
    assetMetadata[nativeAssetId] = nativeSymbol;

    // 2. Check if any provider supports token balances
    const providers = providerManager.getProviders(blockchain);
    const supportsTokenBalances = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressTokenBalances')
    );

    // 3. Fetch token balances if supported
    if (supportsTokenBalances) {
      const tokenResult = await providerManager.executeWithFailoverOnce(blockchain, {
        type: 'getAddressTokenBalances',
        address,
      });

      if (tokenResult.isErr()) {
        return err(
          new Error(
            `Failed to fetch token balances for ${blockchain}:${address}. Native balance: ${nativeAmount} ${nativeSymbol}. Error: ${tokenResult.error.message}`
          )
        );
      }

      // Enrich and convert each token balance
      const { data: tokenBalances } = tokenResult.value;
      for (const tokenBalance of tokenBalances) {
        // CRITICAL: Token balances MUST have contractAddress to prevent collisions
        // If missing, skip this token entirely rather than misclassifying as native
        if (!tokenBalance.contractAddress) {
          logger.warn(
            { blockchain, symbol: tokenBalance.symbol, tokenBalance },
            'Skipping token balance without contractAddress - provider data quality issue'
          );
          continue;
        }

        const enrichedResult = await enrichBalanceData(
          tokenBalance,
          blockchain,
          tokenMetadataRepository,
          providerManager
        );
        if (enrichedResult.isErr()) {
          logger.warn(
            { error: enrichedResult.error, contractAddress: tokenBalance.contractAddress },
            'Failed to enrich token metadata, skipping this token balance'
          );
          continue;
        }

        const balanceResult = convertRawBalance(enrichedResult.value, blockchain);
        if (balanceResult.isErr()) {
          logger.warn(
            { error: balanceResult.error, contractAddress: tokenBalance.contractAddress },
            'Failed to convert token balance, skipping this token'
          );
          continue;
        }

        const { amount, assetId, assetSymbol } = balanceResult.value;
        balances[assetId] = amount;
        assetMetadata[assetId] = assetSymbol;
      }
    }

    return ok({
      balances,
      assetMetadata,
      timestamp: Date.now(),
      sourceType: 'blockchain',
      sourceName: `${blockchain}:${address}`,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch blockchain balance for ${blockchain}:${address}`);
  }
}

/**
 * Fetch balance from multiple child accounts (for xpub/extended public keys).
 * Fetches balance for each child account's address and sums them up.
 * Works for any blockchain that supports address derivation (Bitcoin, Cardano, etc.).
 */
export async function fetchChildAccountsBalance(
  providerManager: BlockchainProviderManager,
  tokenMetadataRepository: TokenMetadataQueries,
  blockchain: string,
  parentAddress: string,
  childAccounts: { identifier: string }[],
  providerName?: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    if (childAccounts.length === 0) {
      return err(new Error('No child accounts provided for balance aggregation'));
    }

    const existingProviders = providerManager.getProviders(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      providerManager.autoRegisterFromConfig(blockchain, providerName);
    }

    const aggregatedBalances: Record<string, ReturnType<typeof parseDecimal>> = {};
    const aggregatedMetadata: Record<string, string> = {};

    for (const childAccount of childAccounts) {
      const address = childAccount.identifier;
      const balanceResult = await fetchBlockchainBalance(
        providerManager,
        tokenMetadataRepository,
        blockchain,
        address,
        providerName
      );

      if (balanceResult.isErr()) {
        // Skip addresses we fail to fetch but continue aggregating others
        continue;
      }

      for (const [assetId, amount] of Object.entries(balanceResult.value.balances)) {
        const current = aggregatedBalances[assetId] || parseDecimal('0');
        aggregatedBalances[assetId] = current.plus(parseDecimal(amount));
      }
      // Merge asset metadata
      Object.assign(aggregatedMetadata, balanceResult.value.assetMetadata);
    }

    if (Object.keys(aggregatedBalances).length === 0) {
      return err(new Error(`Failed to fetch balances for any child accounts of ${parentAddress}`));
    }

    const balances = Object.fromEntries(
      Object.entries(aggregatedBalances).map(([assetId, value]) => [assetId, value.toFixed()])
    );

    return ok({
      balances,
      assetMetadata: aggregatedMetadata,
      timestamp: Date.now(),
      sourceType: 'blockchain',
      sourceName: `${blockchain}:${parentAddress}`,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch ${blockchain} parent account balance for ${parentAddress}`);
  }
}

/**
 * Convert balances from Record<string, string> to Record<string, Decimal>.
 * Pure function with no side effects.
 */
export function convertBalancesToDecimals(balances: Record<string, string>): Record<string, Decimal> {
  const decimalBalances: Record<string, Decimal> = {};

  for (const [assetId, amount] of Object.entries(balances)) {
    try {
      decimalBalances[assetId] = parseDecimal(amount);
    } catch (error) {
      logger.warn({ error, assetId, amount }, 'Failed to parse balance amount, defaulting to zero');
      decimalBalances[assetId] = parseDecimal('0');
    }
  }

  return decimalBalances;
}

/**
 * Enrich RawBalanceData with missing fields by fetching token metadata from cache or provider.
 * Returns enriched balance data with all available fields filled in.
 * Uses cache-aside pattern with stale-while-revalidate for optimal performance.
 */
async function enrichBalanceData(
  balance: RawBalanceData,
  blockchain: string,
  tokenMetadataRepository: TokenMetadataQueries,
  providerManager: BlockchainProviderManager
): Promise<Result<RawBalanceData, Error>> {
  // If we have all required fields (symbol and decimals), no need to enrich
  if (balance.symbol && balance.decimals !== undefined) {
    return ok(balance);
  }

  // Only enrich if we have a contract address to look up
  if (!balance.contractAddress) {
    return ok(balance);
  }

  // Use getOrFetchTokenMetadata which implements cache-aside pattern
  try {
    const metadataResult = await getOrFetchTokenMetadata(
      blockchain,
      balance.contractAddress,
      tokenMetadataRepository,
      providerManager
    );

    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    const metadata = metadataResult.value;

    // If no metadata found (provider doesn't support it), return as-is
    if (!metadata) {
      return ok(balance);
    }

    return ok({
      ...balance,
      symbol: balance.symbol ?? metadata.symbol,
      decimals: balance.decimals ?? metadata.decimals,
    });
  } catch (error) {
    return wrapError(error, `Failed to enrich token metadata for ${balance.contractAddress}`);
  }
}

/**
 * Convert RawBalanceData to amount string, assetId, and assetSymbol.
 * Handles conversion from rawAmount (smallest units) to decimal when decimals are available.
 * Builds proper assetId using Asset Identity Specification format.
 *
 * IMPORTANT: This function should only be called from token balance paths when contractAddress is present.
 * For native balance paths, contractAddress should be undefined/null.
 */
function convertRawBalance(
  balance: RawBalanceData,
  blockchain: string
): Result<{ amount: string; assetId: string; assetSymbol: string }, Error> {
  // Determine amount
  let amount: string;
  if (balance.decimalAmount !== undefined) {
    amount = balance.decimalAmount;
  } else if (balance.rawAmount !== undefined && balance.decimals !== undefined) {
    try {
      amount = parseDecimal(balance.rawAmount).div(parseDecimal('10').pow(balance.decimals)).toFixed();
    } catch (error) {
      logger.warn(
        { error, rawAmount: balance.rawAmount, decimals: balance.decimals, contractAddress: balance.contractAddress },
        'Failed to normalize balance from raw amount, using raw value'
      );
      amount = balance.rawAmount;
    }
  } else {
    amount = balance.rawAmount ?? '0';
  }

  // Build assetId using Asset Identity Specification
  let assetIdResult: Result<string, Error>;

  if (balance.contractAddress) {
    // Token asset: blockchain:<chain>:<contractAddress>
    assetIdResult = buildBlockchainTokenAssetId(blockchain, balance.contractAddress);
  } else {
    // Native asset: blockchain:<chain>:native
    // Note: Token balances without contractAddress should be filtered out by caller
    // to prevent collisions. This path should only be used for native balance fetches.
    assetIdResult = buildBlockchainNativeAssetId(blockchain);
  }

  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  // Determine assetSymbol for display (prefer symbol, fallback to 'UNKNOWN')
  const assetSymbol = balance.symbol ?? 'UNKNOWN';

  return ok({ amount, assetId: assetIdResult.value, assetSymbol });
}
