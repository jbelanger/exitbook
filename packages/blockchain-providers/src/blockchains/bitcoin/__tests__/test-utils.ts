import type { Currency, Result } from '@exitbook/core';
import { expect } from 'vitest';

import type { BitcoinChainConfig } from '../chain-config.interface.js';

// ── Mock chain configs ──────────────────────────────────────────────

export const mockBitcoinChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin',
  displayName: 'Bitcoin',
  nativeCurrency: 'BTC' as Currency,
  nativeDecimals: 8,
};

export const mockDogecoinChainConfig: BitcoinChainConfig = {
  chainName: 'dogecoin',
  displayName: 'Dogecoin',
  nativeCurrency: 'DOGE' as Currency,
  nativeDecimals: 8,
};

export const mockLitecoinChainConfig: BitcoinChainConfig = {
  chainName: 'litecoin',
  displayName: 'Litecoin',
  nativeCurrency: 'LTC' as Currency,
  nativeDecimals: 8,
};

export const mockBcashChainConfig: BitcoinChainConfig = {
  chainName: 'bitcoin-cash',
  displayName: 'Bitcoin Cash',
  nativeCurrency: 'BCH' as Currency,
  nativeDecimals: 8,
};

// ── Result assertion helpers ────────────────────────────────────────

/**
 * Asserts that a Result is Ok and returns the unwrapped value.
 * Eliminates the repetitive `expect(result.isOk()).toBe(true); if (result.isOk()) { ... }` pattern.
 *
 * @example
 * const normalized = expectOk(mapBlockstreamTransaction(rawData, config));
 * expect(normalized.id).toBe('txid');
 */
export function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (!result.isOk()) {
    // This line is never reached due to the assertion above,
    // but satisfies TypeScript's control flow analysis
    throw new Error('Expected Ok result');
  }
  return result.value;
}

/**
 * Asserts that a Result is Err and returns the unwrapped error.
 *
 * @example
 * const error = expectErr(mapBlockstreamTransaction(badData, config));
 * expect(error.message).toContain('validation');
 */
export function expectErr<T, E>(result: Result<T, E>): E {
  expect(result.isErr()).toBe(true);
  if (!result.isErr()) {
    throw new Error('Expected Err result');
  }
  return result.error;
}
