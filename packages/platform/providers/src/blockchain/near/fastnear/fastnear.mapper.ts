import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { convertYoctoNearToNear } from '../balance-utils.js';

import {
  FastNearAccountFullResponseSchema,
  type FastNearAccountFullResponse,
  type FastNearFungibleToken,
  type FastNearNft,
  type FastNearStakingPool,
} from './fastnear.schemas.js';

/**
 * Normalized NEAR account balances structure
 * Includes native NEAR balance, fungible tokens, NFTs, and staking pools
 */
export interface NearAccountBalances {
  /**
   * Native NEAR balance in yoctoNEAR (smallest unit)
   */
  nativeBalance?:
    | {
        decimalAmount: string;
        rawAmount: string;
      }
    | undefined;

  /**
   * Fungible tokens held by the account
   */
  fungibleTokens: {
    balance: string;
    contractId: string;
    lastUpdateBlockHeight: number;
  }[];

  /**
   * NFT contracts where the account holds tokens
   */
  nftContracts: {
    contractId: string;
    lastUpdateBlockHeight: number;
  }[];

  /**
   * Staking pools where the account has delegated
   */
  stakingPools: {
    lastUpdateBlockHeight: number;
    poolId: string;
  }[];
}

/**
 * Map FastNear fungible tokens to normalized format
 */
export function mapFungibleTokens(tokens: FastNearFungibleToken[] | null): {
  balance: string;
  contractId: string;
  lastUpdateBlockHeight: number;
}[] {
  if (!tokens || tokens.length === 0) {
    return [];
  }

  return tokens.map((token) => ({
    balance: token.balance,
    contractId: token.contract_id,
    lastUpdateBlockHeight: token.last_update_block_height,
  }));
}

/**
 * Map FastNear NFT contracts to normalized format
 */
export function mapNftContracts(nfts: FastNearNft[] | null): {
  contractId: string;
  lastUpdateBlockHeight: number;
}[] {
  if (!nfts || nfts.length === 0) {
    return [];
  }

  return nfts.map((nft) => ({
    contractId: nft.contract_id,
    lastUpdateBlockHeight: nft.last_update_block_height,
  }));
}

/**
 * Map FastNear staking pools to normalized format
 */
export function mapStakingPools(pools: FastNearStakingPool[] | null): {
  lastUpdateBlockHeight: number;
  poolId: string;
}[] {
  if (!pools || pools.length === 0) {
    return [];
  }

  return pools.map((pool) => ({
    lastUpdateBlockHeight: pool.last_update_block_height,
    poolId: pool.pool_id,
  }));
}

/**
 * Extract native NEAR balance from account state
 */
export function extractNativeBalance(accountState: { amount?: string | undefined } | null):
  | {
      decimalAmount: string;
      rawAmount: string;
    }
  | undefined {
  if (!accountState?.amount) {
    return undefined;
  }

  const rawAmount = parseDecimal(accountState.amount).toFixed();
  const decimalAmount = convertYoctoNearToNear(rawAmount);

  return {
    decimalAmount,
    rawAmount,
  };
}

/**
 * Map FastNear account full response to normalized balance structure
 */
export function mapFastNearAccountData(
  rawData: FastNearAccountFullResponse
): Result<NearAccountBalances, NormalizationError> {
  // Validate input data
  const inputValidationResult = FastNearAccountFullResponseSchema.safeParse(rawData);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid FastNear account data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedData = inputValidationResult.data;

  // Extract and transform all data
  const nativeBalance = extractNativeBalance(validatedData.account);
  const fungibleTokens = mapFungibleTokens(validatedData.ft);
  const nftContracts = mapNftContracts(validatedData.nft);
  const stakingPools = mapStakingPools(validatedData.staking);

  const normalized: NearAccountBalances = {
    fungibleTokens,
    nativeBalance,
    nftContracts,
    stakingPools,
  };

  return ok(normalized);
}
