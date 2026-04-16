import type { Transaction, TransactionLink } from '@exitbook/core';
import { isPartialMatchLinkMetadata, sumUniqueUnattributedStakingRewardComponents } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import { normalizeTransactionHash } from '../linking/strategies/exact-hash-utils.js';

interface TransferValidationMovementView {
  assetId: string;
  grossQuantity: Decimal;
  movementFingerprint: string;
  netQuantity?: Decimal | undefined;
}

export interface TransferValidationTransactionView {
  inflows: readonly TransferValidationMovementView[];
  outflows: readonly TransferValidationMovementView[];
  processedTransaction: Transaction;
}

export interface ValidatedTransferLink {
  isPartialMatch: boolean;
  link: TransactionLink;
  sourceAssetId: string;
  sourceMovementAmount: Decimal;
  sourceMovementFingerprint: string;
  targetAssetId: string;
  targetMovementAmount: Decimal;
  targetMovementFingerprint: string;
}

export interface ValidatedTransferSet {
  bySourceMovementFingerprint: Map<string, ValidatedTransferLink[]>;
  byTargetMovementFingerprint: Map<string, ValidatedTransferLink[]>;
  links: ValidatedTransferLink[];
}

interface AccountingMovementRef {
  movement: TransferValidationMovementView;
  transactionView: TransferValidationTransactionView;
}

export function validateTransferLinks(
  accountingTransactionViews: readonly TransferValidationTransactionView[],
  confirmedLinks: readonly TransactionLink[]
): Result<ValidatedTransferSet, Error> {
  const scopedTransactionIds = new Set(
    accountingTransactionViews.map((transactionView) => transactionView.processedTransaction.id)
  );
  const sourceMovementsResult = buildMovementIndex(accountingTransactionViews, 'outflow');
  if (sourceMovementsResult.isErr()) {
    return err(sourceMovementsResult.error);
  }

  const targetMovementsResult = buildMovementIndex(accountingTransactionViews, 'inflow');
  if (targetMovementsResult.isErr()) {
    return err(targetMovementsResult.error);
  }

  const sourceMovementsByFingerprint = sourceMovementsResult.value;
  const targetMovementsByFingerprint = targetMovementsResult.value;

  const links: ValidatedTransferLink[] = [];
  const bySourceMovementFingerprint = new Map<string, ValidatedTransferLink[]>();
  const byTargetMovementFingerprint = new Map<string, ValidatedTransferLink[]>();

  for (const link of confirmedLinks) {
    if (link.status !== 'confirmed') continue;
    if (link.linkType === 'blockchain_internal') continue;

    const sourceInScope = scopedTransactionIds.has(link.sourceTransactionId);
    const targetInScope = scopedTransactionIds.has(link.targetTransactionId);

    if (!sourceInScope && !targetInScope) {
      continue;
    }
    if (!sourceInScope || !targetInScope) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} crosses the accounting transaction boundary: ` +
            `source tx ${link.sourceTransactionId} in scope=${String(sourceInScope)}, ` +
            `target tx ${link.targetTransactionId} in scope=${String(targetInScope)}`
        )
      );
    }

    const sourceRef = sourceMovementsByFingerprint.get(link.sourceMovementFingerprint);
    if (!sourceRef) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} references unknown accounting source movement ` +
            `${link.sourceMovementFingerprint} (tx ${link.sourceTransactionId})`
        )
      );
    }

    const targetRef = targetMovementsByFingerprint.get(link.targetMovementFingerprint);
    if (!targetRef) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} references unknown accounting target movement ` +
            `${link.targetMovementFingerprint} (tx ${link.targetTransactionId})`
        )
      );
    }

    if (sourceRef.transactionView.processedTransaction.id !== link.sourceTransactionId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} source transaction mismatch: ` +
            `movement ${link.sourceMovementFingerprint} belongs to tx ` +
            `${sourceRef.transactionView.processedTransaction.id}, link points to tx ${link.sourceTransactionId}`
        )
      );
    }

    if (targetRef.transactionView.processedTransaction.id !== link.targetTransactionId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} target transaction mismatch: ` +
            `movement ${link.targetMovementFingerprint} belongs to tx ` +
            `${targetRef.transactionView.processedTransaction.id}, link points to tx ${link.targetTransactionId}`
        )
      );
    }

    if (sourceRef.movement.assetId !== link.sourceAssetId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} source asset mismatch: ` +
            `accounting movement ${link.sourceMovementFingerprint} has assetId ${sourceRef.movement.assetId}, ` +
            `link has ${link.sourceAssetId}`
        )
      );
    }

    if (targetRef.movement.assetId !== link.targetAssetId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} target asset mismatch: ` +
            `accounting movement ${link.targetMovementFingerprint} has assetId ${targetRef.movement.assetId}, ` +
            `link has ${link.targetAssetId}`
        )
      );
    }

    const isPartialMatch = isPartialMatchLinkMetadata(link.metadata);
    const sourceMovementAmount = getTransferMovementAmount(sourceRef.movement);
    const targetMovementAmount = getTransferMovementAmount(targetRef.movement);

    if (!isPartialMatch) {
      if (!link.sourceAmount.eq(sourceMovementAmount)) {
        return err(
          new Error(
            `Confirmed transfer link ${link.id} source amount mismatch: ` +
              `link amount ${link.sourceAmount.toFixed()} does not match accounting movement amount ` +
              `${sourceMovementAmount.toFixed()} for ${link.sourceMovementFingerprint}`
          )
        );
      }

      if (!link.targetAmount.eq(targetMovementAmount)) {
        return err(
          new Error(
            `Confirmed transfer link ${link.id} target amount mismatch: ` +
              `link amount ${link.targetAmount.toFixed()} does not match accounting movement amount ` +
              `${targetMovementAmount.toFixed()} for ${link.targetMovementFingerprint}`
          )
        );
      }
    } else {
      const sourceWithinBounds = link.sourceAmount.gt(0) && link.sourceAmount.lte(sourceMovementAmount);
      if (!sourceWithinBounds) {
        return err(
          new Error(
            `Confirmed partial transfer link ${link.id} has invalid source amount ${link.sourceAmount.toFixed()} ` +
              `for accounting movement ${link.sourceMovementFingerprint} with amount ${sourceMovementAmount.toFixed()}`
          )
        );
      }

      const targetWithinBounds = link.targetAmount.gt(0) && link.targetAmount.lte(targetMovementAmount);
      if (!targetWithinBounds) {
        return err(
          new Error(
            `Confirmed partial transfer link ${link.id} has invalid target amount ${link.targetAmount.toFixed()} ` +
              `for accounting movement ${link.targetMovementFingerprint} with amount ${targetMovementAmount.toFixed()}`
          )
        );
      }
    }

    const validatedLink: ValidatedTransferLink = {
      isPartialMatch,
      link,
      sourceAssetId: sourceRef.movement.assetId,
      sourceMovementAmount,
      sourceMovementFingerprint: sourceRef.movement.movementFingerprint,
      targetAssetId: targetRef.movement.assetId,
      targetMovementAmount,
      targetMovementFingerprint: targetRef.movement.movementFingerprint,
    };

    links.push(validatedLink);
    pushIndexedLink(bySourceMovementFingerprint, validatedLink.sourceMovementFingerprint, validatedLink);
    pushIndexedLink(byTargetMovementFingerprint, validatedLink.targetMovementFingerprint, validatedLink);
  }

  const sourceValidationResult = validateGroupedMovementLinks(
    bySourceMovementFingerprint,
    'source',
    (validatedLink) => validatedLink.link.sourceAmount,
    (validatedLink) => validatedLink.sourceMovementAmount
  );
  if (sourceValidationResult.isErr()) {
    return err(sourceValidationResult.error);
  }

  const targetValidationResult = validateTargetMovementLinks(byTargetMovementFingerprint, accountingTransactionViews);
  if (targetValidationResult.isErr()) {
    return err(targetValidationResult.error);
  }

  return ok({
    bySourceMovementFingerprint,
    byTargetMovementFingerprint,
    links,
  });
}

function buildMovementIndex(
  accountingTransactionViews: readonly TransferValidationTransactionView[],
  movementType: 'inflow' | 'outflow'
): Result<Map<string, AccountingMovementRef>, Error> {
  const movementIndex = new Map<string, AccountingMovementRef>();

  for (const transactionView of accountingTransactionViews) {
    const movements = movementType === 'inflow' ? transactionView.inflows : transactionView.outflows;

    for (const movement of movements) {
      const existing = movementIndex.get(movement.movementFingerprint);
      if (existing) {
        return err(
          new Error(
            `Duplicate accounting ${movementType} movement fingerprint ${movement.movementFingerprint} ` +
              `for transactions ${existing.transactionView.processedTransaction.id} and ` +
              `${transactionView.processedTransaction.id}`
          )
        );
      }

      movementIndex.set(movement.movementFingerprint, {
        movement,
        transactionView,
      });
    }
  }

  return ok(movementIndex);
}

function getTransferMovementAmount(movement: TransferValidationMovementView): Decimal {
  return movement.netQuantity ?? movement.grossQuantity;
}

function pushIndexedLink(
  index: Map<string, ValidatedTransferLink[]>,
  fingerprint: string,
  validatedLink: ValidatedTransferLink
): void {
  const existing = index.get(fingerprint) ?? [];
  existing.push(validatedLink);
  index.set(fingerprint, existing);
}

function validateGroupedMovementLinks(
  index: Map<string, ValidatedTransferLink[]>,
  side: 'source' | 'target',
  amountSelector: (validatedLink: ValidatedTransferLink) => Decimal,
  movementAmountSelector: (validatedLink: ValidatedTransferLink) => Decimal
): Result<void, Error> {
  for (const [fingerprint, validatedLinks] of index) {
    if (validatedLinks.length === 0) continue;

    const partialLinks = validatedLinks.filter((validatedLink) => validatedLink.isPartialMatch);
    const isPartialGroup = partialLinks.length > 0;

    if (!isPartialGroup) {
      if (validatedLinks.length !== 1) {
        return err(
          new Error(
            `Confirmed transfer validation failed for ${side} movement ${fingerprint}: ` +
              `expected exactly one full link, found ${validatedLinks.length}`
          )
        );
      }
      continue;
    }

    if (partialLinks.length !== validatedLinks.length) {
      return err(
        new Error(
          `Confirmed transfer validation failed for ${side} movement ${fingerprint}: ` +
            `partial and full links are mixed for the same movement`
        )
      );
    }

    const fullMovementAmount = movementAmountSelector(validatedLinks[0]!);
    const totalLinkedAmount = validatedLinks.reduce(
      (sum, validatedLink) => sum.plus(amountSelector(validatedLink)),
      new Decimal(0)
    );

    if (!totalLinkedAmount.eq(fullMovementAmount)) {
      return err(
        new Error(
          `Confirmed partial transfer validation failed for ${side} movement ${fingerprint}: ` +
            `linked total ${totalLinkedAmount.toFixed()} does not reconcile with accounting movement amount ` +
            `${fullMovementAmount.toFixed()}`
        )
      );
    }
  }

  return ok(undefined);
}

function validateTargetMovementLinks(
  index: Map<string, ValidatedTransferLink[]>,
  accountingTransactionViews: readonly TransferValidationTransactionView[]
): Result<void, Error> {
  const transactionViewsById = new Map(
    accountingTransactionViews.map((transactionView) => [transactionView.processedTransaction.id, transactionView])
  );

  for (const [fingerprint, validatedLinks] of index) {
    if (validatedLinks.length === 0) continue;

    const partialLinks = validatedLinks.filter((validatedLink) => validatedLink.isPartialMatch);
    const isPartialGroup = partialLinks.length > 0;

    if (!isPartialGroup) {
      if (validatedLinks.length !== 1) {
        return err(
          new Error(
            `Confirmed transfer validation failed for target movement ${fingerprint}: ` +
              `expected exactly one full link, found ${validatedLinks.length}`
          )
        );
      }
      continue;
    }

    if (partialLinks.length !== validatedLinks.length) {
      return err(
        new Error(
          `Confirmed transfer validation failed for target movement ${fingerprint}: ` +
            `partial and full links are mixed for the same movement`
        )
      );
    }

    const fullMovementAmount = validatedLinks[0]!.targetMovementAmount;
    const totalLinkedAmount = validatedLinks.reduce(
      (sum, validatedLink) => sum.plus(validatedLink.link.targetAmount),
      new Decimal(0)
    );

    if (totalLinkedAmount.eq(fullMovementAmount)) {
      continue;
    }

    const allowedResidualResult = getAllowedExplainedTargetResidual(
      validatedLinks,
      transactionViewsById,
      fullMovementAmount.minus(totalLinkedAmount)
    );
    if (allowedResidualResult.isErr()) {
      return err(allowedResidualResult.error);
    }

    if (allowedResidualResult.value) {
      continue;
    }

    return err(
      new Error(
        `Confirmed partial transfer validation failed for target movement ${fingerprint}: ` +
          `linked total ${totalLinkedAmount.toFixed()} does not reconcile with accounting movement amount ` +
          `${fullMovementAmount.toFixed()}`
      )
    );
  }

  return ok(undefined);
}

function getAllowedExplainedTargetResidual(
  validatedLinks: readonly ValidatedTransferLink[],
  transactionViewsById: Map<number, TransferValidationTransactionView>,
  residualAmount: Decimal
): Result<boolean, Error> {
  if (!residualAmount.gt(0)) {
    return ok(false);
  }

  const targetTransactionView = transactionViewsById.get(validatedLinks[0]!.link.targetTransactionId);
  if (!targetTransactionView) {
    return err(new Error(`Missing accounting target transaction ${validatedLinks[0]!.link.targetTransactionId}`));
  }

  const targetTx = targetTransactionView.processedTransaction;
  if (targetTx.platformKind !== 'exchange') {
    return ok(false);
  }

  const targetHash = targetTx.blockchain?.transaction_hash
    ? normalizeTransactionHash(targetTx.blockchain.transaction_hash)
    : undefined;
  if (!targetHash) {
    return ok(false);
  }

  const sourceTransactions = [];
  const seenSourceIds = new Set<number>();

  for (const validatedLink of validatedLinks) {
    if (seenSourceIds.has(validatedLink.link.sourceTransactionId)) {
      continue;
    }

    const sourceTransactionView = transactionViewsById.get(validatedLink.link.sourceTransactionId);
    if (!sourceTransactionView) {
      return err(new Error(`Missing accounting source transaction ${validatedLink.link.sourceTransactionId}`));
    }

    const sourceTx = sourceTransactionView.processedTransaction;
    if (sourceTx.platformKind !== 'blockchain') {
      return ok(false);
    }

    const sourceHash = sourceTx.blockchain?.transaction_hash
      ? normalizeTransactionHash(sourceTx.blockchain.transaction_hash)
      : undefined;
    if (!sourceHash || sourceHash !== targetHash) {
      return ok(false);
    }

    seenSourceIds.add(validatedLink.link.sourceTransactionId);
    sourceTransactions.push(sourceTx);
  }

  if (sourceTransactions.length === 0) {
    return ok(false);
  }

  const explainedResidualAmount = sumUniqueUnattributedStakingRewardComponents(
    sourceTransactions.map((sourceTx) => sourceTx.diagnostics),
    validatedLinks[0]!.link.assetSymbol
  );

  return ok(explainedResidualAmount.eq(residualAmount));
}
