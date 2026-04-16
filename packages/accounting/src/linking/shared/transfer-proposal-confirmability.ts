import type { TransactionLink } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import type { TransferValidationTransactionView } from '../../accounting-layer/validated-transfer-links.js';
import { validateTransferLinks } from '../../accounting-layer/validated-transfer-links.js';

import {
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
  type TransferProposalGroup,
  type TransferProposalLink,
} from './transfer-proposals.js';

export function validateTransferProposalConfirmability(
  accountingTransactionViews: readonly TransferValidationTransactionView[],
  existingConfirmedLinks: readonly TransferProposalLink[],
  proposalLinks: readonly TransferProposalLink[]
): Result<void, Error> {
  const hydratedConfirmedLinks = materializeLinksForValidation(existingConfirmedLinks);
  const hydratedProposalLinks = materializeLinksForValidation(proposalLinks).map((link) => ({
    ...link,
    status: 'confirmed' as const,
  }));

  const validationResult = validateTransferLinks(accountingTransactionViews, [
    ...hydratedConfirmedLinks,
    ...hydratedProposalLinks,
  ]);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  return ok(undefined);
}

export function filterConfirmableTransferProposals<TLink extends TransferProposalLink>(
  accountingTransactionViews: readonly TransferValidationTransactionView[],
  existingConfirmedLinks: readonly TransferProposalLink[],
  candidateLinks: TLink[],
  logger?: Logger
): TLink[] {
  if (candidateLinks.length === 0) {
    return [];
  }

  const acceptedProposalKeys = new Set<string>();
  const acceptedConfirmedLinks = existingConfirmedLinks.filter((link) => link.status === 'confirmed');
  const proposals = groupLinksByTransferProposal(candidateLinks).sort(compareProposalPriority);

  for (const proposal of proposals) {
    const confirmabilityResult = validateTransferProposalConfirmability(
      accountingTransactionViews,
      acceptedConfirmedLinks,
      proposal.links
    );

    if (confirmabilityResult.isErr()) {
      logger?.warn(
        {
          error: confirmabilityResult.error.message,
          linkIds: proposal.links.map((link) => ('id' in link ? link.id : undefined)).filter((id) => id !== undefined),
          proposalKey: proposal.proposalKey,
          transferProposalKey: proposal.transferProposalKey,
        },
        'Dropping unconfirmable transfer proposal during linking'
      );
      continue;
    }

    acceptedProposalKeys.add(proposal.proposalKey);
    acceptedConfirmedLinks.push(...proposal.links.filter((link) => link.status === 'confirmed'));
  }

  return candidateLinks.filter((link) => acceptedProposalKeys.has(getTransferProposalGroupKey(link)));
}

/** Assigns synthetic negative IDs to NewTransactionLink objects so they satisfy the TransactionLink shape for validation. */
function materializeLinksForValidation(links: readonly TransferProposalLink[]): TransactionLink[] {
  return links.map((link, index) => {
    if ('id' in link) {
      return link;
    }

    return {
      ...link,
      id: -1 - index,
    };
  });
}

function compareProposalPriority(left: TransferProposalGroup, right: TransferProposalGroup): number {
  return statusPriority(left.status) - statusPriority(right.status);
}

function statusPriority(status: TransactionLink['status']): number {
  if (status === 'confirmed') {
    return 0;
  }

  if (status === 'suggested') {
    return 1;
  }

  return 2;
}
