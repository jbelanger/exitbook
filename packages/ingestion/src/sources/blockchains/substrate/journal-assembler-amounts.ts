import { type SubstrateChainConfig, type SubstrateTransaction } from '@exitbook/blockchain-providers/substrate';
import {
  buildBlockchainNativeAssetId,
  err,
  fromBaseUnitsToDecimalString,
  ok,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Result,
} from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { parseLedgerDecimalAmount } from '../shared/ledger-assembler-utils.js';

import type { SubstrateAssetRef } from './journal-assembler-types.js';

export function validateSubstrateChainConfig(chainConfig: SubstrateChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('Substrate v2 chain name must not be empty'));
  }

  if (chainConfig.nativeCurrency.trim() === '') {
    return err(new Error(`Substrate v2 chain ${chainConfig.chainName} native currency must not be empty`));
  }

  if (!Number.isInteger(chainConfig.nativeDecimals) || chainConfig.nativeDecimals < 0) {
    return err(new Error(`Substrate v2 chain ${chainConfig.chainName} native decimals must be a non-negative integer`));
  }

  return ok(undefined);
}

export function validateSubstrateTransactionAmounts(
  transactions: readonly SubstrateTransaction[],
  chainConfig: SubstrateChainConfig
): Result<void, Error> {
  return resultDo(function* () {
    for (const transaction of transactions) {
      const amount = yield* parseLedgerDecimalAmount({
        label: 'amount',
        processorLabel: 'Substrate v2',
        transactionId: transaction.id,
        value: transaction.amount,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Substrate v2 transaction ${transaction.id} amount must not be negative`));
      }

      const feeAmount = yield* parseLedgerDecimalAmount({
        allowMissing: true,
        label: 'fee',
        processorLabel: 'Substrate v2',
        transactionId: transaction.id,
        value: transaction.feeAmount,
      });
      if (feeAmount.isNegative()) {
        return yield* err(new Error(`Substrate v2 transaction ${transaction.id} fee amount must not be negative`));
      }

      if (transaction.feeCurrency !== undefined && transaction.feeCurrency !== chainConfig.nativeCurrency) {
        return yield* err(
          new Error(
            `Substrate v2 transaction ${transaction.id} fee currency ${transaction.feeCurrency} does not match chain ${chainConfig.chainName} native currency ${chainConfig.nativeCurrency}`
          )
        );
      }
    }

    return undefined;
  });
}

export function normalizeSubstrateTransactionQuantity(
  transaction: Pick<SubstrateTransaction, 'amount' | 'id'>,
  chainConfig: SubstrateChainConfig
): Result<Decimal, Error> {
  const normalizedAmount = fromBaseUnitsToDecimalString(transaction.amount, chainConfig.nativeDecimals);
  if (normalizedAmount.isErr()) {
    return err(
      new Error(
        `Substrate v2 transaction ${transaction.id} amount normalization failed: ${normalizedAmount.error.message}`
      )
    );
  }

  return ok(parseDecimal(normalizedAmount.value));
}

export function normalizeSubstrateFeeQuantity(
  transaction: Pick<SubstrateTransaction, 'feeAmount' | 'id'>,
  chainConfig: SubstrateChainConfig
): Result<Decimal, Error> {
  const normalizedAmount = fromBaseUnitsToDecimalString(transaction.feeAmount, chainConfig.nativeDecimals);
  if (normalizedAmount.isErr()) {
    return err(
      new Error(
        `Substrate v2 transaction ${transaction.id} fee normalization failed: ${normalizedAmount.error.message}`
      )
    );
  }

  return ok(parseDecimal(normalizedAmount.value));
}

export function buildSubstrateNativeAssetRef(params: {
  asset: string;
  chainConfig: SubstrateChainConfig;
  transactionId: string;
}): Result<SubstrateAssetRef, Error> {
  return resultDo(function* () {
    const assetSymbol = yield* parseCurrency(params.asset);
    if (assetSymbol !== params.chainConfig.nativeCurrency) {
      return yield* err(
        new Error(
          `Substrate v2 transaction ${params.transactionId} asset ${params.asset} is not the native asset ${params.chainConfig.nativeCurrency}. ` +
            'Substrate ledger-v2 currently requires provider token identity before materializing non-native assets.'
        )
      );
    }

    return {
      assetId: yield* buildBlockchainNativeAssetId(params.chainConfig.chainName),
      assetSymbol,
    };
  });
}
