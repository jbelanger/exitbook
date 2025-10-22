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
 * For blockchains, this fetches the native asset balance.
 *
 * The currency symbol is returned by the provider based on the blockchain's
 * native currency configuration.
 */
export async function fetchBlockchainBalance(
  providerManager: BlockchainProviderManager,
  blockchain: string,
  address: string
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    // Execute the balance fetch operation using the provider manager
    const result = await providerManager.executeWithFailover<BlockchainBalanceSnapshot>(blockchain, {
      type: 'getAddressBalances',
      address,
    });

    if (result.isErr()) {
      return err(result.error);
    }

    const { data } = result.value;

    // Use the currency from the provider's response
    const balances: Record<string, string> = {
      [data.asset]: data.total,
    };

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
  derivedAddresses: string[]
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
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
