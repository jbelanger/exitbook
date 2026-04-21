/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable in tests */
import { describe, expect, it } from 'vitest';

import { buildTransaction } from '../../../__tests__/test-utils.js';
import type { ProfileLinkGapCrossProfileContext } from '../../../ports/profile-link-gap-source-reader.js';
import { buildLinkGapCrossProfileCounterpartsByIssueKey } from '../cross-profile-gap-counterparts.js';
import { buildLinkGapIssueKey, type LinkGapIssue } from '../gap-model.js';

function createGapIssue(overrides: Partial<LinkGapIssue> = {}): LinkGapIssue {
  return {
    transactionId: 101,
    txFingerprint: 'kraken-gap-1',
    platformKey: 'kraken',
    timestamp: '2024-05-19T12:00:00.000Z',
    assetId: 'exchange:kraken:usdc',
    assetSymbol: 'USDC',
    missingAmount: '99',
    totalAmount: '99',
    confirmedCoveragePercent: '0',
    operationGroup: 'transfer',
    operationLabel: 'transfer/withdrawal',
    suggestedCount: 0,
    direction: 'outflow',
    ...overrides,
  };
}

describe('buildLinkGapCrossProfileCounterpartsByIssueKey', () => {
  it('matches exact other-profile opposite-direction counterparts within the time window', () => {
    const issue = createGapIssue();
    const crossProfileContext: ProfileLinkGapCrossProfileContext = {
      accounts: [
        { id: 1, profileId: 1 },
        { id: 2, profileId: 2 },
      ],
      activeProfileId: 1,
      profiles: [
        { id: 1, profileKey: 'default', displayName: 'default' },
        { id: 2, profileKey: 'maely', displayName: 'maely' },
      ],
      transactions: [
        buildTransaction({
          accountId: 2,
          category: 'transfer',
          datetime: '2024-05-19T12:00:15.000Z',
          id: 202,
          inflows: [{ amount: '99', assetId: 'blockchain:solana:usdc', assetSymbol: 'USDC' }],
          platformKey: 'solana',
          platformKind: 'blockchain',
          type: 'deposit',
        }),
      ],
    };

    const result = buildLinkGapCrossProfileCounterpartsByIssueKey([issue], crossProfileContext);

    expect(result.get(buildLinkGapIssueKey(issue))).toEqual([
      {
        amount: '99',
        direction: 'inflow',
        platformKey: 'solana',
        profileDisplayName: 'maely',
        profileKey: 'maely',
        secondsDeltaFromGap: 15,
        timestamp: '2024-05-19T12:00:15.000Z',
        txFingerprint: expect.any(String),
      },
    ]);
  });

  it('ignores transactions from the active profile', () => {
    const issue = createGapIssue();
    const crossProfileContext: ProfileLinkGapCrossProfileContext = {
      accounts: [{ id: 1, profileId: 1 }],
      activeProfileId: 1,
      profiles: [{ id: 1, profileKey: 'default', displayName: 'default' }],
      transactions: [
        buildTransaction({
          accountId: 1,
          category: 'transfer',
          datetime: '2024-05-19T12:00:15.000Z',
          id: 203,
          inflows: [{ amount: '99', assetId: 'blockchain:solana:usdc', assetSymbol: 'USDC' }],
          platformKey: 'solana',
          platformKind: 'blockchain',
          type: 'deposit',
        }),
      ],
    };

    const result = buildLinkGapCrossProfileCounterpartsByIssueKey([issue], crossProfileContext);

    expect(result.size).toBe(0);
  });
});
