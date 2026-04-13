import { resolveTransactionLinkProvenance, type OverrideLinkType, type TransactionLink } from '@exitbook/core';

import type { LinkProposalProvenanceSummary } from './links-view-model.js';

export function summarizeProposalProvenance(links: readonly TransactionLink[]): LinkProposalProvenanceSummary {
  const overrideIds = new Set<string>();
  const overrideLinkTypes = new Set<OverrideLinkType>();
  let manualLegCount = 0;
  let systemLegCount = 0;
  let userLegCount = 0;

  for (const link of links) {
    switch (resolveTransactionLinkProvenance(link)) {
      case 'manual':
        manualLegCount += 1;
        break;
      case 'system':
        systemLegCount += 1;
        break;
      case 'user':
        userLegCount += 1;
        break;
    }

    const overrideId = link.metadata?.overrideId;
    const overrideLinkType = link.metadata?.overrideLinkType;

    if (overrideId) {
      overrideIds.add(overrideId);
    }

    if (overrideLinkType) {
      overrideLinkTypes.add(overrideLinkType);
    }
  }

  const provenances = [
    systemLegCount > 0 ? 'system' : undefined,
    userLegCount > 0 ? 'user' : undefined,
    manualLegCount > 0 ? 'manual' : undefined,
  ].filter((value): value is 'system' | 'user' | 'manual' => value !== undefined);
  const [singleProvenance] = provenances;

  return {
    provenance: provenances.length === 1 && singleProvenance ? singleProvenance : 'mixed',
    overrideIds: [...overrideIds],
    overrideLinkTypes: [...overrideLinkTypes],
    manualLegCount,
    systemLegCount,
    userLegCount,
  };
}
