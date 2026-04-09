import { describe, expect, it } from 'vitest';

import { formatProcessedTransactionsRebuildMessage } from '../projection-readiness.js';

describe('formatProcessedTransactionsRebuildMessage', () => {
  it('describes the first build as processing imported data', () => {
    const message = formatProcessedTransactionsRebuildMessage(
      { reason: 'import:xrp:account-25', status: 'stale' },
      undefined
    );

    expect(message).toContain('Derived data has not been built yet');
    expect(message).toContain('processing imported data');
    expect(message).not.toContain('reprocessing');
    expect(message).not.toContain('stale');
  });

  it('keeps stale wording when a prior build exists', () => {
    const message = formatProcessedTransactionsRebuildMessage(
      { reason: 'new import completed since last build', status: 'stale' },
      { lastBuiltAt: new Date('2026-04-08T12:00:00.000Z') }
    );

    expect(message).toContain('Derived data is stale (new import completed since last build), reprocessing');
  });
});
