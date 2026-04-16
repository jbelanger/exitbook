import { err, ok, type Result } from '@exitbook/foundation';

import type { TaxPackageSourceCoverageRequest } from '../../../export/tax-package-source-coverage.js';
import type { CanadaCostBasisWorkflowResult } from '../../../workflow/workflow-result-types.js';

export function collectCanadaTaxPackageSourceCoverage(
  artifact: CanadaCostBasisWorkflowResult
): Result<TaxPackageSourceCoverageRequest, Error> {
  if (!artifact.inputContext) {
    return err(new Error('Canada workflow artifact is missing inputContext required for tax-package export'));
  }

  const transactionRefs: TaxPackageSourceCoverageRequest['transactionRefs'] = [];
  const confirmedLinkRefs: TaxPackageSourceCoverageRequest['confirmedLinkRefs'] = [];

  for (const acquisition of artifact.taxReport.acquisitions) {
    transactionRefs.push({
      transactionId: acquisition.transactionId,
      reference: `Canada acquisition ${acquisition.id}`,
    });
  }

  for (const disposition of artifact.taxReport.dispositions) {
    transactionRefs.push({
      transactionId: disposition.transactionId,
      reference: `Canada disposition ${disposition.id}`,
    });
  }

  for (const transfer of artifact.taxReport.transfers) {
    transactionRefs.push({
      transactionId: transfer.transactionId,
      reference: `Canada transfer ${transfer.id}`,
    });

    if (transfer.sourceTransactionId !== undefined) {
      transactionRefs.push({
        transactionId: transfer.sourceTransactionId,
        reference: `Canada transfer ${transfer.id} source`,
      });
    }

    if (transfer.targetTransactionId !== undefined) {
      transactionRefs.push({
        transactionId: transfer.targetTransactionId,
        reference: `Canada transfer ${transfer.id} target`,
      });
    }

    if (transfer.linkId !== undefined) {
      confirmedLinkRefs.push({
        linkId: transfer.linkId,
        reference: `Canada transfer ${transfer.id}`,
      });
    }
  }

  for (const transactionId of artifact.inputContext.inputTransactionIds) {
    transactionRefs.push({
      transactionId,
      reference: `Canada inputContext transaction ${transactionId}`,
    });
  }

  for (const linkId of artifact.inputContext.validatedTransferLinkIds) {
    confirmedLinkRefs.push({
      linkId,
      reference: `Canada inputContext validated transfer link ${linkId}`,
    });
  }

  for (const transactionId of artifact.inputContext.internalTransferCarryoverSourceTransactionIds) {
    transactionRefs.push({
      transactionId,
      reference: `Canada inputContext internal transfer carryover source transaction ${transactionId}`,
    });
  }

  for (const inputEvent of artifact.inputContext.inputEvents) {
    transactionRefs.push({
      transactionId: inputEvent.transactionId,
      reference: `Canada input event ${inputEvent.eventId}`,
    });

    if (inputEvent.sourceTransactionId !== undefined) {
      transactionRefs.push({
        transactionId: inputEvent.sourceTransactionId,
        reference: `Canada input event ${inputEvent.eventId} source`,
      });
    }

    if (inputEvent.provenanceKind === 'validated-link') {
      if (inputEvent.linkId === undefined) {
        return err(new Error(`Missing confirmed link id on Canada input event ${inputEvent.eventId}`));
      }

      confirmedLinkRefs.push({
        linkId: inputEvent.linkId,
        reference: `Canada input event ${inputEvent.eventId}`,
      });
    }
  }

  return ok({ transactionRefs, confirmedLinkRefs });
}
