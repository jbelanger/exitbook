import { describe, expect, it } from 'vitest';

import { computeTxFingerprint, computeLinkFingerprint } from '../fingerprint-utils.js';

describe('computeTxFingerprint', () => {
  it('should compute fingerprint from source_name and external_id', () => {
    const result = computeTxFingerprint({
      source_name: 'kraken',
      external_id: 'TRADE-12345',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('kraken:TRADE-12345');
  });

  it('should handle blockchain transactions with colon in source_name', () => {
    const result = computeTxFingerprint({
      source_name: 'blockchain:bitcoin',
      external_id: 'abc123def456',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('blockchain:bitcoin:abc123def456');
  });

  it('should return error if source_name is empty', () => {
    const result = computeTxFingerprint({
      source_name: '',
      external_id: 'TRADE-12345',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('source_name must not be empty');
  });

  it('should return error if external_id is empty', () => {
    const result = computeTxFingerprint({
      source_name: 'kraken',
      external_id: '',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('external_id must not be empty');
  });
});

describe('computeLinkFingerprint', () => {
  it('should compute link fingerprint with sorted tx fingerprints', () => {
    const result = computeLinkFingerprint({
      source_tx: 'kraken:TRADE-123',
      target_tx: 'blockchain:bitcoin:abc',
      asset: 'BTC',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe('link:blockchain:bitcoin:abc:kraken:TRADE-123:BTC');
  });

  it('should produce same fingerprint regardless of source/target order', () => {
    const fp1 = computeLinkFingerprint({
      source_tx: 'kraken:TRADE-123',
      target_tx: 'blockchain:bitcoin:abc',
      asset: 'BTC',
    });

    const fp2 = computeLinkFingerprint({
      source_tx: 'blockchain:bitcoin:abc',
      target_tx: 'kraken:TRADE-123',
      asset: 'BTC',
    });

    expect(fp1._unsafeUnwrap()).toBe(fp2._unsafeUnwrap());
  });

  it('should return error if source_tx is empty', () => {
    const result = computeLinkFingerprint({
      source_tx: '',
      target_tx: 'kraken:TRADE-123',
      asset: 'BTC',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('source_tx must not be empty');
  });

  it('should return error if target_tx is empty', () => {
    const result = computeLinkFingerprint({
      source_tx: 'kraken:TRADE-123',
      target_tx: '',
      asset: 'BTC',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('target_tx must not be empty');
  });

  it('should return error if asset is empty', () => {
    const result = computeLinkFingerprint({
      source_tx: 'kraken:TRADE-123',
      target_tx: 'blockchain:bitcoin:abc',
      asset: '',
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('asset must not be empty');
  });
});
