import type { CardanoAssetAmount, CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  ok,
  parseCurrency,
  resultDo,
  type Result,
} from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { parseLedgerDecimalAmount } from '../shared/ledger-assembler-utils.js';

import type { CardanoAssetRef, ValidatedCardanoAmounts } from './journal-assembler-types.js';
import { parseCardanoAssetUnit } from './processor-utils.js';

function parseCardanoTransactionAmount(params: {
  allowMissing?: boolean | undefined;
  label: string;
  transactionId: string;
  value: string | undefined;
}): Result<Decimal, Error> {
  return parseLedgerDecimalAmount({
    ...params,
    processorLabel: 'Cardano v2',
  });
}

function validateCardanoAssetDecimals(params: {
  assetUnit: string;
  decimals: number | undefined;
  label: string;
  transactionId: string;
}): Result<number | undefined, Error> {
  if (params.decimals === undefined) {
    return ok(undefined);
  }

  if (!Number.isInteger(params.decimals) || params.decimals < 0) {
    return err(
      new Error(
        `Cardano v2 transaction ${params.transactionId} ${params.label} asset ${params.assetUnit} decimals must be a non-negative integer`
      )
    );
  }

  return ok(params.decimals);
}

export function normalizeCardanoAssetQuantity(params: {
  assetAmount: CardanoAssetAmount;
  label: string;
  transactionId: string;
}): Result<Decimal, Error> {
  return resultDo(function* () {
    const amount = yield* parseCardanoTransactionAmount({
      label: params.label,
      transactionId: params.transactionId,
      value: params.assetAmount.quantity,
    });
    if (amount.isNegative()) {
      return yield* err(
        new Error(`Cardano v2 transaction ${params.transactionId} ${params.label} amount must not be negative`)
      );
    }

    const decimals = yield* validateCardanoAssetDecimals({
      assetUnit: params.assetAmount.unit,
      decimals: params.assetAmount.decimals,
      label: params.label,
      transactionId: params.transactionId,
    });
    const { isAda } = parseCardanoAssetUnit(params.assetAmount.unit);
    const normalizedDecimals = isAda ? 6 : decimals;
    if (normalizedDecimals === undefined || normalizedDecimals === 0) {
      return amount;
    }

    return amount.dividedBy(new Decimal(10).pow(normalizedDecimals));
  });
}

export function validateCardanoTransactionAmounts(
  transaction: CardanoTransaction
): Result<ValidatedCardanoAmounts, Error> {
  return resultDo(function* () {
    for (const input of transaction.inputs) {
      for (const assetAmount of input.amounts) {
        yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'input',
          transactionId: transaction.id,
        });
      }
    }

    for (const output of transaction.outputs) {
      for (const assetAmount of output.amounts) {
        yield* normalizeCardanoAssetQuantity({
          assetAmount,
          label: 'output',
          transactionId: transaction.id,
        });
      }
    }

    const withdrawalAmounts: Decimal[] = [];
    for (const withdrawal of transaction.withdrawals ?? []) {
      const amount = yield* parseCardanoTransactionAmount({
        label: 'withdrawal',
        transactionId: transaction.id,
        value: withdrawal.amount,
      });
      if (amount.isNegative()) {
        return yield* err(new Error(`Cardano v2 transaction ${transaction.id} withdrawal amount must not be negative`));
      }

      withdrawalAmounts.push(amount);
    }

    for (const certificate of transaction.mirCertificates ?? []) {
      const amount = yield* parseCardanoTransactionAmount({
        label: 'MIR certificate',
        transactionId: transaction.id,
        value: certificate.amount,
      });
      if (amount.isNegative()) {
        return yield* err(
          new Error(`Cardano v2 transaction ${transaction.id} MIR certificate amount must not be negative`)
        );
      }
    }

    const protocolDepositDeltaAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'protocol deposit delta',
      transactionId: transaction.id,
      value: transaction.protocolDepositDeltaAmount,
    });
    const treasuryDonationAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'treasury donation',
      transactionId: transaction.id,
      value: transaction.treasuryDonationAmount,
    });
    if (treasuryDonationAmount.isNegative()) {
      return yield* err(
        new Error(`Cardano v2 transaction ${transaction.id} treasury donation amount must not be negative`)
      );
    }

    const feeAmount = yield* parseCardanoTransactionAmount({
      allowMissing: true,
      label: 'fee',
      transactionId: transaction.id,
      value: transaction.feeAmount,
    });
    if (feeAmount.isNegative()) {
      return yield* err(new Error(`Cardano v2 transaction ${transaction.id} fee amount must not be negative`));
    }

    return {
      protocolDepositDeltaAmount,
      feeAmount,
      treasuryDonationAmount,
      withdrawalAmounts,
    };
  });
}

export function buildCardanoAssetRefFromUnit(unit: string, symbol?: string): Result<CardanoAssetRef, Error> {
  return resultDo(function* () {
    const isNativeAda = unit === 'lovelace';
    const assetId = isNativeAda
      ? yield* buildBlockchainNativeAssetId('cardano')
      : yield* buildBlockchainTokenAssetId('cardano', unit);
    const defaultSymbol = isNativeAda ? 'ADA' : unit;
    const assetSymbol = yield* parseCurrency(symbol ?? defaultSymbol);

    return {
      assetId,
      assetSymbol,
    };
  });
}
