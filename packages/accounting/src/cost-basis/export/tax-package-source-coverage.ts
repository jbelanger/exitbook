import { err, ok, type Result } from '@exitbook/core';

import {
  requireConfirmedLink,
  requireTransactionWithAccount,
  type TaxPackageIndexedSourceContext,
} from './tax-package-source-context.js';

export interface TaxPackageTransactionCoverageRef {
  reference: string;
  transactionId: number;
}

export interface TaxPackageConfirmedLinkCoverageRef {
  linkId: number;
  reference: string;
}

export interface TaxPackageSourceCoverageRequest {
  confirmedLinkRefs: TaxPackageConfirmedLinkCoverageRef[];
  transactionRefs: TaxPackageTransactionCoverageRef[];
}

export function validateTaxPackageSourceCoverage(
  sourceContext: TaxPackageIndexedSourceContext,
  request: TaxPackageSourceCoverageRequest
): Result<void, Error> {
  for (const transactionRef of request.transactionRefs) {
    const transactionResult = requireTransactionWithAccount(
      sourceContext,
      transactionRef.transactionId,
      transactionRef.reference
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }
  }

  for (const confirmedLinkRef of request.confirmedLinkRefs) {
    const linkResult = requireConfirmedLink(sourceContext, confirmedLinkRef.linkId, confirmedLinkRef.reference);
    if (linkResult.isErr()) {
      return err(linkResult.error);
    }
  }

  return ok(undefined);
}
