import type { BlockchainBalanceSnapshot, SourceType } from '@exitbook/core';
import { parseDecimal, wrapError } from '@exitbook/core';
import type { IExchangeClient } from '@exitbook/exchanges';
import type { BlockchainProviderManager } from '@exitbook/providers';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

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
 * The currency symbols are returned by the provider based on the blockchain's
 * configuration and token metadata.
 */
export async function fetchBlockchainBalance(
  providerManager: BlockchainProviderManager,
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
    const nativeResult = await providerManager.executeWithFailover<BlockchainBalanceSnapshot>(blockchain, {
      type: 'getAddressBalances',
      address,
    });

    if (nativeResult.isErr()) {
      return err(nativeResult.error);
    }

    const { data: nativeBalance } = nativeResult.value;
    balances[nativeBalance.asset] = nativeBalance.total;

    // 2. Check if any provider supports token balances
    const providers = providerManager.getProviders(blockchain);
    const supportsTokenBalances = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressTokenBalances')
    );

    // 3. Fetch token balances if supported
    if (supportsTokenBalances) {
      const tokenResult = await providerManager.executeWithFailover<BlockchainBalanceSnapshot[]>(blockchain, {
        type: 'getAddressTokenBalances',
        address,
      });

      if (tokenResult.isErr()) {
        return err(
          new Error(
            `Failed to fetch token balances for ${blockchain}:${address}. Native balance: ${nativeBalance.total} ${nativeBalance.asset}. Error: ${tokenResult.error.message}`
          )
        );
      }

      const { data: tokenBalances } = tokenResult.value;
      // Add each token balance to the result
      for (const tokenBalance of tokenBalances) {
        balances[tokenBalance.asset] = tokenBalance.total;
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
        providerManager.executeWithFailover<BlockchainBalanceSnapshot>('bitcoin', {
          type: 'getAddressBalances',
          address,
        })
      )
    );

    // Sum up all balances
    let totalBalance = parseDecimal('0');
    let asset = 'BTC'; // Default to BTC

    for (const result of balanceResults) {
      if (result.isErr()) {
        // Log error but continue with other addresses
        continue;
      }

      const { data } = result.value;
      asset = data.asset; // Use the asset from provider response
      totalBalance = totalBalance.plus(parseDecimal(data.total));
    }

    return ok({
      balances: {
        [asset]: totalBalance.toFixed(),
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
