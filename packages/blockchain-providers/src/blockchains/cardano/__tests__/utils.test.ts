import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CardanoUtils, createRawBalanceData, lovelaceToAda } from '../utils.js';

// Mock Cardano SDK modules (must be at the top level before imports)
const mockDeriveFunction = vi.fn();
const mockHashFunction = vi.fn();
const mockToBech32Function = vi.fn();
const mockToAddressFunction = vi.fn();

const createDerivedKeyMock = () => ({
  derive: vi.fn((_innerIndices: number[]) => createDerivedKeyMock()),
  toRawKey: vi.fn(() => ({
    hash: vi.fn(() => ({
      hex: mockHashFunction,
    })),
  })),
});

vi.mock('@cardano-sdk/crypto', () => ({
  Bip32PublicKey: {
    fromHex: vi.fn(() => ({
      derive: mockDeriveFunction,
    })),
  },
}));

vi.mock('@cardano-sdk/core', () => ({
  Cardano: {
    BaseAddress: {
      fromCredentials: vi.fn(() => ({
        toAddress: mockToAddressFunction,
      })),
    },
    CredentialType: {
      KeyHash: 0,
    },
    NetworkId: {
      Mainnet: 1,
    },
  },
}));

describe('Cardano balance-utils', () => {
  describe('lovelaceToAda', () => {
    it('should convert lovelace string to ADA', () => {
      expect(lovelaceToAda('1000000')).toBe('1');
      expect(lovelaceToAda('500000')).toBe('0.5');
      expect(lovelaceToAda('2500000')).toBe('2.5');
      expect(lovelaceToAda('0')).toBe('0');
    });

    it('should convert lovelace number to ADA', () => {
      expect(lovelaceToAda(1000000)).toBe('1');
      expect(lovelaceToAda(500000)).toBe('0.5');
      expect(lovelaceToAda(2500000)).toBe('2.5');
      expect(lovelaceToAda(0)).toBe('0');
    });

    it('should handle large lovelace amounts', () => {
      const lovelace = '45000000000000'; // 45 billion lovelace = 45 million ADA
      const ada = lovelaceToAda(lovelace);
      expect(ada).toBe('45000000');
    });

    it('should handle fractional lovelace amounts', () => {
      expect(lovelaceToAda('1')).toBe('0.000001');
      expect(lovelaceToAda('100')).toBe('0.0001');
      expect(lovelaceToAda('123456')).toBe('0.123456');
    });

    it('should handle dust amounts (single lovelace)', () => {
      expect(lovelaceToAda('1')).toBe('0.000001');
      expect(lovelaceToAda('10')).toBe('0.00001');
    });

    it('should handle typical transaction fees', () => {
      expect(lovelaceToAda('174261')).toBe('0.174261');
      expect(lovelaceToAda('200000')).toBe('0.2');
      expect(lovelaceToAda('5000000')).toBe('5'); // Large fee
    });

    it('should not use scientific notation for very small amounts', () => {
      const result = lovelaceToAda('1');
      expect(result).toBe('0.000001');
      expect(result).not.toContain('e');
    });

    it('should not use scientific notation for very large amounts', () => {
      const maxSupply = '45000000000000'; // 45 billion ADA in lovelace
      const result = lovelaceToAda(maxSupply);
      expect(result).toBe('45000000');
      expect(result).not.toContain('e');
    });

    it('should preserve precision for complex amounts', () => {
      expect(lovelaceToAda('123456789')).toBe('123.456789');
      expect(lovelaceToAda('1234567')).toBe('1.234567');
    });
  });

  describe('createRawBalanceData', () => {
    it('should create balance data with correct structure', () => {
      const lovelace = '1000000';
      const ada = '1';
      const result = createRawBalanceData(lovelace, ada);

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '1',
        rawAmount: '1000000',
        symbol: 'ADA',
      });
    });

    it('should handle zero balance', () => {
      const result = createRawBalanceData('0', '0');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '0',
        rawAmount: '0',
        symbol: 'ADA',
      });
    });

    it('should handle large balance', () => {
      const lovelace = '45000000000000';
      const ada = '45000000';
      const result = createRawBalanceData(lovelace, ada);

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '45000000',
        rawAmount: '45000000000000',
        symbol: 'ADA',
      });
    });

    it('should handle dust amounts', () => {
      const result = createRawBalanceData('1', '0.000001');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '0.000001',
        rawAmount: '1',
        symbol: 'ADA',
      });
    });

    it('should always set correct decimals and symbol', () => {
      const result = createRawBalanceData('123456789', '123.456789');

      expect(result.decimals).toBe(6);
      expect(result.symbol).toBe('ADA');
    });

    it('should handle typical balance amounts', () => {
      const result = createRawBalanceData('5000000', '5');

      expect(result).toEqual({
        decimals: 6,
        decimalAmount: '5',
        rawAmount: '5000000',
        symbol: 'ADA',
      });
    });
  });
});

describe('CardanoUtils', () => {
  describe('isExtendedPublicKey', () => {
    it('should return true for valid 128-character hex xpub', () => {
      // 128 hex characters (64 bytes: 32 bytes public key + 32 bytes chain code)
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(CardanoUtils.isExtendedPublicKey(validXpub)).toBe(true);
    });

    it('should return true for valid uppercase hex xpub', () => {
      const validXpub =
        '0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF';
      expect(CardanoUtils.isExtendedPublicKey(validXpub)).toBe(true);
    });

    it('should return true for valid mixed-case hex xpub', () => {
      const validXpub =
        '0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789aBcDeF';
      expect(CardanoUtils.isExtendedPublicKey(validXpub)).toBe(true);
    });

    it('should return false for regular Shelley mainnet payment address', () => {
      const shelleyAddress = 'addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2';
      expect(CardanoUtils.isExtendedPublicKey(shelleyAddress)).toBe(false);
    });

    it('should return false for regular Shelley testnet payment address', () => {
      const testnetAddress =
        'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';
      expect(CardanoUtils.isExtendedPublicKey(testnetAddress)).toBe(false);
    });

    it('should return false for Shelley mainnet stake address', () => {
      const stakeAddress = 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha';
      expect(CardanoUtils.isExtendedPublicKey(stakeAddress)).toBe(false);
    });

    it('should return false for Byron address (DdzFF prefix)', () => {
      const byronAddress = 'DdzFFzCqrhsyLWVXEd1gB3UgcPMFrN7e7rZgFpZ1V2EYdqPwXU';
      expect(CardanoUtils.isExtendedPublicKey(byronAddress)).toBe(false);
    });

    it('should return false for Byron address (Ae2 prefix)', () => {
      const byronAddress = 'Ae2tdPwUPEZCanmBz5g2GEwFqKTKpNJcGYPKfDxoNeKZ8bRHr8366kseiK2';
      expect(CardanoUtils.isExtendedPublicKey(byronAddress)).toBe(false);
    });

    it('should return false for hex string shorter than 128 characters', () => {
      const shortHex = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5';
      expect(CardanoUtils.isExtendedPublicKey(shortHex)).toBe(false);
    });

    it('should return false for hex string longer than 128 characters', () => {
      const longHex =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefaa';
      expect(CardanoUtils.isExtendedPublicKey(longHex)).toBe(false);
    });

    it('should return false for non-hex characters', () => {
      const invalidHex =
        'g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(CardanoUtils.isExtendedPublicKey(invalidHex)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(CardanoUtils.isExtendedPublicKey('')).toBe(false);
    });

    it('should return false for string with spaces', () => {
      const hexWithSpaces =
        '0123456789abcdef 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(CardanoUtils.isExtendedPublicKey(hexWithSpaces)).toBe(false);
    });

    it('should return false for string with hyphens', () => {
      const hexWithHyphens =
        '0123456789abcdef-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(CardanoUtils.isExtendedPublicKey(hexWithHyphens)).toBe(false);
    });

    it('should return false for special characters', () => {
      const invalidString = '!@#$%^&*()_+{}[]|\\:";\'<>?,./';
      expect(CardanoUtils.isExtendedPublicKey(invalidString)).toBe(false);
    });
  });

  describe('getAddressEra', () => {
    describe('Shelley era addresses', () => {
      it('should detect Shelley mainnet payment address (addr1)', () => {
        const address = 'addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });

      it('should detect Shelley testnet payment address (addr_test1)', () => {
        const address =
          'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });

      it('should detect Shelley mainnet stake address (stake1)', () => {
        const address = 'stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zqgk4hha';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });

      it('should detect Shelley testnet stake address (stake_test1)', () => {
        const address = 'stake_test1uz8kw0l83y40w5ewfrlqazl4j3znaqkz3c6x0k5y64f9kfcv2mfek';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });

      it('should detect Shelley mainnet enterprise address (addr1v)', () => {
        const address = 'addr1vxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpc94aen7';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });

      it('should detect Shelley mainnet reward address (addr1w)', () => {
        const address = 'addr1wxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpcm3kwlh';
        expect(CardanoUtils.getAddressEra(address)).toBe('shelley');
      });
    });

    describe('Byron era addresses', () => {
      it('should detect Byron address with DdzFF prefix', () => {
        const address = 'DdzFFzCqrhsyLWVXEd1gB3UgcPMFrN7e7rZgFpZ1V2EYdqPwXU';
        expect(CardanoUtils.getAddressEra(address)).toBe('byron');
      });

      it('should detect Byron address with Ae2 prefix', () => {
        const address = 'Ae2tdPwUPEZCanmBz5g2GEwFqKTKpNJcGYPKfDxoNeKZ8bRHr8366kseiK2';
        expect(CardanoUtils.getAddressEra(address)).toBe('byron');
      });

      it('should detect different Byron DdzFF addresses', () => {
        const address1 =
          'DdzFFzCqrhtCNjPk5Lei7E1FxnoqMoAYtJ8VjAWbFmDb614nNBWBwv3kt6QHJa59cGezzf6piMWsbK7sWRB5sv325QqWdRuusMqqLte';
        const address2 =
          'DdzFFzCqrhsjZHKn4pvjA8dqYKHgL8qhp7sY6c5zBT3U5YrBF8QRiCT4Rd9cSWx4nVRNqPPfYv5rHcHJZX8Jh1q4H3t5Q7Q3G8k3';
        expect(CardanoUtils.getAddressEra(address1)).toBe('byron');
        expect(CardanoUtils.getAddressEra(address2)).toBe('byron');
      });

      it('should detect different Byron Ae2 addresses', () => {
        const address1 = 'Ae2tdPwUPEZHu3NZa6kCwet2msq4xrBXKHBDvogFKwMsF18Jca8JHLRBas7';
        const address2 = 'Ae2tdPwUPEZ8LAVy21zj4BF97iL5EjrGvmH3nKhFbTqLsM8rqF9uYsKWN7P';
        expect(CardanoUtils.getAddressEra(address1)).toBe('byron');
        expect(CardanoUtils.getAddressEra(address2)).toBe('byron');
      });
    });

    describe('Invalid/unknown addresses', () => {
      it('should return unknown for invalid address format', () => {
        const address = 'invalid_address_123';
        expect(CardanoUtils.getAddressEra(address)).toBe('unknown');
      });

      it('should return unknown for empty string', () => {
        expect(CardanoUtils.getAddressEra('')).toBe('unknown');
      });

      it('should return unknown for Bitcoin address', () => {
        const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
        expect(CardanoUtils.getAddressEra(address)).toBe('unknown');
      });

      it('should return unknown for Ethereum address', () => {
        const address = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb';
        expect(CardanoUtils.getAddressEra(address)).toBe('unknown');
      });

      it('should return unknown for Solana address', () => {
        const address = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
        expect(CardanoUtils.getAddressEra(address)).toBe('unknown');
      });

      it('should return unknown for random strings', () => {
        expect(CardanoUtils.getAddressEra('abc123')).toBe('unknown');
        expect(CardanoUtils.getAddressEra('test')).toBe('unknown');
        expect(CardanoUtils.getAddressEra('12345')).toBe('unknown');
      });

      it('should return unknown for xpub (extended public key)', () => {
        const xpub =
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        expect(CardanoUtils.getAddressEra(xpub)).toBe('unknown');
      });
    });
  });

  describe('deriveAddressesFromXpub', () => {
    // Mock the Cardano SDK modules before the tests run
    beforeEach(() => {
      vi.resetModules();
      vi.clearAllMocks();
    });

    it('should derive correct number of addresses (gap * 2 for both chains)', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const gap = 5;

      // Setup mock chain
      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });

      let addressCounter = 0;
      mockToBech32Function.mockImplementation(() => `addr1_mock_${addressCounter++}`);

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, gap);

      // Should derive gap * 2 addresses (external + internal chains)
      expect(result).toHaveLength(gap * 2);
    });

    it('should derive addresses with correct fields', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });
      mockToBech32Function.mockReturnValue('addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2');

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, 2);

      // Check that all addresses have required fields
      for (const addr of result) {
        expect(addr).toHaveProperty('address');
        expect(addr).toHaveProperty('derivationPath');
        expect(addr).toHaveProperty('role');
        expect(typeof addr.address).toBe('string');
        expect(typeof addr.derivationPath).toBe('string');
        expect(['external', 'internal']).toContain(addr.role);
      }
    });

    it('should follow CIP-1852 derivation path format', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });
      mockToBech32Function.mockReturnValue('addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2');

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, 3);

      // Check external addresses (role=0)
      const externalAddresses = result.filter((addr) => addr.role === 'external');
      expect(externalAddresses).toHaveLength(3);
      expect(externalAddresses[0]?.derivationPath).toBe('0/0');
      expect(externalAddresses[1]?.derivationPath).toBe('0/1');
      expect(externalAddresses[2]?.derivationPath).toBe('0/2');

      // Check internal addresses (role=1)
      const internalAddresses = result.filter((addr) => addr.role === 'internal');
      expect(internalAddresses).toHaveLength(3);
      expect(internalAddresses[0]?.derivationPath).toBe('1/0');
      expect(internalAddresses[1]?.derivationPath).toBe('1/1');
      expect(internalAddresses[2]?.derivationPath).toBe('1/2');
    });

    it('should use default gap of 10 when not specified', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });

      let addressCounter = 0;
      mockToBech32Function.mockImplementation(() => `addr1_mock_${addressCounter++}`);

      // Call without gap parameter (should default to 10)
      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub);

      // Should derive 10 * 2 = 20 addresses
      expect(result).toHaveLength(20);
    });

    it('should throw error for invalid xpub format', async () => {
      const invalidXpub = 'not-a-valid-xpub';

      await expect(CardanoUtils.deriveAddressesFromXpub(invalidXpub)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for empty xpub', async () => {
      await expect(CardanoUtils.deriveAddressesFromXpub('')).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for xpub that is too short', async () => {
      const shortXpub = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5';

      await expect(CardanoUtils.deriveAddressesFromXpub(shortXpub)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for xpub that is too long', async () => {
      const longXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefaa';

      await expect(CardanoUtils.deriveAddressesFromXpub(longXpub)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for non-hex xpub', async () => {
      const nonHexXpub =
        'g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      await expect(CardanoUtils.deriveAddressesFromXpub(nonHexXpub)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for regular Shelley address', async () => {
      const shelleyAddress = 'addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2';

      await expect(CardanoUtils.deriveAddressesFromXpub(shelleyAddress)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should throw error for Byron address', async () => {
      const byronAddress = 'DdzFFzCqrhsyLWVXEd1gB3UgcPMFrN7e7rZgFpZ1V2EYdqPwXU';

      await expect(CardanoUtils.deriveAddressesFromXpub(byronAddress)).rejects.toThrow(
        'Invalid Cardano extended public key format'
      );
    });

    it('should interleave external and internal addresses correctly', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });

      let addressCounter = 0;
      mockToBech32Function.mockImplementation(() => `addr1_mock_${addressCounter++}`);

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, 2);

      // Should have interleaved pattern: external (0/0), internal (1/0), external (0/1), internal (1/1)
      expect(result[0]?.role).toBe('external');
      expect(result[0]?.derivationPath).toBe('0/0');
      expect(result[1]?.role).toBe('internal');
      expect(result[1]?.derivationPath).toBe('1/0');
      expect(result[2]?.role).toBe('external');
      expect(result[2]?.derivationPath).toBe('0/1');
      expect(result[3]?.role).toBe('internal');
      expect(result[3]?.derivationPath).toBe('1/1');
    });

    it('should handle gap of 1 (minimum)', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });
      mockToBech32Function.mockReturnValue('addr1qxy48p57n5ezq8fjr6jd2mf3gfy9s6zj53d9q8mxp6fvhpr6h20c2');

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, 1);

      expect(result).toHaveLength(2); // 1 external + 1 internal
      expect(result[0]?.role).toBe('external');
      expect(result[1]?.role).toBe('internal');
    });

    it('should handle large gap values', async () => {
      const validXpub =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const largeGap = 100;

      mockDeriveFunction.mockImplementation(() => createDerivedKeyMock());

      mockHashFunction.mockReturnValue('mock-hash');
      mockToAddressFunction.mockReturnValue({
        toBech32: mockToBech32Function,
      });

      let addressCounter = 0;
      mockToBech32Function.mockImplementation(() => `addr1_mock_${addressCounter++}`);

      const result = await CardanoUtils.deriveAddressesFromXpub(validXpub, largeGap);

      expect(result).toHaveLength(largeGap * 2);
      expect(result.filter((a) => a.role === 'external')).toHaveLength(largeGap);
      expect(result.filter((a) => a.role === 'internal')).toHaveLength(largeGap);
    });
  });
});
