import type { Currency } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { describe, expect, test } from 'vitest';

import type { DeepPartial } from '../../../../shared/test-utils/index.js';
import type { LedgerEntryWithRaw } from '../../shared/strategies/grouping.js';
import { coinbaseGrossAmounts } from '../coinbase-interpretation.js';

function buildEntry(
  overrides?: DeepPartial<LedgerEntryWithRaw<RawCoinbaseLedgerEntry>>
): LedgerEntryWithRaw<RawCoinbaseLedgerEntry> {
  const timestamp = 1_722_461_782_000;
  const base: LedgerEntryWithRaw<RawCoinbaseLedgerEntry> = {
    eventId: 'entry-1',
    normalized: {
      id: 'entry-1',
      correlationId: 'corr-1',
      timestamp,
      type: 'advanced_trade_fill',
      assetSymbol: 'USDC' as Currency,
      amount: '61.902',
      status: 'success',
    },
    raw: {
      id: 'entry-1',
      type: 'advanced_trade_fill',
      created_at: new Date(timestamp).toISOString(),
      status: 'ok',
      amount: { amount: '61.902', currency: 'USDC' },
    },
  };

  return {
    ...base,
    ...(overrides || {}),
    normalized: {
      ...base.normalized,
      ...(overrides?.normalized || {}),
    },
    raw: {
      ...base.raw,
      ...(overrides?.raw || {}),
    },
  } as LedgerEntryWithRaw<RawCoinbaseLedgerEntry>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coinbase API v2 interpretation tests
//
// Each section maps to a Coinbase entry type. See coinbase-interpretation.ts
// for the full amount/fee semantics reference table.
// ─────────────────────────────────────────────────────────────────────────────

describe('coinbaseGrossAmounts', () => {
  // ── advanced_trade_fill ──────────────────────────────────────────────────
  // amount = qty × fill_price (gross trade value). Commission is NOT in
  // amount but IS deducted from wallet balance. Fee uses settlement='balance'.

  describe('advanced_trade_fill', () => {
    test('inflow without commission: no fee', () => {
      const entry = buildEntry({
        normalized: { type: 'advanced_trade_fill', amount: '317.60', assetSymbol: 'USDC' as Currency },
        raw: { type: 'advanced_trade_fill', amount: { amount: '317.60', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('317.6');
      expect(result.inflows[0]?.netAmount).toBe('317.6');
      expect(result.fees).toHaveLength(0);
    });

    test('outflow without commission: no fee', () => {
      const entry = buildEntry({
        normalized: { type: 'advanced_trade_fill', amount: '-72.31', assetSymbol: 'USDC' as Currency },
        raw: { type: 'advanced_trade_fill', amount: { amount: '-72.31', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('72.31');
      expect(result.outflows[0]?.netAmount).toBe('72.31');
      expect(result.inflows).toHaveLength(0);
      expect(result.fees).toHaveLength(0);
    });

    test('with commission on quote-currency entry: fee uses settlement balance', () => {
      // USDC entry for an ETH-USDC trade — asset matches fee currency, so fee is emitted
      const entry = buildEntry({
        normalized: {
          type: 'advanced_trade_fill',
          amount: '-100.00',
          assetSymbol: 'USDC' as Currency,
          fee: '0.60',
          feeCurrency: 'USDC' as Currency,
        },
        raw: { type: 'advanced_trade_fill', amount: { amount: '-100.00', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('100');
      expect(result.outflows[0]?.netAmount).toBe('100');
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0]?.amount).toBe('0.6');
      expect(result.fees[0]?.settlement).toBe('balance');
    });

    test('with commission on base-currency entry: fee skipped (dedup to quote side)', () => {
      // ETH entry for an ETH-USDC trade — asset (ETH) != fee currency (USDC), so fee is NOT emitted
      const entry = buildEntry({
        normalized: {
          type: 'advanced_trade_fill',
          amount: '0.04',
          assetSymbol: 'ETH' as Currency,
          fee: '0.60',
          feeCurrency: 'USDC' as Currency,
        },
        raw: { type: 'advanced_trade_fill', amount: { amount: '0.04', currency: 'ETH' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('0.04');
      expect(result.fees).toHaveLength(0);
    });
  });

  // ── buy (v2 simple buy) ────────────────────────────────────────────────
  // From fiat wallet: amount = -buy.total = -(subtotal + fee). Fee INCLUDED.
  // From crypto wallet: amount = +crypto_received. No fee on this side.
  // Fee settlement must be 'on-chain' to avoid double-counting.

  describe('buy (v2 simple trade)', () => {
    test('fiat outflow: fee is on-chain (already included in amount)', () => {
      // Real example: buy crypto for 747.94 CAD, fee = 10.98 CAD
      // buy.total = 747.94 = subtotal(736.96) + fee(10.98)
      // amount = -747.94 (total debit from fiat wallet)
      const entry = buildEntry({
        normalized: {
          type: 'buy',
          amount: '-747.94',
          assetSymbol: 'CAD' as Currency,
          fee: '10.98',
          feeCurrency: 'CAD' as Currency,
        },
        raw: { type: 'buy', amount: { amount: '-747.94', currency: 'CAD' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('747.94');
      expect(result.inflows).toHaveLength(0);

      // Fee is recorded but settlement = 'on-chain' (not deducted from balance again)
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0]?.amount).toBe('10.98');
      expect(result.fees[0]?.settlement).toBe('on-chain');
    });

    test('crypto inflow: no fee on the receiving side', () => {
      // Correlated entry: receive 37.41 HNT
      const entry = buildEntry({
        normalized: { type: 'buy', amount: '37.41', assetSymbol: 'HNT' as Currency },
        raw: { type: 'buy', amount: { amount: '37.41', currency: 'HNT' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('37.41');
      expect(result.outflows).toHaveLength(0);
      expect(result.fees).toHaveLength(0);
    });

    test('buy with zero fee: no fee movement emitted', () => {
      const entry = buildEntry({
        normalized: {
          type: 'buy',
          amount: '534.99',
          assetSymbol: 'USDC' as Currency,
          fee: '0',
          feeCurrency: 'USDC' as Currency,
        },
        raw: { type: 'buy', amount: { amount: '534.99', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.fees).toHaveLength(0);
    });
  });

  // ── sell (v2 simple sell) ──────────────────────────────────────────────
  // From fiat wallet: amount = +sell.total = +(subtotal - fee). Fee INCLUDED.
  // Fee settlement must be 'on-chain' to avoid double-counting.

  describe('sell (v2 simple trade)', () => {
    test('fiat inflow: fee is on-chain (already included in amount)', () => {
      // Real example: sell crypto, receive 0.06 CAD, fee = 0.06 CAD
      // sell.total = 0.06 = subtotal(0.12) - fee(0.06)
      // amount = +0.06 (total credit to fiat wallet)
      const entry = buildEntry({
        normalized: {
          type: 'sell',
          amount: '0.06',
          assetSymbol: 'CAD' as Currency,
          fee: '0.06',
          feeCurrency: 'CAD' as Currency,
        },
        raw: { type: 'sell', amount: { amount: '0.06', currency: 'CAD' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('0.06');
      expect(result.outflows).toHaveLength(0);

      // Fee is recorded but settlement = 'on-chain'
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0]?.amount).toBe('0.06');
      expect(result.fees[0]?.settlement).toBe('on-chain');
    });
  });

  // ── fiat_withdrawal ────────────────────────────────────────────────────
  // amount = TOTAL deducted (fee included). gross = |amount|, net = gross - fee.
  // Fee settlement is 'on-chain' (carved from gross, not a separate deduction).

  describe('fiat_withdrawal', () => {
    test('amount is gross, fee carved from gross to get net', () => {
      const entry = buildEntry({
        normalized: {
          type: 'fiat_withdrawal',
          amount: '-500',
          assetSymbol: 'CAD' as Currency,
          fee: '2.50',
          feeCurrency: 'CAD' as Currency,
        },
        raw: { type: 'fiat_withdrawal', amount: { amount: '-500', currency: 'CAD' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('500');
      expect(result.outflows[0]?.netAmount).toBe('497.5');
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0]?.settlement).toBe('on-chain');
    });
  });

  // ── send (crypto withdrawal) ──────────────────────────────────────────
  // Same semantics as fiat_withdrawal. Often fee = 0 (gasless sends).

  describe('send (crypto withdrawal)', () => {
    test('gasless send: no fee, net = gross', () => {
      const entry = buildEntry({
        normalized: { type: 'send', amount: '-713.23', assetSymbol: 'USDC' as Currency },
        raw: { type: 'send', amount: { amount: '-713.23', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('713.23');
      expect(result.outflows[0]?.netAmount).toBe('713.23');
      expect(result.fees).toHaveLength(0);
    });

    test('send with fee: fee carved from gross', () => {
      const entry = buildEntry({
        normalized: {
          type: 'send',
          amount: '-1.5',
          assetSymbol: 'ETH' as Currency,
          fee: '0.005',
          feeCurrency: 'ETH' as Currency,
        },
        raw: { type: 'send', amount: { amount: '-1.5', currency: 'ETH' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.grossAmount).toBe('1.5');
      expect(result.outflows[0]?.netAmount).toBe('1.495');
      expect(result.fees).toHaveLength(1);
      expect(result.fees[0]?.amount).toBe('0.005');
      expect(result.fees[0]?.settlement).toBe('on-chain');
    });
  });

  // ── fiat_deposit ──────────────────────────────────────────────────────
  // Pure inflow, no fee.

  describe('fiat_deposit', () => {
    test('pure inflow, no fee', () => {
      const entry = buildEntry({
        normalized: { type: 'fiat_deposit', amount: '1000', assetSymbol: 'CAD' as Currency },
        raw: { type: 'fiat_deposit', amount: { amount: '1000', currency: 'CAD' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('1000');
      expect(result.outflows).toHaveLength(0);
      expect(result.fees).toHaveLength(0);
    });
  });

  // ── interest ──────────────────────────────────────────────────────────
  // Pure inflow, no fee.

  describe('interest', () => {
    test('pure inflow, no fee', () => {
      const entry = buildEntry({
        normalized: { type: 'interest', amount: '0.001232', assetSymbol: 'USDC' as Currency },
        raw: { type: 'interest', amount: { amount: '0.001232', currency: 'USDC' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('0.001232');
      expect(result.fees).toHaveLength(0);
    });
  });

  // ── trade (v2 legacy) ─────────────────────────────────────────────────
  // amount = wallet change. Spread-based pricing, no explicit fee.

  describe('trade (v2 legacy)', () => {
    test('inflow: amount is wallet change, no fee', () => {
      const entry = buildEntry({
        normalized: { type: 'trade', amount: '26.22', assetSymbol: 'HNT' as Currency },
        raw: { type: 'trade', amount: { amount: '26.22', currency: 'HNT' } },
      });

      const result = coinbaseGrossAmounts.interpret(entry, [entry], 'coinbase')._unsafeUnwrap();

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.grossAmount).toBe('26.22');
      expect(result.fees).toHaveLength(0);
    });
  });

  // ── Fee deduplication across correlated groups ─────────────────────────

  describe('fee deduplication', () => {
    test('fee emitted only once when two entries in group carry the same fee', () => {
      const cadEntry = buildEntry({
        eventId: 'cad-1',
        normalized: {
          id: 'cad-1',
          type: 'buy',
          amount: '-500',
          assetSymbol: 'CAD' as Currency,
          fee: '7.34',
          feeCurrency: 'CAD' as Currency,
        },
        raw: { id: 'cad-1', type: 'buy', amount: { amount: '-500', currency: 'CAD' } },
      });
      const hntEntry = buildEntry({
        eventId: 'hnt-1',
        normalized: {
          id: 'hnt-1',
          type: 'buy',
          amount: '37.41',
          assetSymbol: 'HNT' as Currency,
          fee: '7.34',
          feeCurrency: 'CAD' as Currency,
        },
        raw: { id: 'hnt-1', type: 'buy', amount: { amount: '37.41', currency: 'HNT' } },
      });

      const group = [cadEntry, hntEntry];
      const cadResult = coinbaseGrossAmounts.interpret(cadEntry, group, 'coinbase')._unsafeUnwrap();
      const hntResult = coinbaseGrossAmounts.interpret(hntEntry, group, 'coinbase')._unsafeUnwrap();

      // First entry in group gets the fee
      expect(cadResult.fees).toHaveLength(1);
      expect(cadResult.fees[0]?.amount).toBe('7.34');
      // Second entry: fee deduplicated
      expect(hntResult.fees).toHaveLength(0);
    });
  });
});
