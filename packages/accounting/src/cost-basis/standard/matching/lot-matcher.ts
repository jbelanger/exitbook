import { err, ok, parseDecimal, resultDoAsync, type Result } from '@exitbook/foundation';
import { isFiat } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';
import {
  groupTransactionAnnotationsByTransactionId,
  resolveExactTargetResidualRole,
} from '@exitbook/transaction-interpretation';
import type { Decimal } from 'decimal.js';

import {
  resolveInternalTransferCarryovers,
  type ResolvedInternalTransferCarryover,
  type ResolvedInternalTransferCarryoverTarget,
} from '../../../accounting-model/accounting-model-resolution.js';
import type {
  AccountingModelBuildResult,
  AccountingTransactionView,
} from '../../../accounting-model/accounting-model-types.js';
import type {
  ValidatedTransferLink,
  ValidatedTransferSet,
} from '../../../accounting-model/validated-transfer-links.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../../model/schemas.js';
import {
  processInternalTransferCarryoverSource,
  processInternalTransferCarryoverTarget,
  type InternalTransferCarryoverTargetBinding,
} from '../lots/internal-carryover-processing-utils.js';
import {
  buildAcquisitionLotFromInflow,
  buildExplainedResidualAcquisitionLotFromInflow,
} from '../lots/lot-creation-utils.js';
import { matchOutflowDisposal } from '../lots/lot-disposal-utils.js';
import {
  getMovementAssetId,
  getMovementAssetSymbol,
  getMovementGrossQuantity,
  getMovementNetQuantity,
  type CostBasisMovementLike,
} from '../lots/lot-transaction-shapes.js';
import { processTransferSource, processTransferTarget } from '../lots/lot-transfer-processing-utils.js';
import {
  sortTransactionsByDependency,
  type TransactionDependencyEdge,
} from '../lots/transaction-dependency-sorting.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

interface LotMatcherConfig {
  calculationId: string;
  strategy: ICostBasisStrategy;
  jurisdiction?:
    | {
        sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis';
      }
    | undefined;
  varianceTolerance?: { error: number; warn: number } | undefined;
}

export interface AssetLotMatchResult {
  assetId: string;
  assetSymbol: string;
  lots: AcquisitionLot[];
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
}

interface LotMatchResult {
  assetResults: AssetLotMatchResult[];
  totalLotsCreated: number;
  totalDisposalsProcessed: number;
  totalTransfersProcessed: number;
}

interface AssetProcessingState {
  assetSymbol: string;
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
  lots: AcquisitionLot[];
}

interface PreparedInternalTransferCarryover {
  carryover: ResolvedInternalTransferCarryover;
  targetBindings: InternalTransferCarryoverTargetBinding[];
}

interface PreparedInternalTransferCarryoverTarget {
  bindingKey: string;
  carryover: ResolvedInternalTransferCarryover;
  target: ResolvedInternalTransferCarryoverTarget;
}

function getExplainedResidualAcquisitionQuantity(
  targetTransaction: AccountingTransactionView,
  inflow: CostBasisMovementLike,
  targetTransactionAnnotations: readonly TransactionAnnotation[] | undefined,
  validatedTargetLinks: readonly ValidatedTransferLink[]
): Decimal | undefined {
  if (validatedTargetLinks.length === 0) {
    return undefined;
  }

  const fullMovementAmount = getMovementNetQuantity(inflow) ?? getMovementGrossQuantity(inflow);
  const linkedTargetAmount = validatedTargetLinks.reduce(
    (sum, validatedLink) => sum.plus(validatedLink.link.targetAmount),
    parseDecimal('0')
  );

  if (!linkedTargetAmount.lt(fullMovementAmount)) {
    return undefined;
  }

  const residualQuantity = fullMovementAmount.minus(linkedTargetAmount);
  switch (
    resolveExactTargetResidualRole({
      assetSymbol: getMovementAssetSymbol(inflow),
      residualQuantity,
      targetTransaction: targetTransaction.processedTransaction,
      targetTransactionAnnotations,
      transferLinks: validatedTargetLinks.map((validatedLink) => validatedLink.link),
    })
  ) {
    case 'staking_reward':
    case 'refund_rebate':
      return residualQuantity;
    default:
      return undefined;
  }
}

export class LotMatcher {
  private readonly logger = getLogger('LotMatcher');

  async match(
    accountingModel: AccountingModelBuildResult,
    validatedExternalLinks: ValidatedTransferSet,
    config: LotMatcherConfig,
    options?: {
      transactionAnnotations?: readonly TransactionAnnotation[] | undefined;
    }
  ): Promise<Result<LotMatchResult, Error>> {
    return resultDoAsync(async function* (self: LotMatcher) {
      const resolvedCarryovers = yield* resolveInternalTransferCarryovers(accountingModel);
      if ((validatedExternalLinks.links.length > 0 || resolvedCarryovers.length > 0) && !config.jurisdiction) {
        return yield* err(new Error('Jurisdiction configuration is required for transfer and carryover handling'));
      }

      const transactionViewsById = new Map(
        accountingModel.accountingTransactionViews.map((transactionView) => [
          transactionView.processedTransaction.id,
          transactionView,
        ])
      );
      const { carryoversBySourceTransactionId, carryoversByTargetMovementFingerprint } =
        yield* self.prepareCarryovers(resolvedCarryovers);

      const dependencyEdges: TransactionDependencyEdge[] = [
        ...validatedExternalLinks.links.map((validatedLink) => ({
          sourceTransactionId: validatedLink.link.sourceTransactionId,
          targetTransactionId: validatedLink.link.targetTransactionId,
        })),
        ...resolvedCarryovers.flatMap((carryover) =>
          carryover.targets.map((target) => ({
            sourceTransactionId: carryover.source.processedTransaction.id,
            targetTransactionId: target.target.processedTransaction.id,
          }))
        ),
      ];

      const sortedTransactions = yield* sortTransactionsByDependency(
        accountingModel.accountingTransactionViews.map((transactionView) => transactionView.processedTransaction),
        dependencyEdges
      );

      const sortedTransactionViews: AccountingTransactionView[] = [];
      const transactionAnnotationsByTransactionId = groupTransactionAnnotationsByTransactionId(
        options?.transactionAnnotations
      );
      for (const transaction of sortedTransactions) {
        const transactionView = transactionViewsById.get(transaction.id);
        if (!transactionView) {
          return yield* err(
            new Error(`Accounting transaction view ${transaction.id} not found after dependency sorting`)
          );
        }

        sortedTransactionViews.push(transactionView);
      }

      const lotStateByAssetId = new Map<string, AssetProcessingState>();
      const transfersByBindingKey = new Map<string, LotTransfer[]>();

      for (const transactionView of sortedTransactionViews) {
        const sourceCarryovers = carryoversBySourceTransactionId.get(transactionView.processedTransaction.id) ?? [];
        for (const preparedCarryover of sourceCarryovers) {
          const sourceAssetId = preparedCarryover.carryover.source.entry.assetId;
          const sourceAssetSymbol = preparedCarryover.carryover.source.entry.assetSymbol;
          const assetState = self.getOrInitAssetState(sourceAssetId, sourceAssetSymbol, lotStateByAssetId);

          const carryoverSourceResult = processInternalTransferCarryoverSource(
            preparedCarryover.carryover,
            preparedCarryover.targetBindings,
            assetState.lots,
            config.strategy,
            config.calculationId,
            config.jurisdiction!
          );
          if (carryoverSourceResult.isErr()) {
            return yield* carryoverSourceResult;
          }

          for (const warning of carryoverSourceResult.value.warnings) {
            return yield* err(
              new Error(
                `Carryover fee price missing at tx ${preparedCarryover.carryover.source.processedTransaction.id}: ` +
                  `${warning.data.feeAmount?.toFixed() ?? 'unknown'} ${sourceAssetSymbol}`
              )
            );
          }

          assetState.disposals.push(...carryoverSourceResult.value.disposals);
          assetState.lots.splice(0, assetState.lots.length, ...carryoverSourceResult.value.updatedLots);
          for (const transfer of carryoverSourceResult.value.transfers) {
            assetState.lotTransfers.push(transfer);
            self.pushTransfer(transfersByBindingKey, transfer);
          }
        }

        for (const outflow of transactionView.outflows) {
          if (isFiat(getMovementAssetSymbol(outflow))) continue;

          const assetState = self.getOrInitAssetState(
            getMovementAssetId(outflow),
            getMovementAssetSymbol(outflow),
            lotStateByAssetId
          );
          const sourceLinks = self.findSourceLinks(validatedExternalLinks, outflow.movementFingerprint);

          if (sourceLinks.length === 0) {
            const disposalResult = matchOutflowDisposal(transactionView, outflow, assetState.lots, config.strategy);
            if (disposalResult.isErr()) {
              return yield* disposalResult;
            }
            assetState.disposals.push(...disposalResult.value.disposals);
            assetState.lots.splice(0, assetState.lots.length, ...disposalResult.value.updatedLots);
            continue;
          }

          const transferResult = processTransferSource(
            transactionView,
            outflow,
            sourceLinks,
            assetState.lots,
            config.strategy,
            config.calculationId,
            config.jurisdiction!,
            config.varianceTolerance
          );
          if (transferResult.isErr()) {
            return yield* transferResult;
          }

          for (const warning of transferResult.value.warnings) {
            if (
              warning.type === 'variance' &&
              warning.data.variancePct &&
              warning.data.linkedSourceAmount &&
              warning.data.linkTargetAmount
            ) {
              const tolerance = config.varianceTolerance?.warn ?? 1.0;
              self.logger.warn(
                {
                  txId: transactionView.processedTransaction.id,
                  linkId: warning.data.linkId,
                  assetSymbol: warning.data.assetSymbol,
                  variancePct: warning.data.variancePct.toFixed(2),
                  linkedSourceAmount: warning.data.linkedSourceAmount.toFixed(),
                  linkTargetAmount: warning.data.linkTargetAmount.toFixed(),
                  source: transactionView.processedTransaction.platformKey,
                },
                `Transfer variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold (${tolerance.toFixed()}). ` +
                  `Possible hidden fees or incomplete fee metadata. Review exchange fee policies.`
              );
            } else if (warning.type === 'missing-price' && warning.data.feeAmount) {
              self.logger.warn(
                {
                  txId: transactionView.processedTransaction.id,
                  linkId: warning.data.linkId,
                  assetSymbol: warning.data.assetSymbol,
                  feeAmount: warning.data.feeAmount.toFixed(),
                  date: transactionView.processedTransaction.datetime,
                },
                'Crypto fee missing price for add-to-basis policy. Fee will not be added to cost basis. ' +
                  'Run "prices enrich" to populate missing prices.'
              );
            }
          }

          assetState.disposals.push(...transferResult.value.disposals);
          assetState.lots.splice(0, assetState.lots.length, ...transferResult.value.updatedLots);
          for (const transfer of transferResult.value.transfers) {
            assetState.lotTransfers.push(transfer);
            self.pushTransfer(transfersByBindingKey, transfer);
          }
        }

        for (const inflow of transactionView.inflows) {
          if (isFiat(getMovementAssetSymbol(inflow))) continue;

          const validatedTargetLinks = self.findTargetLinks(validatedExternalLinks, inflow.movementFingerprint);
          const carryoverTargets = carryoversByTargetMovementFingerprint.get(inflow.movementFingerprint) ?? [];

          if (validatedTargetLinks.length > 0 && carryoverTargets.length > 0) {
            return yield* err(
              new Error(
                `Movement ${inflow.movementFingerprint} is targeted by both validated transfer links and internal transfer carryovers`
              )
            );
          }

          const assetState = self.getOrInitAssetState(
            getMovementAssetId(inflow),
            getMovementAssetSymbol(inflow),
            lotStateByAssetId
          );

          if (validatedTargetLinks.length > 0) {
            for (const validatedLink of validatedTargetLinks) {
              const sourceTransaction = transactionViewsById.get(validatedLink.link.sourceTransactionId);
              if (!sourceTransaction) {
                return yield* err(new Error(`Source transaction ${validatedLink.link.sourceTransactionId} not found`));
              }

              const transfersForLink =
                transfersByBindingKey.get(self.getConfirmedLinkBindingKey(validatedLink.link.id)) ?? [];
              const transferTargetResult = processTransferTarget(
                transactionView,
                inflow,
                validatedLink,
                sourceTransaction,
                transfersForLink,
                config.calculationId,
                config.strategy.getName(),
                config.varianceTolerance
              );
              if (transferTargetResult.isErr()) {
                return yield* transferTargetResult;
              }

              for (const warning of transferTargetResult.value.warnings) {
                if (warning.type === 'no-transfers') {
                  self.logger.error(
                    {
                      linkId: warning.data.linkId,
                      targetTxId: warning.data.targetTxId,
                      sourceTxId: warning.data.sourceTxId,
                    },
                    'No lot transfers found for link - source transaction may not have been processed'
                  );
                } else if (
                  warning.type === 'variance' &&
                  warning.data.variancePct &&
                  warning.data.transferred &&
                  warning.data.received
                ) {
                  self.logger.warn(
                    {
                      linkId: warning.data.linkId,
                      targetTxId: warning.data.targetTxId,
                      variancePct: warning.data.variancePct.toFixed(2),
                      transferred: warning.data.transferred.toFixed(),
                      received: warning.data.received.toFixed(),
                    },
                    `Transfer target variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold. ` +
                      `Possible fee discrepancy between source and target data.`
                  );
                } else if (warning.type === 'missing-price' && warning.data.feeAssetSymbol && warning.data.feeAmount) {
                  self.logger.warn(
                    {
                      txId: warning.data.txId,
                      linkId: warning.data.linkId,
                      feeAssetSymbol: warning.data.feeAssetSymbol,
                      feeAmount: warning.data.feeAmount.toFixed(),
                      date: warning.data.date,
                    },
                    'Fiat fee missing priceAtTxTime. Fee will not be added to cost basis. ' +
                      'Run "prices enrich" to normalize fiat currencies to USD.'
                  );
                }
              }

              assetState.lots.push(transferTargetResult.value.lot);
            }

            const explainedResidualQuantity = getExplainedResidualAcquisitionQuantity(
              transactionView,
              inflow,
              transactionAnnotationsByTransactionId.get(transactionView.processedTransaction.id),
              validatedTargetLinks
            );
            if (explainedResidualQuantity?.gt(0)) {
              const residualLotResult = buildExplainedResidualAcquisitionLotFromInflow(
                transactionView,
                inflow,
                explainedResidualQuantity,
                config.calculationId,
                config.strategy.getName()
              );
              if (residualLotResult.isErr()) {
                return yield* residualLotResult;
              }

              assetState.lots.push(residualLotResult.value);
            }

            continue;
          }

          if (carryoverTargets.length > 0) {
            for (const carryoverTarget of carryoverTargets) {
              const transfersForTarget = transfersByBindingKey.get(carryoverTarget.bindingKey) ?? [];
              const carryoverTargetResult = processInternalTransferCarryoverTarget(
                carryoverTarget.carryover,
                {
                  bindingKey: carryoverTarget.bindingKey,
                  target: carryoverTarget.target,
                },
                transfersForTarget,
                config.calculationId,
                config.strategy.getName()
              );
              if (carryoverTargetResult.isErr()) {
                return yield* carryoverTargetResult;
              }

              for (const warning of carryoverTargetResult.value.warnings) {
                if (warning.type === 'missing-price') {
                  return yield* err(
                    new Error(
                      `Carryover target fee missing price at tx ${warning.data.txId}: ` +
                        `${warning.data.feeAmount?.toFixed() ?? 'unknown'} ${warning.data.feeAssetSymbol ?? 'fee'}`
                    )
                  );
                }

                if (
                  warning.type === 'variance' &&
                  warning.data.variancePct &&
                  warning.data.transferred &&
                  warning.data.received
                ) {
                  self.logger.warn(
                    {
                      targetTxId: warning.data.targetTxId,
                      targetMovementFingerprint: warning.data.targetMovementFingerprint,
                      variancePct: warning.data.variancePct.toFixed(2),
                      transferred: warning.data.transferred.toFixed(),
                      received: warning.data.received.toFixed(),
                    },
                    `Carryover target variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold.`
                  );
                }
              }

              assetState.lots.push(carryoverTargetResult.value.lot);
            }

            continue;
          }

          const acquisitionResult = buildAcquisitionLotFromInflow(
            transactionView,
            inflow,
            config.calculationId,
            config.strategy.getName()
          );
          if (acquisitionResult.isErr()) {
            return yield* acquisitionResult;
          }
          assetState.lots.push(acquisitionResult.value);
        }
      }

      const assetResults: AssetLotMatchResult[] = [];
      for (const [assetId, state] of lotStateByAssetId) {
        assetResults.push({
          assetId,
          assetSymbol: state.assetSymbol,
          lots: state.lots,
          disposals: state.disposals,
          lotTransfers: state.lotTransfers,
        });
      }

      return {
        assetResults,
        totalLotsCreated: assetResults.reduce((sum, result) => sum + result.lots.length, 0),
        totalDisposalsProcessed: assetResults.reduce((sum, result) => sum + result.disposals.length, 0),
        totalTransfersProcessed: assetResults.reduce((sum, result) => sum + result.lotTransfers.length, 0),
      };
    }, this);
  }

  private prepareCarryovers(resolvedCarryovers: readonly ResolvedInternalTransferCarryover[]): Result<
    {
      carryoversBySourceTransactionId: Map<number, PreparedInternalTransferCarryover[]>;
      carryoversByTargetMovementFingerprint: Map<string, PreparedInternalTransferCarryoverTarget[]>;
    },
    Error
  > {
    const carryoversBySourceTransactionId = new Map<number, PreparedInternalTransferCarryover[]>();
    const carryoversByTargetMovementFingerprint = new Map<string, PreparedInternalTransferCarryoverTarget[]>();

    for (const carryover of resolvedCarryovers) {
      const targetBindings: InternalTransferCarryoverTargetBinding[] = [];
      for (const target of carryover.targets) {
        const bindingKey = this.getCarryoverBindingKey(
          carryover.source.movement.movementFingerprint,
          target.target.movement.movementFingerprint
        );
        targetBindings.push({ bindingKey, target });

        const existingTargets =
          carryoversByTargetMovementFingerprint.get(target.target.movement.movementFingerprint) ?? [];
        existingTargets.push({
          bindingKey,
          carryover,
          target,
        });
        carryoversByTargetMovementFingerprint.set(target.target.movement.movementFingerprint, existingTargets);
      }

      const sourceTransactionId = carryover.source.processedTransaction.id;
      const existingCarryovers = carryoversBySourceTransactionId.get(sourceTransactionId) ?? [];
      existingCarryovers.push({
        carryover,
        targetBindings,
      });
      carryoversBySourceTransactionId.set(sourceTransactionId, existingCarryovers);
    }

    return ok({
      carryoversBySourceTransactionId,
      carryoversByTargetMovementFingerprint,
    });
  }

  private getOrInitAssetState(
    assetId: string,
    assetSymbol: string,
    lotStateByAssetId: Map<string, AssetProcessingState>
  ): AssetProcessingState {
    let state = lotStateByAssetId.get(assetId);
    if (!state) {
      state = { assetSymbol, lots: [], disposals: [], lotTransfers: [] };
      lotStateByAssetId.set(assetId, state);
    }
    return state;
  }

  private findSourceLinks(
    validatedExternalLinks: ValidatedTransferSet,
    movementFingerprint: string
  ): ValidatedTransferLink[] {
    return validatedExternalLinks.bySourceMovementFingerprint.get(movementFingerprint) ?? [];
  }

  private findTargetLinks(
    validatedExternalLinks: ValidatedTransferSet,
    movementFingerprint: string
  ): ValidatedTransferLink[] {
    return validatedExternalLinks.byTargetMovementFingerprint.get(movementFingerprint) ?? [];
  }

  private getConfirmedLinkBindingKey(linkId: number): string {
    return `link:${linkId}`;
  }

  private getCarryoverBindingKey(sourceMovementFingerprint: string, targetMovementFingerprint: string): string {
    return `carryover:${sourceMovementFingerprint}:${targetMovementFingerprint}`;
  }

  private getTransferBindingKey(transfer: LotTransfer): string {
    if (transfer.provenance.kind === 'confirmed-link') {
      return this.getConfirmedLinkBindingKey(transfer.provenance.linkId);
    }

    return this.getCarryoverBindingKey(
      transfer.provenance.sourceMovementFingerprint,
      transfer.provenance.targetMovementFingerprint
    );
  }

  private pushTransfer(transfersByBindingKey: Map<string, LotTransfer[]>, transfer: LotTransfer): void {
    const bindingKey = this.getTransferBindingKey(transfer);
    const existing = transfersByBindingKey.get(bindingKey) ?? [];
    existing.push(transfer);
    transfersByBindingKey.set(bindingKey, existing);
  }
}
