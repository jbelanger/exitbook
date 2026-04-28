import { type IBlockchainProviderRuntime, type RawBalanceData } from '@exitbook/blockchain-providers';
import type { PlatformKind } from '@exitbook/core';
import type { IExchangeClient } from '@exitbook/exchange-providers';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  buildExchangeAssetId,
  parseDecimal,
  wrapError,
} from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { AccountingBalanceCategory } from '@exitbook/ledger';
import { getLogger } from '@exitbook/logger';

import type { ReferenceBalanceAssetScreeningPolicy } from '../../asset-screening/index.js';

import type { BalancePartialFailure } from './reference-balance-verification.js';

const logger = getLogger('reference-balance-fetching');

export interface BalanceCoverageStats {
  failedAddressCount?: number | undefined;
  parsedAssetCount?: number | undefined;
  requestedAddressCount?: number | undefined;
  successfulAddressCount?: number | undefined;
  totalAssetCount?: number | undefined;
  failedAssetCount?: number | undefined;
}

export interface UnifiedBalanceRow {
  amount: string;
  assetId: string;
  assetSymbol: string;
  balanceCategory: AccountingBalanceCategory;
  refs?: readonly string[] | undefined;
}

/**
 * Unified balance snapshot format for both exchanges and blockchains
 */
export interface UnifiedBalanceSnapshot {
  balanceRows: UnifiedBalanceRow[];
  /** @deprecated Use balanceRows. Retained for older presentation and tests during migration. */
  balances: Record<string, string>;
  /** @deprecated Use balanceRows.assetSymbol. */
  assetMetadata: Record<string, string>;
  timestamp: number;
  platformKind: PlatformKind;
  platformKey: string;
  coverage?: BalanceCoverageStats | undefined;
  partialFailures?: BalancePartialFailure[] | undefined;
}

export interface FetchBlockchainBalanceOptions {
  assetScreeningPolicy?: ReferenceBalanceAssetScreeningPolicy | undefined;
  providerName?: string | undefined;
}

function buildUnifiedBalanceRowKey(row: Pick<UnifiedBalanceRow, 'assetId' | 'balanceCategory'>): string {
  return `${row.assetId}\u0000${row.balanceCategory}`;
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

    const balances: Record<string, string> = {};
    const assetMetadata: Record<string, string> = {};
    const balanceRows: UnifiedBalanceRow[] = [];
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
      assetMetadata[assetId] = currencyCode;
      balanceRows.push({
        amount,
        assetId,
        assetSymbol: currencyCode,
        balanceCategory: 'liquid',
      });
    }

    return ok({
      balanceRows,
      balances,
      assetMetadata,
      timestamp,
      platformKind: 'exchange',
      platformKey: exchangeId,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch exchange balance for ${exchangeId}`);
  }
}

/**
 * Fetch balance from a blockchain using the provider runtime.
 * Fetches both native asset balance and token balances if the provider supports it.
 */
export async function fetchBlockchainBalance(
  providerRuntime: IBlockchainProviderRuntime,
  blockchain: string,
  address: string,
  options: FetchBlockchainBalanceOptions = {}
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    const { assetScreeningPolicy, providerName } = options;
    providerRuntime.getProviders(blockchain, { preferredProvider: providerName });

    const balances: Record<string, string> = {};
    const balanceRows: UnifiedBalanceRow[] = [];

    // 1. Fetch native asset balance
    const nativeResult = await providerRuntime.getAddressBalances(blockchain, address, {
      preferredProvider: providerName,
    });

    if (nativeResult.isErr()) {
      return err(nativeResult.error);
    }

    const enrichedNativeResult = await enrichBalanceData(nativeResult.value.data, blockchain, providerRuntime);
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
    balanceRows.push({
      amount: nativeAmount,
      assetId: nativeAssetId,
      assetSymbol: nativeSymbol,
      balanceCategory: enrichedNativeResult.value.balanceCategory ?? 'liquid',
      ...(enrichedNativeResult.value.accountAddress
        ? { refs: [`provider-account:${enrichedNativeResult.value.accountAddress}`] }
        : {}),
    });

    // 2. Check if any provider supports token balances
    const providers = providerRuntime.getProviders(blockchain, { preferredProvider: providerName });
    const supportsTokenBalances = providers.some((provider) =>
      provider.capabilities.supportedOperations.includes('getAddressTokenBalances')
    );

    // 3. Fetch token balances if supported
    if (supportsTokenBalances) {
      const tokenContractAllowlist = assetScreeningPolicy?.getTokenContractAllowlist(blockchain);
      if (tokenContractAllowlist !== undefined && tokenContractAllowlist.length === 0) {
        logger.debug(
          { address, blockchain },
          'Skipping token balance fetch because asset screening has no tracked token references'
        );
      } else {
        const tokenResult = await providerRuntime.getAddressTokenBalances(blockchain, address, {
          preferredProvider: providerName,
          ...(tokenContractAllowlist !== undefined && { contractAddresses: [...tokenContractAllowlist] }),
        });

        if (tokenResult.isErr()) {
          return err(
            new Error(
              `Failed to fetch token balances for ${blockchain}:${address}. Native balance: ${nativeAmount} ${nativeSymbol}. Error: ${tokenResult.error.message}`
            )
          );
        }

        const { data: tokenBalances } = tokenResult.value;
        for (const tokenBalance of tokenBalances) {
          const tokenAssetResult = buildScreenableTokenAssetId(blockchain, tokenBalance);
          if (tokenAssetResult.isErr()) {
            logger.warn(
              { blockchain, error: tokenAssetResult.error, symbol: tokenBalance.symbol, tokenBalance },
              'Skipping token balance with invalid token identity'
            );
            continue;
          }

          const assetId = tokenAssetResult.value;
          const screeningDecision = assetScreeningPolicy?.screenReferenceAsset(assetId);
          if (screeningDecision?.action === 'suppress') {
            logger.debug(
              {
                assetId,
                blockchain,
                reason: screeningDecision.reason,
              },
              'Screened token balance before metadata enrichment'
            );
            continue;
          }

          const enrichedResult = await enrichBalanceData(tokenBalance, blockchain, providerRuntime);
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

          const { amount, assetSymbol } = balanceResult.value;
          const balanceCategory = enrichedResult.value.balanceCategory ?? 'liquid';
          if (balanceCategory === 'liquid') {
            balances[assetId] = amount;
          }
          assetMetadata[assetId] = assetSymbol;
          balanceRows.push({
            amount,
            assetId,
            assetSymbol,
            balanceCategory,
            ...(enrichedResult.value.accountAddress
              ? { refs: [`provider-account:${enrichedResult.value.accountAddress}`] }
              : {}),
          });
        }
      }
    }

    const stakingRowsResult = await fetchOptionalBlockchainStakingBalanceRows({
      address,
      assetScreeningPolicy,
      blockchain,
      providerName,
      providerRuntime,
    });
    if (stakingRowsResult.isErr()) {
      return err(stakingRowsResult.error);
    }
    for (const stakingRow of stakingRowsResult.value) {
      balanceRows.push(stakingRow);
      assetMetadata[stakingRow.assetId] = stakingRow.assetSymbol;
    }

    return ok({
      balanceRows,
      balances,
      assetMetadata,
      timestamp: Date.now(),
      platformKind: 'blockchain',
      platformKey: `${blockchain}:${address}`,
      coverage: {
        failedAddressCount: 0,
        requestedAddressCount: 1,
        successfulAddressCount: 1,
      },
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch blockchain balance for ${blockchain}:${address}`);
  }
}

/**
 * Fetch balance from multiple child accounts (for xpub/extended public keys).
 * Fetches balance for each child account's address and sums them up.
 */
export async function fetchChildAccountsBalance(
  providerRuntime: IBlockchainProviderRuntime,
  blockchain: string,
  parentAddress: string,
  childAccounts: { identifier: string }[],
  options: FetchBlockchainBalanceOptions = {}
): Promise<Result<UnifiedBalanceSnapshot, Error>> {
  try {
    const { providerName } = options;
    if (childAccounts.length === 0) {
      return err(new Error('No child accounts provided for balance aggregation'));
    }

    providerRuntime.getProviders(blockchain, { preferredProvider: providerName });

    const aggregatedBalances: Record<string, ReturnType<typeof parseDecimal>> = {};
    const aggregatedMetadata: Record<string, string> = {};
    const aggregatedRows = new Map<string, UnifiedBalanceRow & { decimalAmount: ReturnType<typeof parseDecimal> }>();
    const partialFailures: BalancePartialFailure[] = [];
    let successfulAddressCount = 0;

    for (const childAccount of childAccounts) {
      const address = childAccount.identifier;
      const balanceResult = await fetchBlockchainBalance(providerRuntime, blockchain, address, options);

      if (balanceResult.isErr()) {
        const message = `Failed to fetch child account balance for ${blockchain}:${address}: ${balanceResult.error.message}`;
        logger.warn(
          { address, blockchain, error: balanceResult.error, parentAddress },
          'Failed to fetch child account balance; continuing with partial coverage'
        );
        partialFailures.push({
          code: 'child-account-fetch-failed',
          message,
          scope: 'address',
          accountAddress: address,
        });
        continue;
      }
      successfulAddressCount++;

      for (const [assetId, amount] of Object.entries(balanceResult.value.balances)) {
        const current = aggregatedBalances[assetId] || parseDecimal('0');
        aggregatedBalances[assetId] = current.plus(parseDecimal(amount));
      }
      Object.assign(aggregatedMetadata, balanceResult.value.assetMetadata);

      for (const row of balanceResult.value.balanceRows) {
        const rowKey = buildUnifiedBalanceRowKey(row);
        const current = aggregatedRows.get(rowKey);
        const nextAmount = (current?.decimalAmount ?? parseDecimal('0')).plus(parseDecimal(row.amount));
        aggregatedRows.set(rowKey, {
          ...row,
          decimalAmount: nextAmount,
          refs: [...(current?.refs ?? []), ...(row.refs ?? [])],
        });
      }
    }

    if (Object.keys(aggregatedBalances).length === 0) {
      return err(new Error(`Failed to fetch balances for any child accounts of ${parentAddress}`));
    }

    const balances = Object.fromEntries(
      Object.entries(aggregatedBalances).map(([assetId, value]) => [assetId, value.toFixed()])
    );
    const balanceRows = [...aggregatedRows.values()].map(({ decimalAmount, ...row }) => ({
      ...row,
      amount: decimalAmount.toFixed(),
    }));

    return ok({
      balanceRows,
      balances,
      assetMetadata: aggregatedMetadata,
      timestamp: Date.now(),
      platformKind: 'blockchain',
      platformKey: `${blockchain}:${parentAddress}`,
      coverage: {
        failedAddressCount: partialFailures.length,
        requestedAddressCount: childAccounts.length,
        successfulAddressCount,
      },
      partialFailures: partialFailures.length > 0 ? partialFailures : undefined,
    });
  } catch (error) {
    return wrapError(error, `Failed to fetch ${blockchain} parent account balance for ${parentAddress}`);
  }
}

/**
 * Enrich RawBalanceData with missing fields by fetching token metadata from cache or provider.
 */
function buildScreenableTokenAssetId(blockchain: string, balance: RawBalanceData): Result<string, Error> {
  if (!balance.contractAddress) {
    return err(new Error('Token balance is missing contractAddress'));
  }

  return buildBlockchainTokenAssetId(blockchain, balance.contractAddress);
}

async function fetchOptionalBlockchainStakingBalanceRows(params: {
  address: string;
  assetScreeningPolicy: ReferenceBalanceAssetScreeningPolicy | undefined;
  blockchain: string;
  providerName: string | undefined;
  providerRuntime: IBlockchainProviderRuntime;
}): Promise<Result<UnifiedBalanceRow[], Error>> {
  if (!params.providerRuntime.hasRegisteredOperationSupport(params.blockchain, 'getAddressStakingBalances')) {
    return ok([]);
  }

  const providers = params.providerRuntime.getProviders(params.blockchain, { preferredProvider: params.providerName });
  const supportsStakingBalances = providers.some((provider) =>
    provider.capabilities.supportedOperations.includes('getAddressStakingBalances')
  );
  if (!supportsStakingBalances) {
    return ok([]);
  }

  const stakingResult = await params.providerRuntime.getAddressStakingBalances(params.blockchain, params.address, {
    preferredProvider: params.providerName,
  });
  if (stakingResult.isErr()) {
    return err(
      new Error(
        `Failed to fetch staking balances for ${params.blockchain}:${params.address}: ${stakingResult.error.message}`
      )
    );
  }

  const rows: UnifiedBalanceRow[] = [];
  for (const stakingBalance of stakingResult.value.data) {
    if (stakingBalance.balanceCategory === undefined) {
      return err(
        new Error(
          `Staking balance provider returned a row without balanceCategory for ${params.blockchain}:${params.address}`
        )
      );
    }

    const balanceResult = convertRawBalance(stakingBalance, params.blockchain);
    if (balanceResult.isErr()) {
      return err(balanceResult.error);
    }

    const screeningDecision = params.assetScreeningPolicy?.screenReferenceAsset(balanceResult.value.assetId);
    if (screeningDecision?.action === 'suppress') {
      logger.debug(
        {
          assetId: balanceResult.value.assetId,
          blockchain: params.blockchain,
          reason: screeningDecision.reason,
        },
        'Screened staking balance before reference comparison'
      );
      continue;
    }

    rows.push({
      amount: balanceResult.value.amount,
      assetId: balanceResult.value.assetId,
      assetSymbol: balanceResult.value.assetSymbol,
      balanceCategory: stakingBalance.balanceCategory,
      ...(stakingBalance.accountAddress ? { refs: [`provider-account:${stakingBalance.accountAddress}`] } : {}),
    });
  }

  return ok(rows);
}

async function enrichBalanceData(
  balance: RawBalanceData,
  blockchain: string,
  providerRuntime: IBlockchainProviderRuntime
): Promise<Result<RawBalanceData, Error>> {
  if (balance.symbol && balance.decimals !== undefined) {
    return ok(balance);
  }

  if (!balance.contractAddress) {
    return ok(balance);
  }

  try {
    const metadataResult = await providerRuntime.getTokenMetadata(blockchain, [balance.contractAddress]);

    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    const metadata = metadataResult.value.get(balance.contractAddress);

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
 */
function convertRawBalance(
  balance: RawBalanceData,
  blockchain: string
): Result<{ amount: string; assetId: string; assetSymbol: string }, Error> {
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

  let assetIdResult: Result<string, Error>;

  if (balance.contractAddress) {
    assetIdResult = buildBlockchainTokenAssetId(blockchain, balance.contractAddress);
  } else {
    assetIdResult = buildBlockchainNativeAssetId(blockchain);
  }

  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  const assetSymbol = balance.symbol ?? 'UNKNOWN';

  return ok({ amount, assetId: assetIdResult.value, assetSymbol });
}
