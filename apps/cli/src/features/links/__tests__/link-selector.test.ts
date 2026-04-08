import { getTransferProposalGroupKey } from '@exitbook/accounting/linking';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildLinkProposalRef, resolveLinkProposalRef } from '../link-selector.js';

import { createMockLink } from './test-utils.js';

describe('link selector', () => {
  it('derives stable short proposal refs from proposal keys', () => {
    const link = createMockLink(1, {
      sourceMovementFingerprint: 'movement:exchange:source:1:btc:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:target:2:btc:inflow:0',
    });

    const proposalRef = buildLinkProposalRef(getTransferProposalGroupKey(link));

    expect(proposalRef).toMatch(/^[0-9a-f]{10}$/);
  });

  it('resolves a proposal by derived short ref instead of the raw fingerprint prefix', () => {
    const first = createMockLink(1, {
      sourceMovementFingerprint: 'movement:exchange:source:1:btc:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:target:2:btc:inflow:0',
    });
    const second = createMockLink(2, {
      sourceMovementFingerprint: 'movement:exchange:source:3:btc:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:target:4:btc:inflow:0',
    });

    const firstRef = buildLinkProposalRef(getTransferProposalGroupKey(first));
    const resolved = assertOk(resolveLinkProposalRef([first, second], firstRef));

    expect(resolved.proposalKey).toBe(getTransferProposalGroupKey(first));
    expect(resolved.proposalRef).toBe(firstRef);
    expect(resolved.representativeLinkId).toBe(1);

    const rawPrefixResult = resolveLinkProposalRef([first, second], 'resolved-li');
    const rawPrefixError = assertErr(rawPrefixResult);
    expect(rawPrefixError.message).toContain("Link proposal ref 'resolved-li' not found");
  });
});
