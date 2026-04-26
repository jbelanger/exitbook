import { type CosmosChainConfig, type CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  ok,
  parseCurrency,
  resultDo,
  type Result,
} from '@exitbook/foundation';

import { parseLedgerDecimalAmount } from '../shared/ledger-assembler-utils.js';

import type { CosmosAssetRef } from './journal-assembler-types.js';

export function validateCosmosChainConfig(chainConfig: CosmosChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('Cosmos v2 chain name must not be empty'));
  }

  if (chainConfig.nativeCurrency.trim() === '') {
    return err(new Error(`Cosmos v2 chain ${chainConfig.chainName} native currency must not be empty`));
  }

  if (chainConfig.nativeDenom.trim() === '') {
    return err(new Error(`Cosmos v2 chain ${chainConfig.chainName} native denom must not be empty`));
  }

  if (!Number.isInteger(chainConfig.nativeDecimals) || chainConfig.nativeDecimals < 0) {
    return err(new Error(`Cosmos v2 chain ${chainConfig.chainName} native decimals must be a non-negative integer`));
  }

  return ok(undefined);
}

export function validateCosmosTransactionAmounts(transactions: readonly CosmosTransaction[]): Result<void, Error> {
  return resultDo(function* () {
    for (const transaction of transactions) {
      const amount = yield* parseLedgerDecimalAmount({
        label: 'amount',
        processorLabel: 'Cosmos v2',
        transactionId: transaction.id,
        value: transaction.amount,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Cosmos v2 transaction ${transaction.id} amount must not be negative`));
      }

      const feeAmount = yield* parseLedgerDecimalAmount({
        allowMissing: true,
        label: 'fee',
        processorLabel: 'Cosmos v2',
        transactionId: transaction.id,
        value: transaction.feeAmount,
      });
      if (feeAmount.isNegative()) {
        return yield* err(new Error(`Cosmos v2 transaction ${transaction.id} fee amount must not be negative`));
      }

      const stakingPrincipalAmount = yield* parseLedgerDecimalAmount({
        allowMissing: true,
        label: 'staking principal',
        processorLabel: 'Cosmos v2',
        transactionId: transaction.id,
        value: transaction.stakingPrincipalAmount,
      });
      if (stakingPrincipalAmount.isNegative()) {
        return yield* err(
          new Error(`Cosmos v2 transaction ${transaction.id} staking principal amount must not be negative`)
        );
      }
    }

    return undefined;
  });
}

function isNativeAsset(params: { asset: string; chainConfig: CosmosChainConfig; denom?: string | undefined }): boolean {
  const asset = params.asset.trim().toLowerCase();
  const denom = params.denom?.trim().toLowerCase();
  return asset === params.chainConfig.nativeCurrency.toLowerCase() || denom === params.chainConfig.nativeDenom;
}

export function buildCosmosAssetRef(params: {
  asset: string;
  chainConfig: CosmosChainConfig;
  denom?: string | undefined;
  transactionId: string;
}): Result<CosmosAssetRef, Error> {
  return resultDo(function* () {
    const assetSymbol = yield* parseCurrency(params.asset);

    if (isNativeAsset(params)) {
      return {
        assetId: yield* buildBlockchainNativeAssetId(params.chainConfig.chainName),
        assetSymbol,
      };
    }

    const tokenRef = params.denom?.trim();
    if (!tokenRef) {
      return yield* err(
        new Error(`Cosmos v2 transaction ${params.transactionId} asset ${params.asset} is missing denom identity`)
      );
    }

    return {
      assetId: yield* buildBlockchainTokenAssetId(params.chainConfig.chainName, tokenRef),
      assetSymbol,
    };
  });
}
