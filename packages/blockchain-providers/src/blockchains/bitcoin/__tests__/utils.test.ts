import { HDKey } from '@scure/bip32';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { BlockchainProviderManager } from '../../../core/manager/provider-manager.js';
import type { BitcoinWalletAddress } from '../types.js';
import {
  canonicalizeBitcoinAddress,
  deriveBitcoinAddressesFromXpub,
  getBitcoinAddressType,
  isBitcoinXpub,
  performBitcoinAddressGapScanning,
  satoshisToBtcString,
} from '../utils.js';

describe('Bitcoin Utils', () => {
  describe('canonicalizeBitcoinAddress', () => {
    it('should normalize Bech32 addresses to lowercase', () => {
      expect(canonicalizeBitcoinAddress('BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKWZJAQ87E')).toBe(
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkwzjaq87e'
      );
      expect(canonicalizeBitcoinAddress('LTC1q56p0q654321')).toBe('ltc1q56p0q654321');
    });

    it('should normalize CashAddr to lowercase', () => {
      expect(canonicalizeBitcoinAddress('BITCOINCASH:QP3WJQZ')).toBe('bitcoincash:qp3wjqz');
      expect(canonicalizeBitcoinAddress('QP3WJQZ')).toBe('qp3wjqz');
    });

    it('should preserve checks in Legacy (Base58) addresses', () => {
      expect(canonicalizeBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(
        '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      );
    });

    it('should preserve checks in xpub/ypub/zpub', () => {
      expect(
        canonicalizeBitcoinAddress(
          'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
        )
      ).toBe(
        'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
      );
    });
  });

  describe('isBitcoinXpub', () => {
    it('should identify xpub, ypub, zpub', () => {
      expect(isBitcoinXpub('xpub...')).toBe(true);
      expect(isBitcoinXpub('ypub...')).toBe(true);
      expect(isBitcoinXpub('zpub...')).toBe(true);
    });

    it('should return false for regular addresses', () => {
      expect(isBitcoinXpub('bc1q...')).toBe(false);
      expect(isBitcoinXpub('1A1z...')).toBe(false);
    });
  });

  describe('getBitcoinAddressType', () => {
    it('should return correct types', () => {
      expect(getBitcoinAddressType('xpub...')).toBe('xpub');
      expect(getBitcoinAddressType('ypub...')).toBe('ypub');
      expect(getBitcoinAddressType('zpub...')).toBe('zpub');
      expect(getBitcoinAddressType('bc1q...')).toBe('address');
    });
  });

  describe('satoshisToBtcString', () => {
    it('should convert correctly', () => {
      expect(satoshisToBtcString(100000000)).toBe('1');
      expect(satoshisToBtcString(1)).toBe('0.00000001');
    });
  });

  describe('deriveBitcoinAddressesFromXpub', () => {
    it('should derive addresses correctly for zpub (native segwit)', async () => {
      // Mock HDKey behavior for this specific test
      const mockDeriveChild = vi.fn().mockReturnValue({
        deriveChild: vi.fn().mockReturnValue({
          // Valid compressed public key
          publicKey: Buffer.from('03e60244795b6070a927a3c3f9149486c990264b3017a41922424097e3a9c78d46', 'hex'),
        }),
      });

      // Use spyOn with the class directly
      const fromExtendedKeySpy = vi.spyOn(HDKey, 'fromExtendedKey').mockReturnValue({
        deriveChild: mockDeriveChild,
      } as unknown as HDKey);

      const zpub =
        'zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WjedT1cd8DoNE8Y4E9X6T5kG1tq1gGyxjQz5RjL5q2kL1d1g1yL1d1g1yL1d1g1yL1d1g1';

      const result = await deriveBitcoinAddressesFromXpub(zpub, 2);

      expect(result).toHaveLength(4); // 2 gap * 2 chains = 4 addresses
      expect(result[0]?.type).toBe('bech32');
      expect(fromExtendedKeySpy).toHaveBeenCalled();

      fromExtendedKeySpy.mockRestore();
    });
  });

  // Mocks for ProviderManager
  const mockProviderManager = {
    executeWithFailoverOnce: vi.fn(),
  } as unknown as BlockchainProviderManager;

  describe('performBitcoinAddressGapScanning', () => {
    it('should stop after gap limit', async () => {
      const walletAddress: BitcoinWalletAddress = {
        address: 'xpub...',
        type: 'xpub',
        derivedAddresses: ['addr1', 'addr2', 'addr3', 'addr4', 'addr5'],
      };

      // Mock activity: addr1 active, others inactive
      // eslint-disable-next-line @typescript-eslint/unbound-method -- acceptable for test
      vi.mocked(mockProviderManager.executeWithFailoverOnce)
        .mockResolvedValueOnce(ok({ data: true, providerName: 'mock' })) // addr1
        .mockResolvedValue(ok({ data: false, providerName: 'mock' })); // others

      await performBitcoinAddressGapScanning(walletAddress, 'bitcoin', mockProviderManager, 2);

      // Should keep addr1 (active) + 2 gap (addr2, addr3)
      // So total 3 addresses
      expect(walletAddress.derivedAddresses).toHaveLength(3);
      expect(walletAddress.derivedAddresses).toEqual(['addr1', 'addr2', 'addr3']);
    });
  });
});
