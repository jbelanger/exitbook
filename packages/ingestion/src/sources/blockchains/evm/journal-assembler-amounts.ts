import { type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
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

import type {
  AccountBasedLedgerChainConfig,
  AccountBasedLedgerNativeAssetConfig,
  EvmAssetRef,
} from './journal-assembler-types.js';
import type { EvmMovement } from './types.js';

function findNativeAssetBySymbol(
  chainConfig: AccountBasedLedgerChainConfig,
  symbol: string
): AccountBasedLedgerNativeAssetConfig | undefined {
  return chainConfig.nativeAssets?.find((asset) => asset.symbol.trim().toLowerCase() === symbol.trim().toLowerCase());
}

function isGasNativeSymbol(chainConfig: AccountBasedLedgerChainConfig, symbol: string): boolean {
  return symbol.trim().toLowerCase() === chainConfig.nativeCurrency.trim().toLowerCase();
}

export function validateEvmChainConfig(chainConfig: AccountBasedLedgerChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('EVM v2 chain name must not be empty'));
  }

  if (!Number.isInteger(chainConfig.nativeDecimals) || chainConfig.nativeDecimals < 0) {
    return err(new Error(`EVM v2 native decimals must be a non-negative integer, got ${chainConfig.nativeDecimals}`));
  }

  for (const nativeAsset of chainConfig.nativeAssets ?? []) {
    if (nativeAsset.symbol.trim() === '') {
      return err(new Error(`EVM v2 chain ${chainConfig.chainName} native asset symbol must not be empty`));
    }

    if (!Number.isInteger(nativeAsset.decimals) || nativeAsset.decimals < 0) {
      return err(
        new Error(
          `EVM v2 chain ${chainConfig.chainName} native asset ${nativeAsset.symbol} decimals must be a non-negative integer`
        )
      );
    }
  }

  return ok(undefined);
}

export function validateEvmTransactionAmounts(
  transactions: readonly EvmTransaction[],
  chainConfig: AccountBasedLedgerChainConfig
): Result<void, Error> {
  return resultDo(function* () {
    for (const transaction of transactions) {
      const amount = yield* parseLedgerDecimalAmount({
        label: 'amount',
        processorLabel: 'EVM v2',
        transactionId: transaction.id,
        value: transaction.amount,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`EVM v2 transaction ${transaction.id} amount must not be negative`));
      }

      const feeAmount = yield* parseLedgerDecimalAmount({
        allowMissing: true,
        label: 'fee',
        processorLabel: 'EVM v2',
        transactionId: transaction.id,
        value: transaction.feeAmount,
      });
      if (feeAmount.isNegative()) {
        return yield* err(new Error(`EVM v2 transaction ${transaction.id} fee amount must not be negative`));
      }

      if (transaction.feeCurrency !== undefined && transaction.feeCurrency !== chainConfig.nativeCurrency) {
        return yield* err(
          new Error(
            `EVM v2 transaction ${transaction.id} fee currency ${transaction.feeCurrency} does not match chain ${chainConfig.chainName} native currency ${chainConfig.nativeCurrency}`
          )
        );
      }

      if (
        transaction.tokenDecimals !== undefined &&
        (!Number.isInteger(transaction.tokenDecimals) || transaction.tokenDecimals < 0)
      ) {
        return yield* err(
          new Error(`EVM v2 transaction ${transaction.id} token decimals must be a non-negative integer`)
        );
      }
    }

    return undefined;
  });
}

export function zeroFailedValueTransfers(transactions: readonly EvmTransaction[]): EvmTransaction[] {
  return transactions.map((transaction) =>
    transaction.status === 'failed' ? { ...transaction, amount: '0' } : transaction
  );
}

export function isEvmNativeMovementTransaction(
  transaction: EvmTransaction,
  chainConfig: AccountBasedLedgerChainConfig
): boolean {
  return (
    isGasNativeSymbol(chainConfig, transaction.currency) ||
    (transaction.tokenSymbol !== undefined && isGasNativeSymbol(chainConfig, transaction.tokenSymbol))
  );
}

export function normalizeEvmTransactionQuantity(
  transaction: EvmTransaction,
  chainConfig: AccountBasedLedgerChainConfig
): Result<Decimal, Error> {
  const decimals = isEvmNativeMovementTransaction(transaction, chainConfig)
    ? chainConfig.nativeDecimals
    : transaction.tokenDecimals;
  const normalizedAmount = fromBaseUnitsToDecimalString(transaction.amount, decimals);
  if (normalizedAmount.isErr()) {
    return err(
      new Error(`EVM v2 transaction ${transaction.id} amount normalization failed: ${normalizedAmount.error.message}`)
    );
  }

  return ok(parseDecimal(normalizedAmount.value));
}

export function buildEvmAssetRefFromMovement(
  movement: EvmMovement,
  chainConfig: AccountBasedLedgerChainConfig,
  transactionHash: string
): Result<EvmAssetRef, Error> {
  return resultDo(function* () {
    const assetSymbol = yield* parseCurrency(movement.asset);

    if (movement.tokenAddress === undefined) {
      if (isGasNativeSymbol(chainConfig, movement.asset)) {
        return {
          assetId: yield* buildBlockchainNativeAssetId(chainConfig.chainName),
          assetSymbol,
        };
      }

      const nativeAsset = findNativeAssetBySymbol(chainConfig, movement.asset);
      if (nativeAsset?.assetIdKind === 'symbol_asset') {
        return {
          assetId: yield* buildBlockchainTokenAssetId(chainConfig.chainName, movement.asset.toLowerCase()),
          assetSymbol,
        };
      }

      if (nativeAsset?.assetIdKind !== 'native_asset') {
        return yield* err(
          new Error(`EVM v2 transaction ${transactionHash} movement ${movement.asset} is missing token address`)
        );
      }

      return {
        assetId: yield* buildBlockchainNativeAssetId(chainConfig.chainName),
        assetSymbol,
      };
    }

    return {
      assetId: yield* buildBlockchainTokenAssetId(chainConfig.chainName, movement.tokenAddress),
      assetSymbol,
    };
  });
}
