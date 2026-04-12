import { describe, expect, it } from 'vitest';

import { formatTransactionFlags } from '../transactions-view-formatters.js';

describe('formatTransactionFlags', () => {
  it('renders confirmed scam diagnostics as spam', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [{ code: 'SCAM_TOKEN', message: 'confirmed scam', severity: 'error' }],
      })
    ).toBe('spam');
  });

  it('renders suspicious airdrop diagnostics as suspicious', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [{ code: 'SUSPICIOUS_AIRDROP', message: 'promo memo', severity: 'warning' }],
      })
    ).toBe('suspicious');
  });

  it('renders excluded alongside scam assessment when both apply', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: true,
        diagnostics: [{ code: 'SCAM_TOKEN', message: 'confirmed scam', severity: 'error' }],
      })
    ).toBe('excluded,spam');
  });

  it('renders an em dash when no flags apply', () => {
    expect(
      formatTransactionFlags({
        excludedFromAccounting: false,
        diagnostics: [],
      })
    ).toBe('—');
  });
});
