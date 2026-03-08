import { parseDecimal, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AccountingScopedTransaction } from '../matching/build-cost-basis-scoped-transactions.js';
import type { ValidatedScopedTransferLink } from '../matching/validated-scoped-transfer-links.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../shared/schemas.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

import { collectFiatFees, extractCryptoFee, validateOutflowFees } from './lot-fee-utils.js';
import {
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateTargetCostBasis,
  calculateTransferDisposalAmount,
  validateTransferVariance,
} from './lot-transfer-utils.js';
import { applyLotQuantityUpdates, buildLotQuantityUpdateMap } from './lot-update-utils.js';
import { createAcquisitionLot } from './lot.js';

type CostBasisTransactionLike = AccountingScopedTransaction | UniversalTransactionData;

function getRawTransaction(transaction: CostBasisTransactionLike): UniversalTransactionData {
  return 'tx' in transaction ? transaction.tx : transaction;
}

interface TransferWarningData {
  assetSymbol?: string;
  date?: string;
  feeAmount?: Decimal;
  feeAssetSymbol?: string;
  linkId?: number;
  linkTargetAmount?: Decimal;
  linkedSourceAmount?: Decimal;
  received?: Decimal;
  sourceTxId?: number;
  targetTxId?: number;
  transferred?: Decimal;
  txId?: number;
  variancePct?: Decimal;
}

interface SourceWarning {
  data: TransferWarningData;
  type: 'variance' | 'missing-price';
}
interface TargetWarning {
  data: TransferWarningData;
  type: 'no-transfers' | 'variance' | 'missing-price';
}

/**
 * Process a transfer source movement.
 *
 * A single scoped outflow can have:
 * - one full validated link
 * - multiple partial validated links that partition the full transfer quantity
 *
 * The source-side lot matching and fee handling must happen once for the full
 * movement, then lot transfers are split across the validated links.
 */
export function processTransferSource(
  transaction: CostBasisTransactionLike,
  outflow: AssetMovement,
  links: ValidatedScopedTransferLink[],
  lots: AcquisitionLot[],
  strategy: ICostBasisStrategy,
  calculationId: string,
  jurisdiction: { sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis' },
  varianceTolerance?: { error: number; warn: number }
): Result<
  {
    disposals: LotDisposal[];
    transfers: LotTransfer[];
    updatedLots: AcquisitionLot[];
    warnings: SourceWarning[];
  },
  Error
> {
  if (links.length === 0) {
    return err(new Error('Transfer source processing requires at least one validated link'));
  }

  const warnings: SourceWarning[] = [];
  const rawTransaction = getRawTransaction(transaction);
  const allPartialLinks = links.every((link) => link.isPartialMatch);
  if (!allPartialLinks && links.length !== 1) {
    return err(
      new Error(
        `Validated transfer source lookup for tx ${rawTransaction.id} movement ${outflow.assetId} returned ` +
          `${links.length} full links. Expected exactly one.`
      )
    );
  }

  const cryptoFeeResult = extractCryptoFee(transaction, outflow.assetId);
  if (cryptoFeeResult.isErr()) {
    return err(cryptoFeeResult.error);
  }
  const cryptoFee = cryptoFeeResult.value;

  const feeValidationResult = validateOutflowFees(
    outflow,
    transaction,
    rawTransaction.source,
    rawTransaction.id,
    varianceTolerance
  );
  if (feeValidationResult.isErr()) {
    return err(feeValidationResult.error);
  }

  const netTransferAmount = outflow.netAmount ?? outflow.grossAmount;
  const linkedSourceAmount = links.reduce(
    (sum, validatedLink) => sum.plus(validatedLink.link.sourceAmount),
    parseDecimal('0')
  );
  if (!linkedSourceAmount.eq(netTransferAmount)) {
    return err(
      new Error(
        `Validated transfer source links for tx ${rawTransaction.id} movement ${links[0]!.sourceMovementFingerprint} ` +
          `sum to ${linkedSourceAmount.toFixed()}, expected ${netTransferAmount.toFixed()}`
      )
    );
  }

  for (const validatedLink of links) {
    const varianceResult = validateTransferVariance(
      validatedLink.link.sourceAmount,
      validatedLink.link.targetAmount,
      rawTransaction.source,
      rawTransaction.id,
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
          linkId: validatedLink.link.id,
          linkTargetAmount: validatedLink.link.targetAmount,
          linkedSourceAmount: validatedLink.link.sourceAmount,
          variancePct,
        },
      });
    }
  }

  const openLots = lots.filter((lot) => lot.assetId === outflow.assetId && lot.remainingQuantity.gt(0));
  const feePolicy = jurisdiction.sameAssetTransferFeePolicy;
  const transferDisposalQuantity = calculateTransferDisposalAmount(
    outflow,
    cryptoFee,
    feePolicy
  ).transferDisposalQuantity;

  const disposal = {
    transactionId: rawTransaction.id,
    assetSymbol: outflow.assetSymbol,
    quantity: transferDisposalQuantity,
    date: new Date(rawTransaction.datetime),
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
          linkId: links[0]!.link.id,
        },
      });
    } else {
      cryptoFeeUsdValue = cryptoFee.amount.times(cryptoFee.priceAtTxTime.price.amount);
    }
  }

  const transfers: LotTransfer[] = [];
  const quantityToSubtractByLotId = new Map<string, Decimal>();

  for (const lotDisposal of lotDisposals) {
    const lot = lots.find((candidateLot) => candidateLot.id === lotDisposal.lotId);
    if (!lot) {
      return err(new Error(`Lot ${lotDisposal.lotId} not found`));
    }

    buildLotQuantityUpdateMap(lotDisposal.lotId, lotDisposal.quantityDisposed, quantityToSubtractByLotId);

    for (const validatedLink of links) {
      const linkTransferFraction = validatedLink.link.sourceAmount.dividedBy(netTransferAmount);
      const allocatedDisposalQuantity = lotDisposal.quantityDisposed.times(linkTransferFraction);
      const quantityTransferred = lotDisposal.quantityDisposed
        .times(validatedLink.link.sourceAmount)
        .dividedBy(transferDisposalQuantity);

      const metadata = cryptoFeeUsdValue
        ? buildTransferMetadata(
            {
              ...cryptoFee,
              priceAtTxTime: cryptoFee.priceAtTxTime,
            },
            feePolicy,
            allocatedDisposalQuantity,
            transferDisposalQuantity
          )
        : undefined;

      transfers.push({
        id: globalThis.crypto.randomUUID(),
        calculationId,
        sourceLotId: lotDisposal.lotId,
        provenance: {
          kind: 'confirmed-link',
          linkId: validatedLink.link.id,
          sourceMovementFingerprint: validatedLink.sourceMovementFingerprint,
          targetMovementFingerprint: validatedLink.targetMovementFingerprint,
        },
        quantityTransferred,
        costBasisPerUnit: lotDisposal.costBasisPerUnit,
        sourceTransactionId: rawTransaction.id,
        targetTransactionId: validatedLink.link.targetTransactionId,
        transferDate: new Date(rawTransaction.datetime),
        metadata,
        createdAt: new Date(),
      });
    }
  }

  const disposals: LotDisposal[] = [];
  if (cryptoFee.amount.gt(0) && feePolicy === 'disposal') {
    const lotsAfterTransferResult = applyLotQuantityUpdates(lots, quantityToSubtractByLotId);
    if (lotsAfterTransferResult.isErr()) {
      return err(lotsAfterTransferResult.error);
    }

    const remainingLotsAfterTransfer = lotsAfterTransferResult.value.filter(
      (lot) => lot.assetId === outflow.assetId && lot.remainingQuantity.gt(0)
    );
    const feeDisposal = {
      transactionId: rawTransaction.id,
      assetSymbol: outflow.assetSymbol,
      quantity: cryptoFee.amount,
      date: new Date(rawTransaction.datetime),
      proceedsPerUnit: cryptoFee.priceAtTxTime?.price.amount ?? parseDecimal('0'),
    };

    const feeDisposalsResult = strategy.matchDisposal(feeDisposal, remainingLotsAfterTransfer);
    if (feeDisposalsResult.isErr()) {
      return err(feeDisposalsResult.error);
    }

    for (const lotDisposal of feeDisposalsResult.value) {
      const lot = lots.find((candidateLot) => candidateLot.id === lotDisposal.lotId);
      if (!lot) {
        return err(new Error(`Lot ${lotDisposal.lotId} not found`));
      }

      buildLotQuantityUpdateMap(lotDisposal.lotId, lotDisposal.quantityDisposed, quantityToSubtractByLotId);
      disposals.push(lotDisposal);
    }
  }

  const updatedLotsResult = applyLotQuantityUpdates(lots, quantityToSubtractByLotId);
  if (updatedLotsResult.isErr()) {
    return err(updatedLotsResult.error);
  }

  return ok({ disposals, transfers, updatedLots: updatedLotsResult.value, warnings });
}

/**
 * Process a transfer target to create an acquisition lot with inherited basis.
 *
 * One target movement can map to multiple validated links under N:1 partial
 * matching. Each link creates a separate lot slice so fiat fees and inherited
 * basis stay aligned with the validated source movement partition.
 */
export function processTransferTarget(
  transaction: CostBasisTransactionLike,
  inflow: AssetMovement,
  validatedLink: ValidatedScopedTransferLink,
  sourceTx: CostBasisTransactionLike,
  transfersForLink: LotTransfer[],
  calculationId: string,
  strategyName: 'fifo' | 'lifo' | 'specific-id' | 'average-cost',
  varianceTolerance?: { error: number; warn: number }
): Result<
  {
    lot: AcquisitionLot;
    warnings: TargetWarning[];
  },
  Error
> {
  const warnings: TargetWarning[] = [];
  const rawTransaction = getRawTransaction(transaction);
  const rawSourceTransaction = getRawTransaction(sourceTx);

  if (transfersForLink.length === 0) {
    warnings.push({
      type: 'no-transfers',
      data: {
        linkId: validatedLink.link.id,
        targetTxId: rawTransaction.id,
        sourceTxId: rawSourceTransaction.id,
      },
    });
    return err(
      new Error(
        `No lot transfers found for link ${validatedLink.link.id} (target tx ${rawTransaction.id}). ` +
          `Source transaction ${rawSourceTransaction.id} should have been processed first.`
      )
    );
  }

  const { totalCostBasis: inheritedCostBasis, transferredQuantity } = calculateInheritedCostBasis(transfersForLink);
  const receivedQuantity = validatedLink.link.targetAmount;

  const varianceResult = validateTransferVariance(
    transferredQuantity,
    receivedQuantity,
    rawTransaction.source,
    rawTransaction.id,
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
        linkId: validatedLink.link.id,
        targetTxId: rawTransaction.id,
        variancePct,
        transferred: transferredQuantity,
        received: receivedQuantity,
      },
    });
  }

  const sourceFraction = validatedLink.link.sourceAmount.dividedBy(validatedLink.sourceMovementAmount);
  const targetFraction = validatedLink.link.targetAmount.dividedBy(validatedLink.targetMovementAmount);
  const fiatFeesResult = collectFiatFees(sourceTx, transaction, {
    sourceFraction,
    targetFraction,
  });
  if (fiatFeesResult.isErr()) {
    return err(fiatFeesResult.error);
  }

  const fiatFees = fiatFeesResult.value;
  for (const fee of fiatFees) {
    if (fee.priceAtTxTime) continue;
    warnings.push({
      type: 'missing-price',
      data: {
        txId: fee.txId,
        linkId: validatedLink.link.id,
        feeAssetSymbol: fee.assetSymbol,
        feeAmount: fee.amount,
        date: fee.date,
      },
    });
  }

  const costBasisPerUnit = calculateTargetCostBasis(inheritedCostBasis, fiatFees, receivedQuantity);
  const lot = createAcquisitionLot({
    id: globalThis.crypto.randomUUID(),
    calculationId,
    acquisitionTransactionId: rawTransaction.id,
    assetId: inflow.assetId,
    assetSymbol: inflow.assetSymbol,
    quantity: receivedQuantity,
    costBasisPerUnit,
    method: strategyName,
    transactionDate: new Date(rawTransaction.datetime),
  });

  return ok({ lot, warnings });
}
