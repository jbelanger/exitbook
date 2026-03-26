import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  computeAccountFingerprint,
  computeMovementFingerprint,
  computeTxFingerprint,
} from '../fingerprints.js';

vi.mock('@exitbook/foundation', async (importOriginal) => {
  const original = await importOriginal<typeof import('@exitbook/foundation')>();
  return { ...original, sha256Hex: vi.fn().mockImplementation(original.sha256Hex) };
});

// ---------------------------------------------------------------------------
// computeAccountFingerprint
// ---------------------------------------------------------------------------

describe('computeAccountFingerprint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a 64-char lowercase hex string', async () => {
    const fp = assertOk(
      computeAccountFingerprint({
        profileKey: 'default',
        accountType: 'exchange-api',
        platformKey: 'kraken',
        identifier: 'my-api-key',
      })
    );
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const input = { profileKey: 'default', accountType: 'blockchain', platformKey: 'bitcoin', identifier: 'bc1qaddr' };
    const fp1 = assertOk(computeAccountFingerprint(input));
    const fp2 = assertOk(computeAccountFingerprint(input));
    expect(fp1).toBe(fp2);
  });

  it('trims identifier whitespace', async () => {
    const base = { profileKey: 'default', accountType: 'blockchain', platformKey: 'bitcoin' };
    const fp1 = assertOk(computeAccountFingerprint({ ...base, identifier: '  addr  ' }));
    const fp2 = assertOk(computeAccountFingerprint({ ...base, identifier: 'addr' }));
    expect(fp1).toBe(fp2);
  });

  it('treats exchange-api and exchange-csv as the same exchange identity', async () => {
    const base = { profileKey: 'default', platformKey: 'kraken', identifier: 'key' };
    const fp1 = assertOk(computeAccountFingerprint({ ...base, accountType: 'exchange-api' }));
    const fp2 = assertOk(computeAccountFingerprint({ ...base, accountType: 'exchange-csv', identifier: 'other' }));
    expect(fp1).toBe(fp2);
  });

  it('differs by profileKey', async () => {
    const base = { accountType: 'exchange-api', platformKey: 'kraken', identifier: 'key' };
    const fp1 = assertOk(computeAccountFingerprint({ ...base, profileKey: 'default' }));
    const fp2 = assertOk(computeAccountFingerprint({ ...base, profileKey: 'audit' }));
    expect(fp1).not.toBe(fp2);
  });

  it('rejects empty profileKey', async () => {
    const e = assertErr(
      computeAccountFingerprint({ profileKey: '', accountType: 'blockchain', platformKey: 'x', identifier: 'y' })
    );
    expect(e.message).toContain('profileKey');
  });

  it('rejects unsupported account types', async () => {
    const e = assertErr(
      computeAccountFingerprint({ profileKey: 'default', accountType: 'custodian', platformKey: 'x', identifier: 'y' })
    );
    expect(e.message).toContain('Unsupported accountType');
  });

  it('rejects empty platformKey', async () => {
    const e = assertErr(
      computeAccountFingerprint({ profileKey: 'default', accountType: 'blockchain', platformKey: '', identifier: 'y' })
    );
    expect(e.message).toContain('platformKey');
  });

  it('rejects empty identifier', async () => {
    const e = assertErr(
      computeAccountFingerprint({
        profileKey: 'default',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: '  ',
      })
    );
    expect(e.message).toContain('identifier');
  });

  it('returns Err when SHA-256 digest fails', async () => {
    const { sha256Hex } = await import('@exitbook/foundation');
    vi.mocked(sha256Hex).mockImplementationOnce(() => {
      throw new Error('digest failed');
    });

    const e = assertErr(
      computeAccountFingerprint({
        profileKey: 'default',
        accountType: 'blockchain',
        platformKey: 'bitcoin',
        identifier: 'bc1qaddr',
      })
    );

    expect(e.message).toContain('Failed to compute SHA-256 fingerprint');
  });
});

// ---------------------------------------------------------------------------
// computeTxFingerprint — blockchain
// ---------------------------------------------------------------------------

describe('computeTxFingerprint (blockchain)', () => {
  const acctFp = 'a'.repeat(64);

  it('produces a 64-char lowercase hex string', async () => {
    const fp = assertOk(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0xabc123',
      })
    );
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const input = {
      accountFingerprint: acctFp,
      source: 'ethereum',
      sourceType: 'blockchain' as const,
      blockchainTransactionHash: '0xdef',
    };
    const fp1 = assertOk(computeTxFingerprint(input));
    const fp2 = assertOk(computeTxFingerprint(input));
    expect(fp1).toBe(fp2);
  });

  it('rejects missing blockchainTransactionHash', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'bitcoin',
        sourceType: 'blockchain',
      })
    );
    expect(e.message).toContain('blockchainTransactionHash');
  });

  it('rejects empty accountFingerprint', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: '',
        source: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0x1',
      })
    );
    expect(e.message).toContain('accountFingerprint');
  });

  it('rejects empty source', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: '',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0x1',
      })
    );
    expect(e.message).toContain('source');
  });

  it('returns Err when SHA-256 digest fails', async () => {
    const { sha256Hex } = await import('@exitbook/foundation');
    vi.mocked(sha256Hex).mockImplementationOnce(() => {
      throw new Error('digest failed');
    });

    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'bitcoin',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0x1',
      })
    );

    expect(e.message).toContain('Failed to compute SHA-256 fingerprint');
  });
});

// ---------------------------------------------------------------------------
// computeTxFingerprint — exchange
// ---------------------------------------------------------------------------

describe('computeTxFingerprint (exchange)', () => {
  const acctFp = 'b'.repeat(64);

  it('produces a 64-char lowercase hex string', async () => {
    const fp = assertOk(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'kraken',
        sourceType: 'exchange',
        componentEventIds: ['evt-1', 'evt-2'],
      })
    );
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-independent', async () => {
    const base = { accountFingerprint: acctFp, source: 'kraken', sourceType: 'exchange' as const };
    const fp1 = assertOk(computeTxFingerprint({ ...base, componentEventIds: ['b', 'a', 'c'] }));
    const fp2 = assertOk(computeTxFingerprint({ ...base, componentEventIds: ['c', 'a', 'b'] }));
    expect(fp1).toBe(fp2);
  });

  it('does not deduplicate event IDs', async () => {
    const base = { accountFingerprint: acctFp, source: 'kucoin', sourceType: 'exchange' as const };
    const fp1 = assertOk(computeTxFingerprint({ ...base, componentEventIds: ['a', 'b', 'a'] }));
    const fp2 = assertOk(computeTxFingerprint({ ...base, componentEventIds: ['a', 'b'] }));
    expect(fp1).not.toBe(fp2);
  });

  it('rejects empty componentEventIds', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'kraken',
        sourceType: 'exchange',
        componentEventIds: [],
      })
    );
    expect(e.message).toContain('componentEventIds');
  });

  it('rejects missing componentEventIds', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'kraken',
        sourceType: 'exchange',
      })
    );
    expect(e.message).toContain('componentEventIds');
  });

  it('rejects blank componentEventIds', async () => {
    const e = assertErr(
      computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'kraken',
        sourceType: 'exchange',
        componentEventIds: ['   '],
      })
    );
    expect(e.message).toContain('componentEventIds');
  });
});

// ---------------------------------------------------------------------------
// Canonical movement material
// ---------------------------------------------------------------------------

describe('canonical movement material', () => {
  it('builds asset movement material from semantic movement fields', () => {
    expect(
      buildAssetMovementCanonicalMaterial({
        movementType: 'outflow',
        assetId: 'blockchain:ethereum:0xa0b8',
        grossAmount: new Decimal('10'),
        netAmount: new Decimal('9.99'),
      })
    ).toBe('outflow|blockchain:ethereum:0xa0b8|10|9.99');
  });

  it('defaults asset net amount to gross amount when absent', () => {
    expect(
      buildAssetMovementCanonicalMaterial({
        movementType: 'inflow',
        assetId: 'blockchain:bitcoin:native',
        grossAmount: new Decimal('0.5'),
      })
    ).toBe('inflow|blockchain:bitcoin:native|0.5|0.5');
  });

  it('builds fee movement material from fee semantics', () => {
    expect(
      buildFeeMovementCanonicalMaterial({
        assetId: 'blockchain:ethereum:native',
        amount: new Decimal('0.01'),
        scope: 'network',
        settlement: 'balance',
      })
    ).toBe('fee|blockchain:ethereum:native|0.01|network|balance');
  });
});

// ---------------------------------------------------------------------------
// computeMovementFingerprint
// ---------------------------------------------------------------------------

describe('computeMovementFingerprint', () => {
  it('produces a hashed movement fingerprint', async () => {
    const fp = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'abc123',
        canonicalMaterial: 'inflow|blockchain:bitcoin:native|1|1',
        duplicateOccurrence: 1,
      })
    );
    expect(fp).toMatch(/^movement:[0-9a-f]{64}:1$/);
  });

  it('changes when txFingerprint changes even if canonical material is the same', async () => {
    const canonicalMaterial = 'outflow|blockchain:ethereum:native|1|0.99';

    const fp1 = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'tx-a',
        canonicalMaterial,
        duplicateOccurrence: 1,
      })
    );
    const fp2 = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'tx-b',
        canonicalMaterial,
        duplicateOccurrence: 1,
      })
    );

    expect(fp1).not.toBe(fp2);
  });

  it('is deterministic for identical canonical material and occurrence', async () => {
    const input = {
      txFingerprint: 'abc123',
      canonicalMaterial: 'outflow|blockchain:ethereum:native|1|0.99',
      duplicateOccurrence: 2,
    };

    const fp1 = assertOk(computeMovementFingerprint(input));
    const fp2 = assertOk(computeMovementFingerprint(input));
    expect(fp1).toBe(fp2);
  });

  it('rejects empty txFingerprint', async () => {
    const e = assertErr(
      computeMovementFingerprint({
        txFingerprint: '',
        canonicalMaterial: 'outflow|test:btc|1|1',
        duplicateOccurrence: 1,
      })
    );
    expect(e.message).toContain('txFingerprint');
  });

  it('rejects empty canonical material', async () => {
    const e = assertErr(
      computeMovementFingerprint({
        txFingerprint: 'abc',
        canonicalMaterial: '   ',
        duplicateOccurrence: 1,
      })
    );
    expect(e.message).toContain('canonicalMaterial');
  });

  it('rejects non-positive duplicate occurrence', async () => {
    const e = assertErr(
      computeMovementFingerprint({
        txFingerprint: 'abc',
        canonicalMaterial: 'fee|test:eth|0.1|network|on-chain',
        duplicateOccurrence: 0,
      })
    );
    expect(e.message).toContain('duplicateOccurrence');
  });

  it('rejects non-integer duplicate occurrence', async () => {
    const e = assertErr(
      computeMovementFingerprint({
        txFingerprint: 'abc',
        canonicalMaterial: 'fee|test:eth|0.1|network|on-chain',
        duplicateOccurrence: 1.5,
      })
    );
    expect(e.message).toContain('duplicateOccurrence');
  });
});
