import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertErr, assertOk } from '../../__tests__/test-utils.js';
import { computeAccountFingerprint, computeMovementFingerprint, computeTxFingerprint } from '../fingerprints.js';

vi.mock('../sha256.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../sha256.js')>();
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
      await computeAccountFingerprint({
        accountType: 'exchange-api',
        sourceName: 'kraken',
        identifier: 'my-api-key',
      })
    );
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const input = { accountType: 'blockchain', sourceName: 'bitcoin', identifier: 'bc1qaddr' };
    const fp1 = assertOk(await computeAccountFingerprint(input));
    const fp2 = assertOk(await computeAccountFingerprint(input));
    expect(fp1).toBe(fp2);
  });

  it('trims identifier whitespace', async () => {
    const base = { accountType: 'blockchain', sourceName: 'bitcoin' };
    const fp1 = assertOk(await computeAccountFingerprint({ ...base, identifier: '  addr  ' }));
    const fp2 = assertOk(await computeAccountFingerprint({ ...base, identifier: 'addr' }));
    expect(fp1).toBe(fp2);
  });

  it('differs by accountType', async () => {
    const base = { sourceName: 'kraken', identifier: 'key' };
    const fp1 = assertOk(await computeAccountFingerprint({ ...base, accountType: 'exchange-api' }));
    const fp2 = assertOk(await computeAccountFingerprint({ ...base, accountType: 'exchange-csv' }));
    expect(fp1).not.toBe(fp2);
  });

  it('rejects empty accountType', async () => {
    const e = assertErr(await computeAccountFingerprint({ accountType: '', sourceName: 'x', identifier: 'y' }));
    expect(e.message).toContain('accountType');
  });

  it('rejects empty sourceName', async () => {
    const e = assertErr(
      await computeAccountFingerprint({ accountType: 'blockchain', sourceName: '', identifier: 'y' })
    );
    expect(e.message).toContain('sourceName');
  });

  it('rejects empty identifier', async () => {
    const e = assertErr(
      await computeAccountFingerprint({ accountType: 'blockchain', sourceName: 'bitcoin', identifier: '  ' })
    );
    expect(e.message).toContain('identifier');
  });

  it('returns Err when SHA-256 digest fails', async () => {
    const { sha256Hex } = await import('../sha256.js');
    vi.mocked(sha256Hex).mockRejectedValueOnce(new Error('digest failed'));

    const e = assertErr(
      await computeAccountFingerprint({
        accountType: 'blockchain',
        sourceName: 'bitcoin',
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
      await computeTxFingerprint({
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
    const fp1 = assertOk(await computeTxFingerprint(input));
    const fp2 = assertOk(await computeTxFingerprint(input));
    expect(fp1).toBe(fp2);
  });

  it('rejects missing blockchainTransactionHash', async () => {
    const e = assertErr(
      await computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'bitcoin',
        sourceType: 'blockchain',
      })
    );
    expect(e.message).toContain('blockchainTransactionHash');
  });

  it('rejects empty accountFingerprint', async () => {
    const e = assertErr(
      await computeTxFingerprint({
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
      await computeTxFingerprint({
        accountFingerprint: acctFp,
        source: '',
        sourceType: 'blockchain',
        blockchainTransactionHash: '0x1',
      })
    );
    expect(e.message).toContain('source');
  });

  it('returns Err when SHA-256 digest fails', async () => {
    const { sha256Hex } = await import('../sha256.js');
    vi.mocked(sha256Hex).mockRejectedValueOnce(new Error('digest failed'));

    const e = assertErr(
      await computeTxFingerprint({
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
      await computeTxFingerprint({
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
    const fp1 = assertOk(await computeTxFingerprint({ ...base, componentEventIds: ['b', 'a', 'c'] }));
    const fp2 = assertOk(await computeTxFingerprint({ ...base, componentEventIds: ['c', 'a', 'b'] }));
    expect(fp1).toBe(fp2);
  });

  it('does not deduplicate event IDs', async () => {
    const base = { accountFingerprint: acctFp, source: 'kucoin', sourceType: 'exchange' as const };
    const fp1 = assertOk(await computeTxFingerprint({ ...base, componentEventIds: ['a', 'b', 'a'] }));
    const fp2 = assertOk(await computeTxFingerprint({ ...base, componentEventIds: ['a', 'b'] }));
    expect(fp1).not.toBe(fp2);
  });

  it('rejects empty componentEventIds', async () => {
    const e = assertErr(
      await computeTxFingerprint({
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
      await computeTxFingerprint({
        accountFingerprint: acctFp,
        source: 'kraken',
        sourceType: 'exchange',
      })
    );
    expect(e.message).toContain('componentEventIds');
  });

  it('rejects blank componentEventIds', async () => {
    const e = assertErr(
      await computeTxFingerprint({
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
// computeMovementFingerprint
// ---------------------------------------------------------------------------

describe('computeMovementFingerprint', () => {
  it('produces expected format', () => {
    const fp = assertOk(
      computeMovementFingerprint({
        txFingerprint: 'abc123',
        movementType: 'inflow',
        position: 0,
      })
    );
    expect(fp).toBe('movement:abc123:inflow:0');
  });

  it('rejects empty txFingerprint', () => {
    const e = assertErr(computeMovementFingerprint({ txFingerprint: '', movementType: 'outflow', position: 0 }));
    expect(e.message).toContain('txFingerprint');
  });

  it('rejects negative position', () => {
    const e = assertErr(computeMovementFingerprint({ txFingerprint: 'abc', movementType: 'fee', position: -1 }));
    expect(e.message).toContain('position');
  });

  it('rejects non-integer position', () => {
    const e = assertErr(computeMovementFingerprint({ txFingerprint: 'abc', movementType: 'fee', position: 1.5 }));
    expect(e.message).toContain('position');
  });
});
