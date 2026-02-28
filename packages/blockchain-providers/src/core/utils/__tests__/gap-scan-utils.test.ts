import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockchainProviderManager } from '../../manager/provider-manager.js';
import { performAddressGapScanning } from '../gap-scan-utils.js';

const mockProviderManager = {
  hasAddressTransactions: vi.fn(),
} as unknown as BlockchainProviderManager;

describe('performAddressGapScanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array for empty input', async () => {
    const result = await performAddressGapScanning(
      { blockchain: 'bitcoin', derivedAddresses: [], gapLimit: 20 },
      mockProviderManager
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().addresses).toEqual([]);
  });

  it('should stop after gap limit consecutive unused addresses', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    vi.mocked(mockProviderManager.hasAddressTransactions)
      .mockResolvedValueOnce(ok({ data: true, providerName: 'mock' })) // addr1 active
      .mockResolvedValue(ok({ data: false, providerName: 'mock' })); // rest inactive

    const result = await performAddressGapScanning(
      {
        blockchain: 'bitcoin',
        derivedAddresses: ['addr1', 'addr2', 'addr3', 'addr4', 'addr5'],
        gapLimit: 2,
      },
      mockProviderManager
    );

    expect(result.isOk()).toBe(true);
    // addr1 (active, index 0) + gapLimit 2 = indices 0..2
    expect(result._unsafeUnwrap().addresses).toEqual(['addr1', 'addr2', 'addr3']);
  });

  it('should fail after maxErrors consecutive API errors', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    vi.mocked(mockProviderManager.hasAddressTransactions).mockResolvedValue(err(new Error('API failure')));

    const result = await performAddressGapScanning(
      {
        blockchain: 'cardano',
        derivedAddresses: ['addr1', 'addr2', 'addr3'],
        gapLimit: 20,
        maxErrors: 2,
      },
      mockProviderManager
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Failed to scan addresses');
  });

  it('should use gapLimit as fallback when no addresses have activity', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    vi.mocked(mockProviderManager.hasAddressTransactions).mockResolvedValue(ok({ data: false, providerName: 'mock' }));

    const result = await performAddressGapScanning(
      {
        blockchain: 'bitcoin',
        derivedAddresses: ['a', 'b', 'c', 'd', 'e'],
        gapLimit: 3,
      },
      mockProviderManager
    );

    expect(result.isOk()).toBe(true);
    // No activity: targetIndex = gapLimit - 1 = 2, so indices 0..2
    expect(result._unsafeUnwrap().addresses).toEqual(['a', 'b', 'c']);
  });

  it('should work with cardano blockchain parameter', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    vi.mocked(mockProviderManager.hasAddressTransactions)
      .mockResolvedValueOnce(ok({ data: true, providerName: 'mock' }))
      .mockResolvedValue(ok({ data: false, providerName: 'mock' }));

    const result = await performAddressGapScanning(
      {
        blockchain: 'cardano',
        derivedAddresses: ['addr1q...', 'addr1q...2', 'addr1q...3'],
        gapLimit: 2,
      },
      mockProviderManager
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().addresses).toHaveLength(3);

    // Verify this test's calls use the cardano blockchain name
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    expect(mockProviderManager.hasAddressTransactions).toHaveBeenCalledTimes(3);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
    expect(mockProviderManager.hasAddressTransactions).toHaveBeenNthCalledWith(1, 'cardano', expect.anything());
  });
});
