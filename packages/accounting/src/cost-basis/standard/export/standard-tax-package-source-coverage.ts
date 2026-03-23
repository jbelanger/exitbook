import { err, ok, type Result } from '@exitbook/foundation';

import type { TaxPackageSourceCoverageRequest } from '../../export/tax-package-source-coverage.js';
import type { StandardCostBasisWorkflowResult } from '../../workflow/workflow-result-types.js';

export function collectStandardTaxPackageSourceCoverage(
  artifact: StandardCostBasisWorkflowResult
): Result<TaxPackageSourceCoverageRequest, Error> {
  const lotsById = new Map(artifact.lots.map((lot) => [lot.id, lot]));
  const transactionRefs: TaxPackageSourceCoverageRequest['transactionRefs'] = [];
  const confirmedLinkRefs: TaxPackageSourceCoverageRequest['confirmedLinkRefs'] = [];

  for (const lot of artifact.lots) {
    transactionRefs.push({
      transactionId: lot.acquisitionTransactionId,
      reference: `standard lot ${lot.id} acquisition`,
    });
  }

  for (const disposal of artifact.disposals) {
    const sourceLot = lotsById.get(disposal.lotId);
    if (!sourceLot) {
      return err(new Error(`Missing source lot ${disposal.lotId} for standard disposal ${disposal.id}`));
    }

    transactionRefs.push({
      transactionId: disposal.disposalTransactionId,
      reference: `standard disposal ${disposal.id}`,
    });
    transactionRefs.push({
      transactionId: sourceLot.acquisitionTransactionId,
      reference: `standard disposal ${disposal.id} lot ${sourceLot.id}`,
    });
  }

  for (const transfer of artifact.lotTransfers) {
    if (!lotsById.has(transfer.sourceLotId)) {
      return err(new Error(`Missing source lot ${transfer.sourceLotId} for standard transfer ${transfer.id}`));
    }

    transactionRefs.push({
      transactionId: transfer.sourceTransactionId,
      reference: `standard transfer ${transfer.id} source`,
    });
    transactionRefs.push({
      transactionId: transfer.targetTransactionId,
      reference: `standard transfer ${transfer.id} target`,
    });

    if (transfer.provenance.kind === 'confirmed-link') {
      confirmedLinkRefs.push({
        linkId: transfer.provenance.linkId,
        reference: `standard transfer ${transfer.id}`,
      });
    }
  }

  return ok({ transactionRefs, confirmedLinkRefs });
}
