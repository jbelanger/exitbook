import { describe, expect, it } from 'vitest';

import { buildTransferProposalItems, resolveTransferProposal } from '../transfer-proposals.js';

import { createMockLink } from './test-utils.js';

describe('transfer proposals', () => {
  it('groups links by transferProposalKey when present', () => {
    const first = createMockLink(1, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
        transferProposalKey: 'partial-target:v1:target',
      },
    });
    const second = createMockLink(2, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '10',
        consumedAmount: '5',
        transferProposalKey: 'partial-target:v1:target',
      },
    });
    const third = createMockLink(3, {
      metadata: {
        partialMatch: true,
        fullSourceAmount: '5',
        fullTargetAmount: '5',
        consumedAmount: '5',
        transferProposalKey: 'partial-source:v1:other',
      },
    });

    const proposal = resolveTransferProposal(first, [first, second, third]);

    expect(proposal.transferProposalKey).toBe('partial-target:v1:target');
    expect(proposal.links.map((link) => link.id)).toEqual([1, 2]);
  });

  it('treats links without a transferProposalKey as singleton proposals', () => {
    const first = createMockLink(1, {
      sourceMovementFingerprint: 'movement:exchange:source:1:btc:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:target:1:btc:inflow:0',
    });
    const second = createMockLink(2, {
      sourceMovementFingerprint: 'movement:exchange:source:2:btc:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:target:2:btc:inflow:0',
    });

    const proposals = buildTransferProposalItems([{ link: first }, { link: second }]);

    expect(proposals).toHaveLength(2);
    expect(proposals.map((proposal) => proposal.representativeLink.id)).toEqual([1, 2]);
  });
});
