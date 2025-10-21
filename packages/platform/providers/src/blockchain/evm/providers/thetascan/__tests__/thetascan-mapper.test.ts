import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ThetaScanTransactionMapper } from '../thetascan.mapper.js';
import type { ThetaScanTransaction } from '../thetascan.types.js';

describe('ThetaScanTransactionMapper', () => {
  const mapper = new ThetaScanTransactionMapper();
  const metadata: RawTransactionMetadata = {
    providerId: 'thetascan',
  };
  const sessionContext: ImportSessionMetadata = {
    address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
  };

  describe('THETA currency detection', () => {
    it('should map THETA transfer with correct currency and type', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '0.000000',
        theta: '420.333700',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('THETA');
        expect(normalized.tokenSymbol).toBe('THETA');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.tokenType).toBe('native');
        // THETA amounts should be normalized (not in wei)
        expect(normalized.amount).toBe('420.3337');
      }
    });

    it('should map TFUEL transfer with correct currency and type', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599639',
        fee_tfuel: 0,
        hash: '0x9312f29a4a4e6478b4f6e30d91d7407067d6350578a25669d1272f4624e8cc01',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '7,614.412500',
        theta: '0.000000',
        timestamp: new Date(1752686906 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('TFUEL');
        expect(normalized.tokenSymbol).toBe('TFUEL');
        expect(normalized.type).toBe('transfer');
        expect(normalized.tokenType).toBe('native');
        // TFUEL amounts should be in wei (18 decimals)
        expect(normalized.amount).toBe('7614412500000000000000');
      }
    });

    it('should prioritize THETA over TFUEL when both are non-zero', () => {
      const rawTx: ThetaScanTransaction = {
        block: '25171619',
        fee_tfuel: 0,
        hash: '0x171980dbb42e7c3ac5ae1df6dd2240523d751d82ac1bf6f338a4edb83e856eb1',
        recieving_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        sending_address: '0x5a722d3c43e5e5cec5dd91391594309829ae0a24',
        tfuel: '100.000000',
        theta: '50.000000',
        timestamp: new Date(1715285402 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Should prioritize THETA
        expect(normalized.currency).toBe('THETA');
        expect(normalized.tokenSymbol).toBe('THETA');
        expect(normalized.type).toBe('token_transfer');
        expect(normalized.amount).toBe('50');
      }
    });

    it('should default to TFUEL for zero-value transactions', () => {
      const rawTx: ThetaScanTransaction = {
        block: '25171619',
        fee_tfuel: 0.1,
        hash: '0x000000000000000000000000000000000000000000000000000000000000abcd',
        recieving_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        sending_address: '0x5a722d3c43e5e5cec5dd91391594309829ae0a24',
        tfuel: '0.000000',
        theta: '0.000000',
        timestamp: new Date(1715285402 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.currency).toBe('TFUEL');
        expect(normalized.tokenSymbol).toBe('TFUEL');
        expect(normalized.type).toBe('transfer');
        expect(normalized.amount).toBe('0');
      }
    });
  });

  describe('Amount formatting', () => {
    it('should handle comma-formatted amounts correctly', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '1,234,567.890000',
        theta: '0.000000',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // Should parse commas correctly and convert to wei
        expect(normalized.amount).toBe('1234567890000000000000000');
      }
    });

    it('should preserve precision for THETA amounts', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '0.000000',
        theta: '123.456789',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        // THETA amount should be normalized, not wei
        expect(normalized.amount).toBe('123.456789');
      }
    });

    it('should convert TFUEL amounts to wei (18 decimals)', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '1.000000',
        theta: '0.000000',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.amount).toBe('1000000000000000000');
      }
    });
  });

  describe('Fee handling', () => {
    it('should always use TFUEL for fees', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0.5,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '0.000000',
        theta: '420.333700',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeCurrency).toBe('TFUEL');
        expect(normalized.feeAmount).toBe('500000000000000000');
      }
    });

    it('should handle zero fees', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '100.000000',
        theta: '0.000000',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeCurrency).toBe('TFUEL');
        expect(normalized.feeAmount).toBe('0');
      }
    });
  });

  describe('Transaction metadata', () => {
    it('should map all required fields correctly', () => {
      const rawTx: ThetaScanTransaction = {
        block: '30599571',
        fee_tfuel: 0.1,
        hash: '0xa8e2051371ac9307a54e5290ec522d679bd7ecde13b86fd85a5d6acbe3257a3a',
        recieving_address: '0x3b2cf117129bb01c47d51557e6efdbe3ae3637c4',
        sending_address: '0x6d882a1ae65377c12e8c1ad5a8b5cfa329edeb07',
        tfuel: '0.000000',
        theta: '420.333700',
        timestamp: new Date(1752686427 * 1000),
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.from).toBe(rawTx.sending_address);
        expect(normalized.to).toBe(rawTx.recieving_address);
        expect(normalized.blockHeight).toBe(30599571);
        expect(normalized.timestamp).toBe(1752686427000); // milliseconds
        expect(normalized.providerId).toBe('thetascan');
        expect(normalized.status).toBe('success');
      }
    });
  });
});
