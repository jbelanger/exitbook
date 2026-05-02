import { err, ok, type Result } from '@exitbook/foundation';

import type { TaxPackageLedgerSourceCoverageRequest } from '../../export/tax-package-ledger-source-coverage.js';
import type { LedgerCostBasisCarryLeg } from '../../ledger/ledger-cost-basis-operation-projection.js';
import type { StandardLedgerCostBasisWorkflowResult } from '../../workflow/workflow-result-types.js';
import type {
  StandardLedgerLotProvenance,
  StandardLedgerPostingProvenance,
} from '../operation-engine/standard-ledger-operation-engine.js';

export function collectStandardLedgerTaxPackageSourceCoverage(
  artifact: StandardLedgerCostBasisWorkflowResult
): Result<TaxPackageLedgerSourceCoverageRequest, Error> {
  const lotsById = new Map(artifact.engineResult.lots.map((lot) => [lot.id, lot]));
  const request: TaxPackageLedgerSourceCoverageRequest = {
    journalRefs: [],
    postingRefs: [],
    relationshipRefs: [],
    sourceActivityRefs: [],
  };

  for (const lot of artifact.engineResult.lots) {
    addLotProvenanceRefs(request, lot.provenance, `standard ledger lot ${lot.id}`);
  }

  for (const disposal of artifact.engineResult.disposals) {
    addPostingProvenanceRefs(request, disposal.provenance, `standard ledger disposal ${disposal.id}`);

    for (const slice of disposal.slices) {
      if (!lotsById.has(slice.lotId)) {
        return err(new Error(`Missing source lot ${slice.lotId} for standard ledger disposal ${disposal.id}`));
      }
    }
  }

  for (const carry of artifact.engineResult.carries) {
    addRelationshipRef(request, carry.relationshipStableKey, `standard ledger carry ${carry.id}`);

    for (const sourceLeg of carry.sourceLegs) {
      addCarryLegRefs(request, sourceLeg, `standard ledger carry ${carry.id} source leg ${sourceLeg.allocationId}`);
    }
    for (const targetLeg of carry.targetLegs) {
      addCarryLegRefs(request, targetLeg, `standard ledger carry ${carry.id} target leg ${targetLeg.allocationId}`);
    }

    for (const [sliceIndex, slice] of carry.slices.entries()) {
      if (slice.sourceLotId !== undefined && !lotsById.has(slice.sourceLotId)) {
        return err(
          new Error(
            `Missing source lot ${slice.sourceLotId} for standard ledger carry ${carry.id} slice ${sliceIndex + 1}`
          )
        );
      }
      if (slice.targetLotId !== undefined && !lotsById.has(slice.targetLotId)) {
        return err(
          new Error(
            `Missing target lot ${slice.targetLotId} for standard ledger carry ${carry.id} slice ${sliceIndex + 1}`
          )
        );
      }
    }
  }

  return ok(request);
}

function addLotProvenanceRefs(
  request: TaxPackageLedgerSourceCoverageRequest,
  provenance: StandardLedgerLotProvenance,
  reference: string
): void {
  addPostingProvenanceRefs(request, provenance, reference);
  if (provenance.kind === 'carry-operation') {
    addRelationshipRef(request, provenance.relationshipStableKey, reference);
  }
}

function addPostingProvenanceRefs(
  request: TaxPackageLedgerSourceCoverageRequest,
  provenance: StandardLedgerPostingProvenance,
  reference: string
): void {
  request.sourceActivityRefs.push({
    sourceActivityFingerprint: provenance.sourceActivityFingerprint,
    ownerAccountId: provenance.ownerAccountId,
    reference,
  });
  request.journalRefs.push({
    journalFingerprint: provenance.journalFingerprint,
    sourceActivityFingerprint: provenance.sourceActivityFingerprint,
    reference,
  });
  request.postingRefs.push({
    postingFingerprint: provenance.postingFingerprint,
    journalFingerprint: provenance.journalFingerprint,
    reference,
  });

  if (provenance.relationshipContext !== undefined) {
    addRelationshipRef(request, provenance.relationshipContext.relationshipStableKey, reference);
  }
}

function addCarryLegRefs(
  request: TaxPackageLedgerSourceCoverageRequest,
  leg: LedgerCostBasisCarryLeg,
  reference: string
): void {
  request.sourceActivityRefs.push({
    sourceActivityFingerprint: leg.sourceActivityFingerprint,
    ownerAccountId: leg.ownerAccountId,
    reference,
  });
  request.journalRefs.push({
    journalFingerprint: leg.journalFingerprint,
    sourceActivityFingerprint: leg.sourceActivityFingerprint,
    reference,
  });
  request.postingRefs.push({
    postingFingerprint: leg.postingFingerprint,
    journalFingerprint: leg.journalFingerprint,
    reference,
  });
}

function addRelationshipRef(
  request: TaxPackageLedgerSourceCoverageRequest,
  relationshipStableKey: string,
  reference: string
): void {
  request.relationshipRefs.push({
    relationshipStableKey,
    reference,
  });
}
