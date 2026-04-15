import type { NewTransactionLink, OverrideLinkType, Transaction, TransactionLinkMetadata } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { createTransactionLink } from '../matching/link-construction.js';
import type { LinkableMovement } from '../matching/linkable-movement.js';
import { buildLinkableMovements } from '../pre-linking/build-linkable-movements.js';
import type { PotentialMatch } from '../shared/types.js';
import { determineLinkType } from '../strategies/amount-timing-utils.js';

export interface BuildConfirmedLinkFromExactMovementsParams {
  consumedAmount?: Decimal | undefined;
  metadata?: TransactionLinkMetadata | undefined;
  reviewedAt: Date;
  reviewedBy: string;
  sourceMovement: LinkableMovement;
  sourceTransaction: Pick<Transaction, 'platformKind'>;
  targetMovement: LinkableMovement;
  targetTransaction: Pick<Transaction, 'platformKind'>;
}

export interface PrepareManualLinkFromTransactionsParams {
  assetSymbol: Currency;
  metadata?: TransactionLinkMetadata | undefined;
  reviewedAt: Date;
  reviewedBy: string;
  sourceTransactionId: number;
  targetTransactionId: number;
  transactions: Transaction[];
}

export interface PreparedManualLink {
  link: NewTransactionLink;
  sourceMovement: LinkableMovement;
  sourceTransaction: Transaction;
  targetMovement: LinkableMovement;
  targetTransaction: Transaction;
}

export interface PrepareGroupedManualLinksFromTransactionsParams {
  assetSymbol: Currency;
  metadata?: TransactionLinkMetadata | undefined;
  reviewedAt: Date;
  reviewedBy: string;
  sourceTransactionIds: number[];
  targetTransactionIds: number[];
  transactions: Transaction[];
}

export interface PreparedGroupedManualLinks {
  entries: PreparedManualLink[];
  shape: 'many-to-one' | 'one-to-many';
}

export function buildConfirmedLinkFromExactMovements(
  params: BuildConfirmedLinkFromExactMovementsParams
): Result<NewTransactionLink, Error> {
  return resultDo(function* () {
    const match: PotentialMatch = {
      sourceMovement: params.sourceMovement,
      targetMovement: params.targetMovement,
      consumedAmount: params.consumedAmount,
      confidenceScore: parseDecimal('1'),
      matchCriteria: {
        assetMatch: true,
        amountSimilarity: parseDecimal('0'),
        timingValid: true,
        timingHours: 0,
      },
      linkType: determineLinkType(params.sourceTransaction.platformKind, params.targetTransaction.platformKind),
    };

    const link = yield* createTransactionLink(match, 'confirmed', params.reviewedAt);

    return {
      ...link,
      reviewedAt: params.reviewedAt,
      reviewedBy: params.reviewedBy,
      metadata: mergeLinkMetadata(link.metadata, params.metadata),
    };
  });
}

export function prepareManualLinkFromTransactions(
  params: PrepareManualLinkFromTransactionsParams,
  logger: Logger
): Result<PreparedManualLink, Error> {
  return resultDo(function* () {
    const sourceTransaction = yield* findTransactionById(params.transactions, params.sourceTransactionId, 'source');
    const targetTransaction = yield* findTransactionById(params.transactions, params.targetTransactionId, 'target');

    if (sourceTransaction.id === targetTransaction.id) {
      return yield* err(new Error('Manual links require two different transactions'));
    }

    const { linkableMovements } = yield* buildLinkableMovements(params.transactions, logger);
    const sourceMovement = yield* resolveManualLinkMovement(
      linkableMovements,
      sourceTransaction,
      params.assetSymbol,
      'out'
    );
    const targetMovement = yield* resolveManualLinkMovement(
      linkableMovements,
      targetTransaction,
      params.assetSymbol,
      'in'
    );
    const link = yield* buildConfirmedLinkFromExactMovements({
      sourceTransaction,
      targetTransaction,
      sourceMovement,
      targetMovement,
      reviewedAt: params.reviewedAt,
      reviewedBy: params.reviewedBy,
      metadata: params.metadata,
    });

    return {
      link,
      sourceMovement,
      sourceTransaction,
      targetMovement,
      targetTransaction,
    };
  });
}

export function prepareGroupedManualLinksFromTransactions(
  params: PrepareGroupedManualLinksFromTransactionsParams,
  logger: Logger
): Result<PreparedGroupedManualLinks, Error> {
  return resultDo(function* () {
    const sourceTransactionIds = yield* validateTransactionIdSelection(params.sourceTransactionIds, 'source');
    const targetTransactionIds = yield* validateTransactionIdSelection(params.targetTransactionIds, 'target');

    if (sourceTransactionIds.length === 1 && targetTransactionIds.length === 1) {
      return yield* err(new Error('Grouped manual links require one side to contain multiple transactions'));
    }

    if (sourceTransactionIds.length > 1 && targetTransactionIds.length > 1) {
      return yield* err(new Error('Grouped manual links currently support only many-to-one or one-to-many shapes'));
    }

    const overlappingTransactionId = sourceTransactionIds.find((transactionId) =>
      targetTransactionIds.includes(transactionId)
    );
    if (overlappingTransactionId !== undefined) {
      return yield* err(
        new Error(`Transaction ${overlappingTransactionId} cannot be both a grouped source and target`)
      );
    }

    const resolvedSourceTransactions = yield* collectResults(
      sourceTransactionIds.map((transactionId) => findTransactionById(params.transactions, transactionId, 'source'))
    );
    const resolvedTargetTransactions = yield* collectResults(
      targetTransactionIds.map((transactionId) => findTransactionById(params.transactions, transactionId, 'target'))
    );

    const { linkableMovements } = yield* buildLinkableMovements(params.transactions, logger);
    const sourceSelections = resolvedSourceTransactions.map((transaction) => ({
      movement: resolveManualLinkMovement(linkableMovements, transaction, params.assetSymbol, 'out'),
      transaction,
    }));
    const targetSelections = resolvedTargetTransactions.map((transaction) => ({
      movement: resolveManualLinkMovement(linkableMovements, transaction, params.assetSymbol, 'in'),
      transaction,
    }));

    const resolvedSourceSelections = yield* collectResults(
      sourceSelections.map((selection) =>
        selection.movement.isErr()
          ? err(selection.movement.error)
          : ok({
              movement: selection.movement.value,
              transaction: selection.transaction,
            })
      )
    );
    const resolvedTargetSelections = yield* collectResults(
      targetSelections.map((selection) =>
        selection.movement.isErr()
          ? err(selection.movement.error)
          : ok({
              movement: selection.movement.value,
              transaction: selection.transaction,
            })
      )
    );

    const totalSourceAmount = sumMovementAmounts(
      resolvedSourceSelections.map((selection) => selection.movement.amount)
    );
    const totalTargetAmount = sumMovementAmounts(
      resolvedTargetSelections.map((selection) => selection.movement.amount)
    );

    if (!totalSourceAmount.eq(totalTargetAmount)) {
      return yield* err(
        new Error(
          `Grouped manual links require exact conservation for ${params.assetSymbol}. Sources total ${totalSourceAmount.toFixed()} and targets total ${totalTargetAmount.toFixed()}`
        )
      );
    }

    if (resolvedSourceSelections.length > 1) {
      const targetSelection = resolvedTargetSelections[0]!;
      const entries = yield* collectResults(
        resolvedSourceSelections.map((sourceSelection) =>
          buildPreparedManualLink({
            sourceMovement: sourceSelection.movement,
            sourceTransaction: sourceSelection.transaction,
            targetMovement: targetSelection.movement,
            targetTransaction: targetSelection.transaction,
            consumedAmount: sourceSelection.movement.amount,
            reviewedAt: params.reviewedAt,
            reviewedBy: params.reviewedBy,
            metadata: params.metadata,
          })
        )
      );

      return {
        entries,
        shape: 'many-to-one',
      };
    }

    const sourceSelection = resolvedSourceSelections[0]!;
    const entries = yield* collectResults(
      resolvedTargetSelections.map((targetSelection) =>
        buildPreparedManualLink({
          sourceMovement: sourceSelection.movement,
          sourceTransaction: sourceSelection.transaction,
          targetMovement: targetSelection.movement,
          targetTransaction: targetSelection.transaction,
          consumedAmount: targetSelection.movement.amount,
          reviewedAt: params.reviewedAt,
          reviewedBy: params.reviewedBy,
          metadata: params.metadata,
        })
      )
    );

    return {
      entries,
      shape: 'one-to-many',
    };
  });
}

function findTransactionById(
  transactions: Transaction[],
  transactionId: number,
  label: 'source' | 'target'
): Result<Transaction, Error> {
  const transaction = transactions.find((candidate) => candidate.id === transactionId);
  if (!transaction) {
    return err(new Error(`Manual link ${label} transaction ${transactionId} not found in scoped transactions`));
  }

  return ok(transaction);
}

function resolveManualLinkMovement(
  linkableMovements: LinkableMovement[],
  transaction: Transaction,
  assetSymbol: Currency,
  direction: 'in' | 'out'
): Result<LinkableMovement, Error> {
  const candidates = linkableMovements.filter(
    (movement) =>
      movement.transactionId === transaction.id &&
      movement.direction === direction &&
      movement.assetSymbol === assetSymbol
  );

  if (candidates.length === 0) {
    return err(
      new Error(
        `Transaction ${transaction.txFingerprint} does not have a ${direction === 'out' ? 'send' : 'receive'} movement for ${assetSymbol}`
      )
    );
  }

  if (candidates.length > 1) {
    return err(
      new Error(
        `Transaction ${transaction.txFingerprint} has ${candidates.length} ${direction === 'out' ? 'outflow' : 'inflow'} movements for ${assetSymbol}; manual links require exactly one`
      )
    );
  }

  const movement = candidates[0]!;
  if (movement.excluded) {
    return err(
      new Error(
        `Transaction ${transaction.txFingerprint} ${direction === 'out' ? 'outflow' : 'inflow'} for ${assetSymbol} is excluded from linking`
      )
    );
  }

  return ok(movement);
}

function mergeLinkMetadata(
  base: TransactionLinkMetadata | undefined,
  extra: TransactionLinkMetadata | undefined
): TransactionLinkMetadata | undefined {
  if (!base && !extra) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
}

interface BuildPreparedManualLinkParams extends BuildConfirmedLinkFromExactMovementsParams {
  sourceTransaction: Transaction;
  targetTransaction: Transaction;
}

function buildPreparedManualLink(params: BuildPreparedManualLinkParams): Result<PreparedManualLink, Error> {
  return resultDo(function* () {
    const link = yield* buildConfirmedLinkFromExactMovements(params);

    return {
      link,
      sourceMovement: params.sourceMovement,
      sourceTransaction: params.sourceTransaction,
      targetMovement: params.targetMovement,
      targetTransaction: params.targetTransaction,
    };
  });
}

function validateTransactionIdSelection(transactionIds: number[], label: 'source' | 'target'): Result<number[], Error> {
  if (transactionIds.length === 0) {
    return err(new Error(`Grouped manual links require at least one ${label} transaction`));
  }

  const seenIds = new Set<number>();
  for (const transactionId of transactionIds) {
    if (seenIds.has(transactionId)) {
      return err(new Error(`Grouped manual links received duplicate ${label} transaction ${transactionId}`));
    }
    seenIds.add(transactionId);
  }

  return ok(transactionIds);
}

function sumMovementAmounts(amounts: Decimal[]): Decimal {
  return amounts.reduce((total, amount) => total.plus(amount), parseDecimal('0'));
}

function collectResults<T>(results: Result<T, Error>[]): Result<T[], Error> {
  const values: T[] = [];

  for (const result of results) {
    if (result.isErr()) {
      return err(result.error);
    }

    values.push(result.value);
  }

  return ok(values);
}

export function buildManualLinkOverrideMetadata(
  overrideId: string,
  overrideLinkType: OverrideLinkType
): TransactionLinkMetadata {
  return {
    overrideId,
    overrideLinkType,
    linkProvenance: 'manual',
  };
}
