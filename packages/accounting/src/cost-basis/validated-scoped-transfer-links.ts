import type { TransactionLink } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AccountingScopedTransaction, ScopedAssetMovement } from './build-accounting-scoped-transactions.js';

export interface ValidatedScopedTransferLink {
  isPartialMatch: boolean;
  link: TransactionLink;
  sourceAssetId: string;
  sourceMovementAmount: Decimal;
  sourceMovementFingerprint: string;
  targetAssetId: string;
  targetMovementAmount: Decimal;
  targetMovementFingerprint: string;
}

export interface ValidatedScopedTransferSet {
  bySourceMovementFingerprint: Map<string, ValidatedScopedTransferLink[]>;
  byTargetMovementFingerprint: Map<string, ValidatedScopedTransferLink[]>;
  links: ValidatedScopedTransferLink[];
}

interface ScopedMovementRef {
  movement: ScopedAssetMovement;
  transactionId: number;
}

export function validateScopedTransferLinks(
  scopedTransactions: AccountingScopedTransaction[],
  confirmedLinks: TransactionLink[]
): Result<ValidatedScopedTransferSet, Error> {
  const scopedTransactionIds = new Set(scopedTransactions.map((scopedTx) => scopedTx.tx.id));
  const sourceMovementsResult = buildMovementIndex(scopedTransactions, 'outflow');
  if (sourceMovementsResult.isErr()) {
    return err(sourceMovementsResult.error);
  }

  const targetMovementsResult = buildMovementIndex(scopedTransactions, 'inflow');
  if (targetMovementsResult.isErr()) {
    return err(targetMovementsResult.error);
  }

  const sourceMovementsByFingerprint = sourceMovementsResult.value;
  const targetMovementsByFingerprint = targetMovementsResult.value;

  const links: ValidatedScopedTransferLink[] = [];
  const bySourceMovementFingerprint = new Map<string, ValidatedScopedTransferLink[]>();
  const byTargetMovementFingerprint = new Map<string, ValidatedScopedTransferLink[]>();

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
          `Confirmed transfer link ${link.id} crosses the scoped transaction boundary: ` +
            `source tx ${link.sourceTransactionId} in scope=${String(sourceInScope)}, ` +
            `target tx ${link.targetTransactionId} in scope=${String(targetInScope)}`
        )
      );
    }

    const sourceRef = sourceMovementsByFingerprint.get(link.sourceMovementFingerprint);
    if (!sourceRef) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} references unknown scoped source movement ` +
            `${link.sourceMovementFingerprint} (tx ${link.sourceTransactionId})`
        )
      );
    }

    const targetRef = targetMovementsByFingerprint.get(link.targetMovementFingerprint);
    if (!targetRef) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} references unknown scoped target movement ` +
            `${link.targetMovementFingerprint} (tx ${link.targetTransactionId})`
        )
      );
    }

    if (sourceRef.transactionId !== link.sourceTransactionId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} source transaction mismatch: ` +
            `movement ${link.sourceMovementFingerprint} belongs to tx ${sourceRef.transactionId}, ` +
            `link points to tx ${link.sourceTransactionId}`
        )
      );
    }

    if (targetRef.transactionId !== link.targetTransactionId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} target transaction mismatch: ` +
            `movement ${link.targetMovementFingerprint} belongs to tx ${targetRef.transactionId}, ` +
            `link points to tx ${link.targetTransactionId}`
        )
      );
    }

    if (sourceRef.movement.assetId !== link.sourceAssetId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} source asset mismatch: ` +
            `scoped movement ${link.sourceMovementFingerprint} has assetId ${sourceRef.movement.assetId}, ` +
            `link has ${link.sourceAssetId}`
        )
      );
    }

    if (targetRef.movement.assetId !== link.targetAssetId) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} target asset mismatch: ` +
            `scoped movement ${link.targetMovementFingerprint} has assetId ${targetRef.movement.assetId}, ` +
            `link has ${link.targetAssetId}`
        )
      );
    }

    if (sourceRef.movement.assetSymbol !== link.assetSymbol) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} source symbol mismatch: ` +
            `scoped movement ${link.sourceMovementFingerprint} has symbol ${sourceRef.movement.assetSymbol}, ` +
            `link has ${link.assetSymbol}`
        )
      );
    }

    if (targetRef.movement.assetSymbol !== link.assetSymbol) {
      return err(
        new Error(
          `Confirmed transfer link ${link.id} target symbol mismatch: ` +
            `scoped movement ${link.targetMovementFingerprint} has symbol ${targetRef.movement.assetSymbol}, ` +
            `link has ${link.assetSymbol}`
        )
      );
    }

    const isPartialMatch = link.metadata?.['partialMatch'] === true;
    const sourceMovementAmount = getTransferMovementAmount(sourceRef.movement);
    const targetMovementAmount = getTransferMovementAmount(targetRef.movement);

    if (!isPartialMatch) {
      if (!link.sourceAmount.eq(sourceMovementAmount)) {
        return err(
          new Error(
            `Confirmed transfer link ${link.id} source amount mismatch: ` +
              `link amount ${link.sourceAmount.toFixed()} does not match scoped movement amount ` +
              `${sourceMovementAmount.toFixed()} for ${link.sourceMovementFingerprint}`
          )
        );
      }

      if (!link.targetAmount.eq(targetMovementAmount)) {
        return err(
          new Error(
            `Confirmed transfer link ${link.id} target amount mismatch: ` +
              `link amount ${link.targetAmount.toFixed()} does not match scoped movement amount ` +
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
              `for scoped movement ${link.sourceMovementFingerprint} with amount ${sourceMovementAmount.toFixed()}`
          )
        );
      }

      const targetWithinBounds = link.targetAmount.gt(0) && link.targetAmount.lte(targetMovementAmount);
      if (!targetWithinBounds) {
        return err(
          new Error(
            `Confirmed partial transfer link ${link.id} has invalid target amount ${link.targetAmount.toFixed()} ` +
              `for scoped movement ${link.targetMovementFingerprint} with amount ${targetMovementAmount.toFixed()}`
          )
        );
      }
    }

    const validatedLink: ValidatedScopedTransferLink = {
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

  const targetValidationResult = validateGroupedMovementLinks(
    byTargetMovementFingerprint,
    'target',
    (validatedLink) => validatedLink.link.targetAmount,
    (validatedLink) => validatedLink.targetMovementAmount
  );
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
  scopedTransactions: AccountingScopedTransaction[],
  movementType: 'inflow' | 'outflow'
): Result<Map<string, ScopedMovementRef>, Error> {
  const movementIndex = new Map<string, ScopedMovementRef>();

  for (const scopedTransaction of scopedTransactions) {
    const movements =
      movementType === 'inflow' ? scopedTransaction.movements.inflows : scopedTransaction.movements.outflows;

    for (const movement of movements) {
      const existing = movementIndex.get(movement.movementFingerprint);
      if (existing) {
        return err(
          new Error(
            `Duplicate scoped ${movementType} movement fingerprint ${movement.movementFingerprint} ` +
              `for transactions ${existing.transactionId} and ${scopedTransaction.tx.id}`
          )
        );
      }

      movementIndex.set(movement.movementFingerprint, {
        movement,
        transactionId: scopedTransaction.tx.id,
      });
    }
  }

  return ok(movementIndex);
}

function getTransferMovementAmount(movement: ScopedAssetMovement): Decimal {
  return movement.netAmount ?? movement.grossAmount;
}

function pushIndexedLink(
  index: Map<string, ValidatedScopedTransferLink[]>,
  fingerprint: string,
  validatedLink: ValidatedScopedTransferLink
): void {
  const existing = index.get(fingerprint) ?? [];
  existing.push(validatedLink);
  index.set(fingerprint, existing);
}

function validateGroupedMovementLinks(
  index: Map<string, ValidatedScopedTransferLink[]>,
  side: 'source' | 'target',
  amountSelector: (validatedLink: ValidatedScopedTransferLink) => Decimal,
  movementAmountSelector: (validatedLink: ValidatedScopedTransferLink) => Decimal
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
      amountSelector(validatedLinks[0]!).minus(amountSelector(validatedLinks[0]!))
    );

    if (!totalLinkedAmount.eq(fullMovementAmount)) {
      return err(
        new Error(
          `Confirmed partial transfer validation failed for ${side} movement ${fingerprint}: ` +
            `linked total ${totalLinkedAmount.toFixed()} does not reconcile with scoped movement amount ` +
            `${fullMovementAmount.toFixed()}`
        )
      );
    }
  }

  return ok(undefined);
}
