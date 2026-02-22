import type { BitcoinChainConfig } from '@exitbook/blockchain-providers';
import type { Currency } from '@exitbook/core';
import { describe, expect, test } from 'vitest';

import { normalizeBitcoinAddress } from '../address-utils.js';

const BTC_CONFIG: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC' as Currency,
  nativeDecimals: 8,
  addressPrefixes: ['1', '3'],
};

const LTC_CONFIG: BitcoinChainConfig = {
  chainName: 'litecoin',
  displayName: 'Litecoin',
  nativeCurrency: 'LTC' as Currency,
  nativeDecimals: 8,
  addressPrefixes: ['L', 'M'],
};

describe('normalizeBitcoinAddress', () => {
  describe('xpub / ypub / zpub', () => {
    test('accepts valid xpub', () => {
      const xpub = 'xpub' + 'a'.repeat(107);
      const result = normalizeBitcoinAddress(xpub, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBe(xpub);
    });

    test('rejects xpub that is too short', () => {
      const result = normalizeBitcoinAddress('xpub' + 'a'.repeat(10), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toMatch(/Invalid xpub format/);
    });
  });

  describe('bech32', () => {
    test('accepts valid bc1 address', () => {
      const address = 'bc1q' + 'a'.repeat(38);
      const result = normalizeBitcoinAddress(address, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    test('lowercases BC1 to bc1', () => {
      const address = 'BC1Q' + 'a'.repeat(38);
      const result = normalizeBitcoinAddress(address, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toMatch(/^bc1/);
    });

    test('rejects bc1 address with special characters', () => {
      // Special chars remain invalid after lowercasing
      const result = normalizeBitcoinAddress('bc1q!@#$' + 'a'.repeat(35), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toMatch(/Invalid Bech32 address format/);
    });

    test('accepts valid ltc1 address', () => {
      const address = 'ltc1q' + 'a'.repeat(35);
      const result = normalizeBitcoinAddress(address, LTC_CONFIG);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('CashAddr (Bitcoin Cash)', () => {
    test('accepts full bitcoincash: prefix address', () => {
      const address = 'bitcoincash:q' + 'a'.repeat(41);
      const result = normalizeBitcoinAddress(address, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    test('rejects malformed bitcoincash: address', () => {
      const result = normalizeBitcoinAddress('bitcoincash:q' + 'a'.repeat(10), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toMatch(/Invalid Bitcoin Cash CashAddr format/);
    });

    test('accepts short cashaddr format', () => {
      const address = 'q' + 'a'.repeat(41);
      const result = normalizeBitcoinAddress(address, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    test('rejects malformed short cashaddr', () => {
      const result = normalizeBitcoinAddress('q' + 'a'.repeat(5), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toMatch(/Invalid Bitcoin Cash CashAddr short format/);
    });
  });

  describe('legacy Base58', () => {
    test('accepts valid P2PKH address', () => {
      const address = '1' + 'a'.repeat(33);
      const result = normalizeBitcoinAddress(address, BTC_CONFIG);
      expect(result.isOk()).toBe(true);
    });

    test('rejects address with unknown prefix', () => {
      const result = normalizeBitcoinAddress('X' + 'a'.repeat(33), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toMatch(/must start with one of/);
    });

    test('rejects Base58 address that is too short', () => {
      const result = normalizeBitcoinAddress('1abc', BTC_CONFIG);
      expect(result.isErr()).toBe(true);
    });

    test('rejects Base58 address with invalid characters (0, O, I, l)', () => {
      // '0', 'O', 'I', 'l' are not in the Base58 alphabet
      const result = normalizeBitcoinAddress('1' + '0'.repeat(33), BTC_CONFIG);
      expect(result.isErr()).toBe(true);
    });
  });
});
