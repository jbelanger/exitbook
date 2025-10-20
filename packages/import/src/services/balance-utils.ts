import type { BlockchainBalanceSnapshot } from '@exitbook/core';
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
  sourceType: 'exchange' | 'blockchain';
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
