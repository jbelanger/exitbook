import type { Currency, PriceAtTxTime } from '@exitbook/core';
import { err, isFiat, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import type { ScopedFeeMovement } from '../matching/build-cost-basis-scoped-transactions.js';
import { resolveTaxAssetIdentity } from '../shared/tax-asset-identity.js';

import type { CanadaTaxInputContextBuildOptions } from './canada-tax-types.js';
import type { CanadaTaxValuation } from './canada-tax-types.js';
import { buildCanadaTaxValuation, createFiatIdentityPrice } from './canada-tax-valuation.js';

export interface CanadaValuedFee {
  feeAssetIdentityKey?: string | undefined;
  feeAssetId: string;
  feeAssetSymbol: Currency;
  feeQuantity: Decimal;
  priceAtTxTime?: PriceAtTxTime | undefined;
  valuation: CanadaTaxValuation;
}

export interface CollectedFiatFee {
  amount: Decimal;
  assetSymbol: string;
  date: string;
  priceAtTxTime?: PriceAtTxTime | undefined;
  txId: number;
}

export async function buildValuedFee(
  fee: {
    amount: Decimal;
    assetId: string;
    assetSymbol: Currency;
    priceAtTxTime?: PriceAtTxTime | undefined;
  },
  timestamp: Date,
  fxProvider: IFxRateProvider,
  identityConfig: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaValuedFee, Error>> {
  if (!fee.priceAtTxTime && !isFiat(fee.assetSymbol)) {
    return err(new Error(`Missing priceAtTxTime for fee ${fee.assetSymbol} at ${timestamp.toISOString()}`));
  }

  let feeAssetIdentityKey: string | undefined;
  if (!isFiat(fee.assetSymbol)) {
    const feeIdentityResult = resolveTaxAssetIdentity(
      {
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
      },
      {
        policy: identityConfig.taxAssetIdentityPolicy,
        relaxedSymbolIdentities: identityConfig.relaxedTaxIdentitySymbols,
      }
    );
    if (feeIdentityResult.isErr()) {
      return err(
        new Error(
          `Failed to resolve tax identity for fee ${fee.assetSymbol} (${fee.assetId}) at ${timestamp.toISOString()}: ` +
            feeIdentityResult.error.message
        )
      );
    }

    feeAssetIdentityKey = feeIdentityResult.value.identityKey;
  }

  const valuationResult = await buildCanadaTaxValuation(
    fee.priceAtTxTime ?? createFiatIdentityPrice(fee.assetSymbol, timestamp),
    fee.amount,
    timestamp,
    fxProvider
  );
  if (valuationResult.isErr()) {
    return err(valuationResult.error);
  }

  return ok({
    feeAssetIdentityKey,
    feeAssetId: fee.assetId,
    feeAssetSymbol: fee.assetSymbol,
    feeQuantity: fee.amount,
    priceAtTxTime: fee.priceAtTxTime,
    valuation: valuationResult.value,
  });
}

export async function valueScopedFees(
  fees: ScopedFeeMovement[],
  timestamp: Date,
  fxProvider: IFxRateProvider,
  identityConfig: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaValuedFee[], Error>> {
  const valuedFees: CanadaValuedFee[] = [];

  for (const fee of fees) {
    const valuedFeeResult = await buildValuedFee(
      {
        amount: fee.amount,
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
        priceAtTxTime: fee.priceAtTxTime,
      },
      timestamp,
      fxProvider,
      identityConfig
    );
    if (valuedFeeResult.isErr()) {
      return err(valuedFeeResult.error);
    }

    valuedFees.push(valuedFeeResult.value);
  }

  return ok(valuedFees);
}

export async function valueCollectedFiatFees(
  fees: CollectedFiatFee[],
  timestamp: Date,
  fxProvider: IFxRateProvider,
  identityConfig: CanadaTaxInputContextBuildOptions
): Promise<Result<CanadaValuedFee[], Error>> {
  const valuedFees: CanadaValuedFee[] = [];

  for (const fee of fees) {
    const valuedFeeResult = await buildValuedFee(
      {
        amount: fee.amount,
        assetId: `fiat:${fee.assetSymbol.toLowerCase()}`,
        assetSymbol: fee.assetSymbol as Currency,
        priceAtTxTime: fee.priceAtTxTime,
      },
      timestamp,
      fxProvider,
      identityConfig
    );
    if (valuedFeeResult.isErr()) {
      return err(valuedFeeResult.error);
    }

    valuedFees.push(valuedFeeResult.value);
  }

  return ok(valuedFees);
}
