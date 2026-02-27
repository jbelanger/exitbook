import { parseDecimal, type AssetMovement, type PriceAtTxTime, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { TransactionLink } from '../linking/types.js';

import { collectFiatFees, extractCryptoFee, validateOutflowFees } from './lot-fee-utils.js';
import {
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateTargetCostBasis,
  calculateTransferDisposalAmount,
  validateTransferVariance,
} from './lot-transfer-utils.js';
import { createAcquisitionLot } from './lot.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from './schemas.js';
import type { ICostBasisStrategy } from './strategies/base-strategy.js';

/**
 * Process a transfer source transaction
 *
 * Pure function that validates fees, creates lot transfers and disposals,
 * and returns updated lots without mutation. Returns warnings for logging.
 */
export function processTransferSource(
  tx: UniversalTransactionData,
  outflow: AssetMovement,
  link: TransactionLink,
  lots: AcquisitionLot[],
  strategy: ICostBasisStrategy,
  calculationId: string,
  jurisdiction: { sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis' },
  varianceTolerance?: { error: number; warn: number },
  effectiveAmount?: Decimal
): Result<
  {
    disposals: LotDisposal[];
    transfers: LotTransfer[];
    updatedLots: AcquisitionLot[];
    warnings: {
      data: {
        asset?: string;
        feeAmount?: Decimal;
        linkId?: number;
        linkTargetAmount?: Decimal;
        netTransferAmount?: Decimal;
        variancePct?: Decimal;
      };
      type: 'variance' | 'missing-price';
    }[];
  },
  Error
> {
  const warnings: {
    data: {
      assetSymbol?: string;
      feeAmount?: Decimal;
      linkId?: number;
      linkTargetAmount?: Decimal;
      netTransferAmount?: Decimal;
      variancePct?: Decimal;
    };
    type: 'variance' | 'missing-price';
  }[] = [];

  // When effectiveAmount is provided (UTXO partial outflow), the amount represents the
  // external transfer portion only (gross minus internal change). Fees are already baked
  // into the UTXO adjustment, so we skip fee extraction and validation.
  const isPartialOutflow = effectiveAmount !== undefined;

  let cryptoFee: { amount: Decimal; feeType: string; priceAtTxTime?: PriceAtTxTime | undefined };
  if (isPartialOutflow) {
    cryptoFee = { amount: parseDecimal('0'), feeType: 'none' };
  } else {
    const cryptoFeeResult = extractCryptoFee(tx, outflow.assetSymbol);
    if (cryptoFeeResult.isErr()) {
      return err(cryptoFeeResult.error);
    }
    cryptoFee = cryptoFeeResult.value;

    // Validate that netAmount matches grossAmount minus on-chain fees
    const feeValidationResult = validateOutflowFees(outflow, tx, tx.source, tx.id, varianceTolerance);
    if (feeValidationResult.isErr()) {
      return err(feeValidationResult.error);
    }
  }

  // Use effectiveAmount (UTXO adjusted) or outflow netAmount for transfer validation
  const netTransferAmount = effectiveAmount ?? outflow.netAmount ?? outflow.grossAmount;

  // Validate transfer variance
  const varianceResult = validateTransferVariance(
    netTransferAmount,
    link.targetAmount,
    tx.source,
    tx.id,
    outflow.assetSymbol,
    varianceTolerance
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;

  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        assetSymbol: outflow.assetSymbol,
        variancePct,
        netTransferAmount,
        linkTargetAmount: link.targetAmount,
      },
    });
  }

  const openLots = lots.filter((lot) => lot.assetId === outflow.assetId && lot.remainingQuantity.gt(0));

  const feePolicy = jurisdiction.sameAssetTransferFeePolicy;
  // For partial outflows, use effectiveAmount directly as the disposal quantity
  const transferDisposalQuantity = isPartialOutflow
    ? effectiveAmount
    : calculateTransferDisposalAmount(outflow, cryptoFee, feePolicy).transferDisposalQuantity;

  const disposal = {
    transactionId: tx.id,
    assetSymbol: outflow.assetSymbol,
    quantity: transferDisposalQuantity,
    date: new Date(tx.datetime),
    proceedsPerUnit: parseDecimal('0'),
  };

  const lotDisposalsResult = strategy.matchDisposal(disposal, openLots);
  if (lotDisposalsResult.isErr()) {
    return err(lotDisposalsResult.error);
  }
  const lotDisposals = lotDisposalsResult.value;

  let cryptoFeeUsdValue: Decimal | undefined = undefined;
  if (cryptoFee.amount.gt(0) && feePolicy === 'add-to-basis') {
    if (!cryptoFee.priceAtTxTime) {
      warnings.push({
        type: 'missing-price',
        data: {
          assetSymbol: outflow.assetSymbol,
          feeAmount: cryptoFee.amount,
          linkId: link.id,
        },
      });
      cryptoFeeUsdValue = undefined;
    } else {
      cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
    }
  }

  const transfers: LotTransfer[] = [];
  const quantityToTransfer = netTransferAmount;

  // Create a map for efficient lot lookup during updates
  const lotUpdates = new Map<string, { quantityToSubtract: Decimal }>();

  for (const lotDisposal of lotDisposals) {
    // Build metadata for crypto fees if using add-to-basis policy
    const metadata = cryptoFeeUsdValue
      ? buildTransferMetadata(
          { ...cryptoFee, priceAtTxTime: cryptoFee.priceAtTxTime },
          feePolicy,
          lotDisposal.quantityDisposed,
          transferDisposalQuantity
        )
      : undefined;

    const lot = lots.find((l) => l.id === lotDisposal.lotId);
    if (!lot) {
      return err(new Error(`Lot ${lotDisposal.lotId} not found`));
    }

    transfers.push({
      id: globalThis.crypto.randomUUID(),
      calculationId,
      sourceLotId: lotDisposal.lotId,
      linkId: link.id,
      quantityTransferred: lotDisposal.quantityDisposed.times(quantityToTransfer.dividedBy(transferDisposalQuantity)),
      costBasisPerUnit: lotDisposal.costBasisPerUnit,
      sourceTransactionId: tx.id,
      targetTransactionId: link.targetTransactionId,
      transferDate: new Date(tx.datetime),
      metadata,
      createdAt: new Date(),
    });

    // Track quantity to subtract for this lot
    const existing = lotUpdates.get(lotDisposal.lotId) || { quantityToSubtract: parseDecimal('0') };
    lotUpdates.set(lotDisposal.lotId, {
      quantityToSubtract: existing.quantityToSubtract.plus(lotDisposal.quantityDisposed),
    });
  }

  const disposals: LotDisposal[] = [];

  if (cryptoFee.amount.gt(0) && feePolicy === 'disposal') {
    const feeDisposal = {
      transactionId: tx.id,
      assetSymbol: outflow.assetSymbol,
      quantity: cryptoFee.amount,
      date: new Date(tx.datetime),
      proceedsPerUnit: cryptoFee.priceAtTxTime?.price.amount ?? parseDecimal('0'),
    };

    const feeDisposalsResult = strategy.matchDisposal(feeDisposal, openLots);
    if (feeDisposalsResult.isErr()) {
      return err(feeDisposalsResult.error);
    }
    const feeDisposals = feeDisposalsResult.value;

    for (const lotDisposal of feeDisposals) {
      const lot = lots.find((l) => l.id === lotDisposal.lotId);
      if (!lot) {
        return err(new Error(`Lot ${lotDisposal.lotId} not found`));
      }

      // Track quantity to subtract for this lot
      const existing = lotUpdates.get(lotDisposal.lotId) || { quantityToSubtract: parseDecimal('0') };
      lotUpdates.set(lotDisposal.lotId, {
        quantityToSubtract: existing.quantityToSubtract.plus(lotDisposal.quantityDisposed),
      });

      disposals.push(lotDisposal);
    }
  }

  // Create updated lots array (no mutation)
  const updatedLots = lots.map((lot) => {
    const update = lotUpdates.get(lot.id);
    if (!update) {
      return lot;
    }

    const newRemainingQuantity = lot.remainingQuantity.minus(update.quantityToSubtract);
    let newStatus: 'open' | 'partially_disposed' | 'fully_disposed' = lot.status;

    if (newRemainingQuantity.isZero()) {
      newStatus = 'fully_disposed';
    } else if (newRemainingQuantity.lt(lot.quantity)) {
      newStatus = 'partially_disposed';
    }

    return {
      ...lot,
      remainingQuantity: newRemainingQuantity,
      status: newStatus,
      updatedAt: new Date(),
    };
  });

  return ok({ disposals, transfers, updatedLots, warnings });
}

/**
 * Process a transfer target transaction to create acquisition lot with inherited cost basis
 *
 * Pure function that calculates cost basis and returns the lot with warnings for logging.
 * Source transaction must be provided (fetched by caller).
 */
export function processTransferTarget(
  tx: UniversalTransactionData,
  inflow: AssetMovement,
  link: TransactionLink,
  sourceTx: UniversalTransactionData,
  transfersForLink: LotTransfer[],
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost',
  varianceTolerance?: { error: number; warn: number }
): Result<
  {
    lot: AcquisitionLot;
    warnings: {
      data: {
        date?: string;
        feeAmount?: Decimal;
        feeAssetSymbol?: string;
        linkId?: number;
        received?: Decimal;
        sourceTxId?: number;
        targetTxId?: number;
        transferred?: Decimal;
        txId?: number;
        variancePct?: Decimal;
      };
      type: 'no-transfers' | 'variance' | 'missing-price';
    }[];
  },
  Error
> {
  const warnings: {
    data: {
      date?: string;
      feeAmount?: Decimal;
      feeAssetSymbol?: string;
      linkId?: number;
      received?: Decimal;
      sourceTxId?: number;
      targetTxId?: number;
      transferred?: Decimal;
      txId?: number;
      variancePct?: Decimal;
    };
    type: 'no-transfers' | 'variance' | 'missing-price';
  }[] = [];

  if (transfersForLink.length === 0) {
    warnings.push({
      type: 'no-transfers',
      data: {
        linkId: link.id,
        targetTxId: tx.id,
        sourceTxId: link.sourceTransactionId,
      },
    });
    return err(
      new Error(
        `No lot transfers found for link ${link.id} (target tx ${tx.id}). ` +
          `Source transaction ${link.sourceTransactionId} should have been processed first.`
      )
    );
  }

  // Calculate inherited cost basis from source lots
  const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfersForLink);

  const receivedQuantity = inflow.grossAmount;

  // Validate transfer variance
  const varianceResult = validateTransferVariance(
    transferredQuantity,
    receivedQuantity,
    tx.source,
    tx.id,
    inflow.assetSymbol,
    varianceTolerance
  );
  if (varianceResult.isErr()) {
    return err(varianceResult.error);
  }

  const { tolerance, variancePct } = varianceResult.value;

  if (variancePct.gt(tolerance.warn)) {
    warnings.push({
      type: 'variance',
      data: {
        linkId: link.id,
        targetTxId: tx.id,
        variancePct,
        transferred: transferredQuantity,
        received: receivedQuantity,
      },
    });
  }

  const fiatFeesResult = collectFiatFees(sourceTx, tx);
  if (fiatFeesResult.isErr()) {
    return err(fiatFeesResult.error);
  }

  const fiatFees = fiatFeesResult.value;

  // Collect warnings about missing prices on fiat fees
  for (const fee of fiatFees) {
    if (!fee.priceAtTxTime) {
      warnings.push({
        type: 'missing-price',
        data: {
          txId: fee.txId,
          linkId: link.id,
          feeAssetSymbol: fee.assetSymbol,
          feeAmount: fee.amount,
          date: fee.date,
        },
      });
    }
  }

  // Calculate final cost basis including fiat fees
  const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFees, receivedQuantity);

  const lot = createAcquisitionLot({
    id: globalThis.crypto.randomUUID(),
    calculationId,
    acquisitionTransactionId: tx.id,
    assetId: inflow.assetId,
    assetSymbol: inflow.assetSymbol,
    quantity: receivedQuantity,
    costBasisPerUnit,
    method: strategyName,
    transactionDate: new Date(tx.datetime),
  });

  return ok({ lot, warnings });
}
