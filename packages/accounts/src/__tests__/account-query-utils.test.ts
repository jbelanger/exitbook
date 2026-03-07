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
    it('returns never-checked when no verification exists and no balance check happened', () => {
      const account = createMockAccount({ lastBalanceCheckAt: undefined, verificationMetadata: undefined });

      expect(getVerificationStatus(account)).toBe('never-checked');
    });

    it('returns undefined when no verification exists but a balance check timestamp exists', () => {
      const account = createMockAccount({
        lastBalanceCheckAt: new Date('2025-01-02T00:00:00.000Z'),
        verificationMetadata: undefined,
      });

      expect(getVerificationStatus(account)).toBeUndefined();
    });

    it('returns match or mismatch from verification metadata', () => {
      const matchAccount = createMockAccount({
        verificationMetadata: {
          current_balance: { BTC: '1' },
          last_verification: {
            calculated_balance: { BTC: '1' },
            live_balance: { BTC: '1' },
            status: 'match',
            verified_at: '2025-01-03T00:00:00.000Z',
          },
        },
      });

      const mismatchAccount = createMockAccount({
        verificationMetadata: {
          current_balance: { BTC: '1' },
          last_verification: {
            calculated_balance: { BTC: '1' },
            live_balance: { BTC: '2' },
            status: 'mismatch',
            verified_at: '2025-01-03T00:00:00.000Z',
          },
        },
      });

      expect(getVerificationStatus(matchAccount)).toBe('match');
      expect(getVerificationStatus(mismatchAccount)).toBe('mismatch');
    });

    it('returns undefined for unavailable verification status', () => {
      const account = createMockAccount({
        verificationMetadata: {
          current_balance: { BTC: '1' },
          last_verification: {
            calculated_balance: { BTC: '1' },
            status: 'unavailable',
            verified_at: '2025-01-03T00:00:00.000Z',
          },
        },
      });

      expect(getVerificationStatus(account)).toBeUndefined();
    });
  });

  describe('toAccountSummary', () => {
    it('formats an account with masked identifiers and ISO timestamps', () => {
      const account = createMockAccount({
        id: 42,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'secretapikey',
        providerName: 'provider-x',
        createdAt: new Date('2025-01-01T12:00:00.000Z'),
        lastBalanceCheckAt: new Date('2025-01-02T12:00:00.000Z'),
      });

      const formatted = toAccountSummary(account, 7);

      expect(formatted).toMatchObject({
        id: 42,
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'secretap***',
        providerName: 'provider-x',
        sessionCount: 7,
        createdAt: '2025-01-01T12:00:00.000Z',
        lastBalanceCheckAt: '2025-01-02T12:00:00.000Z',
      });
    });
  });
});
