import type { BalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { getVerificationStatus, maskIdentifier, toAccountSummary } from '../account-query-utils.js';

import { createMockAccount } from './account-test-utils.js';

describe('account-query-utils', () => {
  describe('maskIdentifier', () => {
    it('masks exchange API keys longer than eight characters', () => {
      const account = createMockAccount({
        accountType: 'exchange-api',
        identifier: 'abcdefghijk123',
      });

      expect(maskIdentifier(account)).toBe('abcdefgh***');
    });

    it('fully masks short exchange API keys', () => {
      const account = createMockAccount({
        accountType: 'exchange-api',
        identifier: 'abcd',
      });

      expect(maskIdentifier(account)).toBe('***');
    });

    it('keeps blockchain identifiers unmasked', () => {
      const account = createMockAccount({
        accountType: 'blockchain',
        identifier: 'bc1qrealaddress',
      });

      expect(maskIdentifier(account)).toBe('bc1qrealaddress');
    });
  });

  describe('getVerificationStatus', () => {
    function createSnapshot(overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
      return {
        scopeAccountId: 1,
        verificationStatus: 'warning',
        matchCount: 0,
        warningCount: 1,
        mismatchCount: 0,
        ...overrides,
      };
    }

    it('returns never-checked when no snapshot exists', () => {
      expect(getVerificationStatus()).toBe('never-checked');
    });

    it('returns never-checked when the snapshot has never run', () => {
      expect(getVerificationStatus(createSnapshot({ verificationStatus: 'never-run' }))).toBe('never-checked');
    });

    it('returns match, warning, mismatch, or unavailable from snapshot status', () => {
      expect(getVerificationStatus(createSnapshot({ verificationStatus: 'match' }))).toBe('match');
      expect(getVerificationStatus(createSnapshot({ verificationStatus: 'warning' }))).toBe('warning');
      expect(getVerificationStatus(createSnapshot({ verificationStatus: 'mismatch' }))).toBe('mismatch');
      expect(getVerificationStatus(createSnapshot({ verificationStatus: 'unavailable' }))).toBe('unavailable');
    });
  });

  describe('toAccountSummary', () => {
    it('formats an account with masked identifiers and ISO timestamps', () => {
      const account = createMockAccount({
        id: 42,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'secretapikey',
        providerName: 'provider-x',
        createdAt: new Date('2025-01-01T12:00:00.000Z'),
      });
      const snapshot: BalanceSnapshot = {
        scopeAccountId: 42,
        verificationStatus: 'match',
        calculatedAt: new Date('2025-01-02T11:30:00.000Z'),
        lastRefreshAt: new Date('2025-01-02T12:00:00.000Z'),
        matchCount: 1,
        warningCount: 0,
        mismatchCount: 0,
      };

      const formatted = toAccountSummary(account, 7, snapshot);

      expect(formatted).toMatchObject({
        id: 42,
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'secretap***',
        providerName: 'provider-x',
        sessionCount: 7,
        createdAt: '2025-01-01T12:00:00.000Z',
        balanceProjectionStatus: 'fresh',
        lastCalculatedAt: '2025-01-02T11:30:00.000Z',
        lastRefreshAt: '2025-01-02T12:00:00.000Z',
        verificationStatus: 'match',
      });
    });
  });
});
