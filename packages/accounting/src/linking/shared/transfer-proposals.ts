import type { LinkStatus, NewTransactionLink, TransactionLink } from '@exitbook/core';

export type TransferProposalLink = NewTransactionLink | TransactionLink;

export interface TransferProposalGroup<TLink extends TransferProposalLink = TransferProposalLink> {
  links: TLink[];
  proposalKey: string;
  status: LinkStatus;
  transferProposalKey?: string | undefined;
}

export function getExplicitTransferProposalKey(link: Pick<TransferProposalLink, 'metadata'>): string | undefined {
  const transferProposalKey = link.metadata?.transferProposalKey;
  return typeof transferProposalKey === 'string' && transferProposalKey.length > 0 ? transferProposalKey : undefined;
}

export function getTransferProposalGroupKey(
  link: Pick<
    TransferProposalLink,
    'metadata' | 'sourceAssetId' | 'sourceMovementFingerprint' | 'targetAssetId' | 'targetMovementFingerprint'
  >
): string {
  return (
    getExplicitTransferProposalKey(link) ??
    `single:v1:${link.sourceMovementFingerprint}:${link.targetMovementFingerprint}:${link.sourceAssetId}:${link.targetAssetId}`
  );
}

export function groupLinksByTransferProposal<TLink extends TransferProposalLink>(
  links: TLink[]
): TransferProposalGroup<TLink>[] {
  const grouped = new Map<string, TransferProposalGroup<TLink>>();

  for (const link of links) {
    const proposalKey = getTransferProposalGroupKey(link);
    const existing = grouped.get(proposalKey);

    if (existing) {
      existing.links.push(link);
      continue;
    }

    grouped.set(proposalKey, {
      links: [link],
      proposalKey,
      status: link.status,
      transferProposalKey: getExplicitTransferProposalKey(link),
    });
  }

  return [...grouped.values()].map((group) => ({
    ...group,
    links: [...group.links],
    status: deriveTransferProposalStatus(group.links),
  }));
}

export function deriveTransferProposalStatus(links: readonly Pick<TransferProposalLink, 'status'>[]): LinkStatus {
  const statuses = new Set(links.map((link) => link.status));

  if (statuses.size === 1) {
    return links[0]?.status ?? 'suggested';
  }

  if (statuses.has('suggested')) {
    return 'suggested';
  }

  if (statuses.has('confirmed')) {
    return 'confirmed';
  }

  return 'rejected';
}
