import type { SourceType } from '@exitbook/core';
import { parseDecimal, wrapError } from '@exitbook/core';
import type { TokenMetadataRepository } from '@exitbook/data';
import type { IExchangeClient } from '@exitbook/exchanges';
import type { BlockchainProviderManager, RawBalanceData } from '@exitbook/providers';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getOrFetchTokenMetadata } from '../token-metadata/token-metadata-utils.ts';

/**
 * Unified balance snapshot format for both exchanges and blockchains
 */
export interface UnifiedBalanceSnapshot {
  /** Balances as currency/asset -> amount mapping */
  balances: Record<string, string>;
  /** Timestamp when balance was fetched */
  timestamp: number;
  /** Source type */
  sourceType: SourceType;
  /** Source identifier (exchange name or blockchain + address) */
  sourceId: string;
}

/**
 * Fetch balance from an exchange using its client.
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

    const { balances, timestamp } = result.value;

    return ok({
      balances,
      timestamp,
      sourceType: 'exchange',
      sourceId: exchangeId,
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
  tokenMetadataRepository: TokenMetadataRepository,
  blockchain: string,
  address: string,
  providerId?: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    // Auto-register providers for this blockchain with optional provider preference
    const existingProviders = providerManager.getProviders(blockchain);
    if (!existingProviders || existingProviders.length === 0) {
      providerManager.autoRegisterFromConfig(blockchain, providerId);
    }

    const balances: Record<string, string> = {};

    // 1. Fetch native asset balance
    const nativeResult = await providerManager.executeWithFailover<RawBalanceData>(blockchain, {
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
    const { amount: nativeAmount, currency: nativeCurrency } = convertRawBalance(enrichedNativeResult.value);
    balances[nativeCurrency] = nativeAmount;

    // 2. Check if any provider supports token balances
    const providers = providerManager.getProviders(blockchain);
    const supportsTokenBalances = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressTokenBalances')
    );

    // 3. Fetch token balances if supported
    if (supportsTokenBalances) {
      const tokenResult = await providerManager.executeWithFailover<RawBalanceData[]>(blockchain, {
        type: 'getAddressTokenBalances',
        address,
      });

      if (tokenResult.isErr()) {
        return err(
          new Error(
            `Failed to fetch token balances for ${blockchain}:${address}. Native balance: ${nativeAmount} ${nativeCurrency}. Error: ${tokenResult.error.message}`
          )
        );
      }

      // Enrich and convert each token balance
      const { data: tokenBalances } = tokenResult.value;
      for (const tokenBalance of tokenBalances) {
        const enrichedResult = await enrichBalanceData(
          tokenBalance,
          blockchain,
          tokenMetadataRepository,
          providerManager
        );
        if (enrichedResult.isErr()) {
          return err(enrichedResult.error);
        }
        const { amount, currency } = convertRawBalance(enrichedResult.value);
        balances[currency] = amount;
      }
    }

    return ok({
      balances,
      timestamp: Date.now(),
      sourceType: 'blockchain',
      sourceId: `${blockchain}:${address}`,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch blockchain balance for ${blockchain}:${address}`);
  }
}

/**
 * Fetch balance from multiple Bitcoin addresses (for xpub derived addresses).
 * Fetches balance for each address and sums them up.
 */
export async function fetchBitcoinXpubBalance(
  providerManager: BlockchainProviderManager,
  tokenMetadataRepository: TokenMetadataRepository,
  xpubAddress: string,
  derivedAddresses: string[],
  providerId?: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    // Auto-register providers for bitcoin with optional provider preference
    const existingProviders = providerManager.getProviders('bitcoin');
    if (!existingProviders || existingProviders.length === 0) {
      providerManager.autoRegisterFromConfig('bitcoin', providerId);
    }

    // Fetch balance for each derived address
    const balanceResults = await Promise.all(
      derivedAddresses.map((address) =>
        providerManager.executeWithFailover<RawBalanceData>('bitcoin', {
          type: 'getAddressBalances',
          address,
        })
      )
    );

    // Sum up all balances
    let totalBalance = parseDecimal('0');
    let currency = 'BTC'; // Default to BTC

    for (const result of balanceResults) {
      if (result.isErr()) {
        // Log error but continue with other addresses
        continue;
      }

      const { data } = result.value;
      const enrichedResult = await enrichBalanceData(data, 'bitcoin', tokenMetadataRepository, providerManager);
      if (enrichedResult.isErr()) {
        // Log error but continue with other addresses
        continue;
      }
      const { amount, currency: assetCurrency } = convertRawBalance(enrichedResult.value);
      currency = assetCurrency; // Use the currency from provider response
      totalBalance = totalBalance.plus(parseDecimal(amount));
    }

    return ok({
      balances: {
        [currency]: totalBalance.toFixed(),
      },
      timestamp: Date.now(),
      sourceType: 'blockchain',
      sourceId: `bitcoin:${xpubAddress}`,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch Bitcoin xpub balance for ${xpubAddress}`);
  }
}

/**
 * Convert balances from Record<string, string> to Record<string, Decimal>.
 * Pure function with no side effects.
 */
export function convertBalancesToDecimals(balances: Record<string, string>): Record<string, Decimal> {
  const decimalBalances: Record<string, Decimal> = {};

  for (const [currency, amount] of Object.entries(balances)) {
    try {
      decimalBalances[currency] = parseDecimal(amount);
    } catch {
      // Default to zero on parse failure
      decimalBalances[currency] = parseDecimal('0');
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
  tokenMetadataRepository: TokenMetadataRepository,
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
 * Convert RawBalanceData to amount string and currency identifier.
 * Handles conversion from rawAmount (smallest units) to decimal when decimals are available.
 */
function convertRawBalance(balance: RawBalanceData): { amount: string; currency: string } {
  // Determine amount
  let amount: string;
  if (balance.decimalAmount !== undefined) {
    amount = balance.decimalAmount;
  } else if (balance.rawAmount !== undefined && balance.decimals !== undefined) {
    try {
      amount = parseDecimal(balance.rawAmount).div(parseDecimal('10').pow(balance.decimals)).toFixed();
    } catch {
      amount = balance.rawAmount;
    }
  } else {
    amount = balance.rawAmount ?? '0';
  }

  // Determine currency identifier (prefer symbol, fallback to contract address)
  const currency = balance.symbol ?? balance.contractAddress ?? 'UNKNOWN';

  return { amount, currency };
}
