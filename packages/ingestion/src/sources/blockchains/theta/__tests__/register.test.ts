/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { describe, expect, test, vi } from 'vitest';

import { evmAdapters } from '../../evm/register.js';
import { allBlockchainAdapters } from '../../index.js';
import { ThetaImporter } from '../importer.js';
import { ThetaProcessor } from '../processor.js';
import { thetaAdapters } from '../register.js';

function createProviderManager(): BlockchainProviderManager {
  return {
    autoRegisterFromConfig: vi.fn().mockReturnValue([]),
    getProviders: vi.fn().mockReturnValue([]),
    getAddressInfo: vi.fn(),
    getTokenMetadata: vi.fn(),
  } as unknown as BlockchainProviderManager;
}

describe('theta/register', () => {
  test('keeps Theta out of the EVM adapter list and registers it exactly once', () => {
    expect(evmAdapters.some((adapter) => adapter.blockchain === 'theta')).toBe(false);

    const thetaInAll = allBlockchainAdapters.filter((adapter) => adapter.blockchain === 'theta');
    expect(thetaInAll).toEqual(thetaAdapters);
  });

  test('creates Theta importer and processor from the Theta adapter', () => {
    const providerManager = createProviderManager();
    const [thetaAdapter] = thetaAdapters;

    const importer = thetaAdapter!.createImporter(providerManager, 'thetascan');
    const processor = thetaAdapter!.createProcessor({
      providerManager,
      scamDetectionService: undefined,
      accountId: 1,
    });

    expect(importer).toBeInstanceOf(ThetaImporter);
    expect(processor).toBeInstanceOf(ThetaProcessor);
    expect(providerManager.autoRegisterFromConfig).toHaveBeenCalledWith('theta', 'thetascan');
  });

  test('normalizes valid Theta addresses and rejects invalid ones', () => {
    const [thetaAdapter] = thetaAdapters;
    const valid = thetaAdapter!.normalizeAddress('0x1111111111111111111111111111111111111111');
    const invalid = thetaAdapter!.normalizeAddress('not-a-theta-address');

    expect(valid.isOk()).toBe(true);
    expect(invalid.isErr()).toBe(true);
  });
});
