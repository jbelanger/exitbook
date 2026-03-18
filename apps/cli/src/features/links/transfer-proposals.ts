import {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
  type LinkStatus,
} from '@exitbook/accounting';
import type { TransactionLink } from '@exitbook/core';

interface TransferProposal {
  links: TransactionLink[];
  proposalKey: string;
  representativeLink: TransactionLink;
  status: LinkStatus;
  transferProposalKey?: string | undefined;
}

interface TransferProposalItems<TItem extends { link: TransactionLink }> {
  items: TItem[];
  proposalKey: string;
  representativeItem: TItem;
  representativeLink: TransactionLink;
  status: LinkStatus;
  transferProposalKey?: string | undefined;
}

export function resolveTransferProposal(
  selectedLink: TransactionLink,
  candidateLinks: TransactionLink[]
): TransferProposal {
  const proposalKey = getTransferProposalGroupKey(selectedLink);
  const proposalLinks = candidateLinks
    .filter((candidate) => getTransferProposalGroupKey(candidate) === proposalKey)
    .sort((left, right) => left.id - right.id);

  return {
    links: proposalLinks.length > 0 ? proposalLinks : [selectedLink],
    proposalKey,
    representativeLink: proposalLinks[0] ?? selectedLink,
    status: deriveTransferProposalStatus(proposalLinks.length > 0 ? proposalLinks : [selectedLink]),
    transferProposalKey: getExplicitTransferProposalKey(selectedLink),
  };
}

export function buildTransferProposalItems<TItem extends { link: TransactionLink }>(
  items: TItem[]
): TransferProposalItems<TItem>[] {
  const itemsByLink = new Map<TransactionLink, TItem>();
  for (const item of items) {
    itemsByLink.set(item.link, item);
  }

  const groups = groupLinksByTransferProposal(items.map((item) => item.link));

  return groups.map((group) => {
    const groupItems = group.links
      .map((link) => itemsByLink.get(link)!)
      .sort((left, right) => left.link.id - right.link.id);
    const representative = groupItems[0]!;

    return {
      items: groupItems,
      proposalKey: group.proposalKey,
      representativeItem: representative,
      representativeLink: representative.link,
      status: group.status,
      transferProposalKey: group.transferProposalKey,
    };
  });
}
