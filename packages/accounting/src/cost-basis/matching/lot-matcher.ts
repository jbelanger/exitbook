import { isFiat, wrapError } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import {
  processFeeOnlyInternalCarryoverSource,
  processFeeOnlyInternalCarryoverTarget,
  type CarryoverTargetBinding,
} from '../lots/internal-carryover-processing-utils.js';
import { buildAcquisitionLotFromInflow } from '../lots/lot-creation-utils.js';
import { matchOutflowDisposal } from '../lots/lot-disposal-utils.js';
import { sortTransactionsByDependency, type TransactionDependencyEdge } from '../lots/lot-sorting-utils.js';
import { processTransferSource, processTransferTarget } from '../lots/lot-transfer-processing-utils.js';
import type { AcquisitionLot, LotDisposal, LotTransfer } from '../shared/schemas.js';
import type { ICostBasisStrategy } from '../strategies/base-strategy.js';

import type {
  AccountingScopedBuildResult,
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  FeeOnlyInternalCarryoverTarget,
} from './build-accounting-scoped-transactions.js';
import type { ValidatedScopedTransferLink, ValidatedScopedTransferSet } from './validated-scoped-transfer-links.js';

/**
 * Configuration for lot matching
 */
export interface LotMatcherConfig {
  /** Calculation ID to associate lots with */
  calculationId: string;
  /** Cost basis strategy to use (FIFO, LIFO, etc.) */
  strategy: ICostBasisStrategy;
  /** Jurisdiction configuration for tax policy (required for transfer handling) */
  jurisdiction?:
    | {
        sameAssetTransferFeePolicy: 'disposal' | 'add-to-basis';
      }
    | undefined;
  /** Optional variance tolerance override */
  varianceTolerance?: { error: number; warn: number } | undefined;
}

/**
 * Result of lot matching for a single asset
 */
export interface AssetLotMatchResult {
  /** Asset ID (contract-level identifier) */
  assetId: string;
  /** Asset symbol (display name) */
  assetSymbol: string;
  /** Acquisition lots created */
  lots: AcquisitionLot[];
  /** Disposals matched to lots */
  disposals: LotDisposal[];
  /** Lot transfers (for cross-transaction cost basis tracking) */
  lotTransfers: LotTransfer[];
}

/**
 * Result of lot matching across all assets
 */
export interface LotMatchResult {
  /** Results grouped by asset */
  assetResults: AssetLotMatchResult[];
  /** Total number of acquisition lots created */
  totalLotsCreated: number;
  /** Total number of disposals processed */
  totalDisposalsProcessed: number;
  /** Total number of transfers processed */
  totalTransfersProcessed: number;
}

interface AssetProcessingState {
  assetSymbol: string;
  disposals: LotDisposal[];
  lotTransfers: LotTransfer[];
  lots: AcquisitionLot[];
}

interface PreparedCarryover {
  carryover: FeeOnlyInternalCarryover;
  sourceTransaction: AccountingScopedTransaction;
  targetBindings: CarryoverTargetBinding[];
}

interface PreparedCarryoverTarget {
  carryover: FeeOnlyInternalCarryover;
  sourceTransaction: AccountingScopedTransaction;
  bindingKey: string;
  target: FeeOnlyInternalCarryoverTarget;
}

export class LotMatcher {
  private readonly logger = getLogger('LotMatcher');

  async match(
    scopedBuildResult: AccountingScopedBuildResult,
    validatedExternalLinks: ValidatedScopedTransferSet,
    config: LotMatcherConfig
  ): Promise<Result<LotMatchResult, Error>> {
    try {
      if (
        (validatedExternalLinks.links.length > 0 || scopedBuildResult.feeOnlyInternalCarryovers.length > 0) &&
        !config.jurisdiction
      ) {
        return err(new Error('Jurisdiction configuration is required for transfer and carryover handling'));
      }

      const scopedByTxId = new Map(
        scopedBuildResult.transactions.map((scopedTransaction) => [scopedTransaction.tx.id, scopedTransaction])
      );
      const carryoverPreparationResult = this.prepareCarryovers(scopedBuildResult, scopedByTxId);
      if (carryoverPreparationResult.isErr()) {
        return err(carryoverPreparationResult.error);
      }

      const { carryoversBySourceTransactionId, carryoversByTargetMovementFingerprint } =
        carryoverPreparationResult.value;

      const dependencyEdges: TransactionDependencyEdge[] = [
        ...validatedExternalLinks.links.map((validatedLink) => ({
          sourceTransactionId: validatedLink.link.sourceTransactionId,
          targetTransactionId: validatedLink.link.targetTransactionId,
        })),
        ...scopedBuildResult.feeOnlyInternalCarryovers.flatMap((carryover) =>
          carryover.targets.map((target) => ({
            sourceTransactionId: carryover.sourceTransactionId,
            targetTransactionId: target.targetTransactionId,
          }))
        ),
      ];

      const sortResult = sortTransactionsByDependency(
        scopedBuildResult.transactions.map((scopedTransaction) => scopedTransaction.tx),
        dependencyEdges
      );
      if (sortResult.isErr()) {
        return err(sortResult.error);
      }

      const sortedScopedTransactions: AccountingScopedTransaction[] = [];
      for (const transaction of sortResult.value) {
        const scopedTransaction = scopedByTxId.get(transaction.id);
        if (!scopedTransaction) {
          return err(new Error(`Scoped transaction ${transaction.id} not found after dependency sorting`));
        }
        sortedScopedTransactions.push(scopedTransaction);
      }

      const lotStateByAssetId = new Map<string, AssetProcessingState>();
      const transfersByBindingKey = new Map<string, LotTransfer[]>();

      for (const scopedTransaction of sortedScopedTransactions) {
        const carryoversForSource = carryoversBySourceTransactionId.get(scopedTransaction.tx.id) ?? [];
        for (const preparedCarryover of carryoversForSource) {
          const assetState = this.getOrInitAssetState(
            preparedCarryover.carryover.assetId,
            preparedCarryover.carryover.assetSymbol,
            lotStateByAssetId
          );

          const carryoverSourceResult = processFeeOnlyInternalCarryoverSource(
            preparedCarryover.sourceTransaction,
            preparedCarryover.carryover,
            preparedCarryover.targetBindings,
            assetState.lots,
            config.strategy,
            config.calculationId,
            config.jurisdiction!
          );
          if (carryoverSourceResult.isErr()) {
            return err(carryoverSourceResult.error);
          }

          for (const warning of carryoverSourceResult.value.warnings) {
            return err(
              new Error(
                `Carryover fee price missing at tx ${preparedCarryover.sourceTransaction.tx.id}: ` +
                  `${warning.data.feeAmount?.toFixed() ?? 'unknown'} ${preparedCarryover.carryover.assetSymbol}`
              )
            );
          }

          assetState.disposals.push(...carryoverSourceResult.value.disposals);
          assetState.lots.splice(0, assetState.lots.length, ...carryoverSourceResult.value.updatedLots);
          for (const transfer of carryoverSourceResult.value.transfers) {
            assetState.lotTransfers.push(transfer);
            this.pushTransfer(transfersByBindingKey, transfer);
          }
        }

        for (const outflow of scopedTransaction.movements.outflows) {
          if (isFiat(outflow.assetSymbol)) continue;

          const assetState = this.getOrInitAssetState(outflow.assetId, outflow.assetSymbol, lotStateByAssetId);
          const sourceLinks = this.findSourceLinks(validatedExternalLinks, outflow.movementFingerprint);

          if (sourceLinks.length === 0) {
            const disposalResult = matchOutflowDisposal(scopedTransaction, outflow, assetState.lots, config.strategy);
            if (disposalResult.isErr()) {
              return err(disposalResult.error);
            }
            assetState.disposals.push(...disposalResult.value.disposals);
            assetState.lots.splice(0, assetState.lots.length, ...disposalResult.value.updatedLots);
            continue;
          }

          const transferResult = processTransferSource(
            scopedTransaction,
            outflow,
            sourceLinks,
            assetState.lots,
            config.strategy,
            config.calculationId,
            config.jurisdiction!,
            config.varianceTolerance
          );
          if (transferResult.isErr()) {
            return err(transferResult.error);
          }

          for (const warning of transferResult.value.warnings) {
            if (
              warning.type === 'variance' &&
              warning.data.variancePct &&
              warning.data.linkedSourceAmount &&
              warning.data.linkTargetAmount
            ) {
              const tolerance = config.varianceTolerance?.warn ?? 1.0;
              this.logger.warn(
                {
                  txId: scopedTransaction.tx.id,
                  linkId: warning.data.linkId,
                  assetSymbol: warning.data.assetSymbol,
                  variancePct: warning.data.variancePct.toFixed(2),
                  linkedSourceAmount: warning.data.linkedSourceAmount.toFixed(),
                  linkTargetAmount: warning.data.linkTargetAmount.toFixed(),
                  source: scopedTransaction.tx.source,
                },
                `Transfer variance (${warning.data.variancePct.toFixed(2)}%) exceeds warning threshold (${tolerance.toFixed()}). ` +
                  `Possible hidden fees or incomplete fee metadata. Review exchange fee policies.`
              );
            } else if (warning.type === 'missing-price' && warning.data.feeAmount) {
              this.logger.warn(
                {
                  txId: scopedTransaction.tx.id,
                  linkId: warning.data.linkId,
                  assetSymbol: warning.data.assetSymbol,
                  feeAmount: warning.data.feeAmount.toFixed(),
                  date: scopedTransaction.tx.datetime,
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
            this.pushTransfer(transfersByBindingKey, transfer);
          }
        }

        for (const inflow of scopedTransaction.movements.inflows) {
          if (isFiat(inflow.assetSymbol)) continue;

          const validatedTargetLinks = this.findTargetLinks(validatedExternalLinks, inflow.movementFingerprint);
          const carryoverTargets = carryoversByTargetMovementFingerprint.get(inflow.movementFingerprint) ?? [];

          if (validatedTargetLinks.length > 0 && carryoverTargets.length > 0) {
            return err(
              new Error(
                `Movement ${inflow.movementFingerprint} is targeted by both validated transfer links and fee-only carryovers`
              )
            );
          }

          const assetState = this.getOrInitAssetState(inflow.assetId, inflow.assetSymbol, lotStateByAssetId);

          if (validatedTargetLinks.length > 0) {
            for (const validatedLink of validatedTargetLinks) {
              const sourceTransaction = scopedByTxId.get(validatedLink.link.sourceTransactionId);
              if (!sourceTransaction) {
                return err(new Error(`Source transaction ${validatedLink.link.sourceTransactionId} not found`));
              }

              const transfersForLink =
                transfersByBindingKey.get(this.getConfirmedLinkBindingKey(validatedLink.link.id)) ?? [];
              const transferTargetResult = processTransferTarget(
                scopedTransaction,
                inflow,
                validatedLink,
                sourceTransaction,
                transfersForLink,
                config.calculationId,
                config.strategy.getName(),
                config.varianceTolerance
              );
              if (transferTargetResult.isErr()) {
                return err(transferTargetResult.error);
              }

              for (const warning of transferTargetResult.value.warnings) {
                if (warning.type === 'no-transfers') {
                  this.logger.error(
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
                  this.logger.warn(
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
                  this.logger.warn(
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

            continue;
          }

          if (carryoverTargets.length > 0) {
            for (const carryoverTarget of carryoverTargets) {
              const transfersForTarget = transfersByBindingKey.get(carryoverTarget.bindingKey) ?? [];
              const carryoverTargetResult = processFeeOnlyInternalCarryoverTarget(
                carryoverTarget.sourceTransaction,
                scopedTransaction,
                carryoverTarget.carryover,
                carryoverTarget.target,
                carryoverTarget.bindingKey,
                transfersForTarget,
                config.calculationId,
                config.strategy.getName()
              );
              if (carryoverTargetResult.isErr()) {
                return err(carryoverTargetResult.error);
              }

              for (const warning of carryoverTargetResult.value.warnings) {
                if (warning.type === 'missing-price') {
                  return err(
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
                  this.logger.warn(
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
            scopedTransaction,
            inflow,
            config.calculationId,
            config.strategy.getName()
          );
          if (acquisitionResult.isErr()) {
            return err(acquisitionResult.error);
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

      return ok({
        assetResults,
        totalLotsCreated: assetResults.reduce((sum, result) => sum + result.lots.length, 0),
        totalDisposalsProcessed: assetResults.reduce((sum, result) => sum + result.disposals.length, 0),
        totalTransfersProcessed: assetResults.reduce((sum, result) => sum + result.lotTransfers.length, 0),
      });
    } catch (error) {
      return wrapError(error, 'Failed to match lots');
    }
  }

  private prepareCarryovers(
    scopedBuildResult: AccountingScopedBuildResult,
    scopedByTxId: Map<number, AccountingScopedTransaction>
  ): Result<
    {
      carryoversBySourceTransactionId: Map<number, PreparedCarryover[]>;
      carryoversByTargetMovementFingerprint: Map<string, PreparedCarryoverTarget[]>;
    },
    Error
  > {
    const carryoversBySourceTransactionId = new Map<number, PreparedCarryover[]>();
    const carryoversByTargetMovementFingerprint = new Map<string, PreparedCarryoverTarget[]>();

    for (const carryover of scopedBuildResult.feeOnlyInternalCarryovers) {
      const sourceTransaction = scopedByTxId.get(carryover.sourceTransactionId);
      if (!sourceTransaction) {
        return err(new Error(`Carryover source transaction ${carryover.sourceTransactionId} not found`));
      }

      const targetBindings: CarryoverTargetBinding[] = [];
      for (const target of carryover.targets) {
        const bindingKey = this.getCarryoverBindingKey(
          carryover.sourceMovementFingerprint,
          target.targetMovementFingerprint
        );
        targetBindings.push({ bindingKey, target });

        const preparedTarget: PreparedCarryoverTarget = {
          carryover,
          sourceTransaction,
          bindingKey,
          target,
        };

        const existingTargets = carryoversByTargetMovementFingerprint.get(target.targetMovementFingerprint) ?? [];
        existingTargets.push(preparedTarget);
        carryoversByTargetMovementFingerprint.set(target.targetMovementFingerprint, existingTargets);
      }

      const existingCarryovers = carryoversBySourceTransactionId.get(carryover.sourceTransactionId) ?? [];
      existingCarryovers.push({
        carryover,
        sourceTransaction,
        targetBindings,
      });
      carryoversBySourceTransactionId.set(carryover.sourceTransactionId, existingCarryovers);
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
    validatedExternalLinks: ValidatedScopedTransferSet,
    movementFingerprint: string
  ): ValidatedScopedTransferLink[] {
    return validatedExternalLinks.bySourceMovementFingerprint.get(movementFingerprint) ?? [];
  }

  private findTargetLinks(
    validatedExternalLinks: ValidatedScopedTransferSet,
    movementFingerprint: string
  ): ValidatedScopedTransferLink[] {
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
