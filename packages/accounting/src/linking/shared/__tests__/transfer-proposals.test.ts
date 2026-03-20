import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { createLink } from '../test-utils.js';
import {
  deriveTransferProposalStatus,
  getExplicitTransferProposalKey,
  getTransferProposalGroupKey,
  groupLinksByTransferProposal,
} from '../transfer-proposals.js';

describe('getExplicitTransferProposalKey', () => {
  it('should return transferProposalKey from metadata when present', () => {
    const link = { metadata: { transferProposalKey: 'proposal-123' } };
    expect(getExplicitTransferProposalKey(link)).toBe('proposal-123');
  });

  it('should return undefined when metadata is undefined', () => {
    const link = { metadata: undefined };
    expect(getExplicitTransferProposalKey(link)).toBeUndefined();
  });

  it('should return undefined when transferProposalKey is empty string', () => {
    const link = { metadata: { transferProposalKey: '' } };
    expect(getExplicitTransferProposalKey(link)).toBeUndefined();
  });

  it('should return undefined when transferProposalKey is not a string', () => {
    const link = { metadata: { transferProposalKey: 123 as unknown as string } };
    expect(getExplicitTransferProposalKey(link)).toBeUndefined();
  });
});

describe('getTransferProposalGroupKey', () => {
  it('should use explicit key when present', () => {
    const link = createLink({
      id: 1,
      sourceTransactionId: 10,
      targetTransactionId: 20,
      assetSymbol: 'BTC',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
    });
    (link as { metadata: Record<string, unknown> }).metadata = { transferProposalKey: 'proposal-abc' };

    expect(getTransferProposalGroupKey(link)).toBe('proposal-abc');
  });

  it('should generate deterministic key from fingerprints when no explicit key', () => {
    const link = createLink({
      id: 1,
      sourceTransactionId: 10,
      targetTransactionId: 20,
      assetSymbol: 'BTC',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
    });

    const key = getTransferProposalGroupKey(link);
    expect(key).toContain('single:v1:');
    expect(key).toContain(link.sourceMovementFingerprint);
    expect(key).toContain(link.targetMovementFingerprint);
  });
});

describe('deriveTransferProposalStatus', () => {
  it('should return the status when all links have the same status', () => {
    expect(deriveTransferProposalStatus([{ status: 'confirmed' }])).toBe('confirmed');
    expect(deriveTransferProposalStatus([{ status: 'suggested' }])).toBe('suggested');
    expect(deriveTransferProposalStatus([{ status: 'rejected' }])).toBe('rejected');
  });

  it('should return suggested when mix includes suggested', () => {
    expect(deriveTransferProposalStatus([{ status: 'confirmed' }, { status: 'suggested' }])).toBe('suggested');
  });

  it('should return confirmed when mix is confirmed and rejected', () => {
    expect(deriveTransferProposalStatus([{ status: 'confirmed' }, { status: 'rejected' }])).toBe('confirmed');
  });

  it('should return rejected for empty array (no statuses to derive from)', () => {
    expect(deriveTransferProposalStatus([])).toBe('rejected');
  });
});

describe('groupLinksByTransferProposal', () => {
  it('should group links with same proposal key', () => {
    const link1 = createLink({
      id: 1,
      sourceTransactionId: 10,
      targetTransactionId: 20,
      assetSymbol: 'BTC',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
    });
    const link2 = createLink({
      id: 2,
      sourceTransactionId: 11,
      targetTransactionId: 21,
      assetSymbol: 'BTC',
      sourceAmount: parseDecimal('0.5'),
      targetAmount: parseDecimal('0.5'),
    });
    // Give both the same explicit proposal key
    (link1 as { metadata: Record<string, unknown> }).metadata = { transferProposalKey: 'group-1' };
    (link2 as { metadata: Record<string, unknown> }).metadata = { transferProposalKey: 'group-1' };

    const groups = groupLinksByTransferProposal([link1, link2]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.links).toHaveLength(2);
    expect(groups[0]!.proposalKey).toBe('group-1');
  });

  it('should separate links with different proposal keys', () => {
    const link1 = createLink({
      id: 1,
      sourceTransactionId: 10,
      targetTransactionId: 20,
      assetSymbol: 'BTC',
      sourceAmount: parseDecimal('1'),
      targetAmount: parseDecimal('1'),
    });
    const link2 = createLink({
      id: 2,
      sourceTransactionId: 11,
      targetTransactionId: 21,
      assetSymbol: 'ETH',
      sourceAmount: parseDecimal('10'),
      targetAmount: parseDecimal('10'),
    });

    const groups = groupLinksByTransferProposal([link1, link2]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.links).toHaveLength(1);
    expect(groups[1]!.links).toHaveLength(1);
  });

  it('should return empty array for empty input', () => {
    expect(groupLinksByTransferProposal([])).toEqual([]);
  });
});
