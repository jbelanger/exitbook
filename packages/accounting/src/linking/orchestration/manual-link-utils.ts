import type { NewTransactionLink, OverrideLinkType, Transaction, TransactionLinkMetadata } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import { createTransactionLink } from '../matching/link-construction.js';
import type { LinkableMovement } from '../matching/linkable-movement.js';
import { buildLinkableMovements } from '../pre-linking/build-linkable-movements.js';
import type { PotentialMatch } from '../shared/types.js';
import { determineLinkType } from '../strategies/amount-timing-utils.js';

export interface BuildConfirmedLinkFromExactMovementsParams {
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

export function buildConfirmedLinkFromExactMovements(
  params: BuildConfirmedLinkFromExactMovementsParams
): Result<NewTransactionLink, Error> {
  return resultDo(function* () {
    const match: PotentialMatch = {
      sourceMovement: params.sourceMovement,
      targetMovement: params.targetMovement,
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

export function buildManualLinkOverrideMetadata(
  overrideId: string,
  overrideLinkType: OverrideLinkType
): TransactionLinkMetadata {
  return {
    overrideId,
    overrideLinkType,
  };
}
