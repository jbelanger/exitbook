import { describe, expect, it } from 'vitest';

import type { RawBalanceData } from '../../../../../core/types/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import { RoutescanApiClient } from '../routescan.api-client.js';

const providerRegistry = createProviderRegistry();

describe('RoutescanApiClient Integration - Ethereum', () => {
  const config = providerRegistry.createDefaultConfig('ethereum', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('ETH');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
        if (balance.decimalAmount) {
          expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
        }
      }
    }, 30000);
  });
});

describe('RoutescanApiClient Integration - Optimism', () => {
  const config = providerRegistry.createDefaultConfig('optimism', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('ETH');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    }, 30000);
  });
});

describe('RoutescanApiClient Integration - BSC', () => {
  const config = providerRegistry.createDefaultConfig('bsc', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('BNB');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
        if (balance.decimalAmount) {
          expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
        }
      }
    }, 30000);
  });
});

describe('RoutescanApiClient Integration - Mantle', () => {
  const config = providerRegistry.createDefaultConfig('mantle', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

  describe('Health Checks', () => {
    it.skip('should report healthy when API is accessible', async () => {
      // Skipping: Mantle API endpoint may not be available or configured correctly
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it.skip('should fetch address balance successfully', async () => {
      // Skipping: Mantle API endpoint may not be available or configured correctly
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('MNT');
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    }, 30000);
  });
});
