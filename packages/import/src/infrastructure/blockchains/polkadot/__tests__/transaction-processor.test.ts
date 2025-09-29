/* eslint-disable unicorn/no-null -- Required for testing null values in database mocks and transaction objects */
import type { RawData } from '@exitbook/data';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/processors.js';
import { describe, expect, it } from 'vitest';

import { PolkadotTransactionProcessor } from '../processor.js';
import type { SubscanTransfer } from '../substrate/substrate.types.js';

// Type for accessing protected methods in tests
type TestablePolkadotTransactionProcessor = PolkadotTransactionProcessor & {
  enrichSessionContext(rawDataItems: RawData[], sessionMetadata: ImportSessionMetadata): ImportSessionMetadata;
};

describe('PolkadotTransactionProcessor Integration', () => {
  const processor = new PolkadotTransactionProcessor();

  // Test addresses representing the same public key in different SS58 formats
  const polkadotAddress = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'; // Format 0
  const kusamaAddress = 'HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F'; // Format 2
  const genericAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Format 42

  const mockTransaction: SubscanTransfer = {
    amount: '1000000000000',
    block_hash: '0x1234567890abcdef',
    block_num: 123456,
    block_timestamp: 1640995200,
    call: 'transfer',
    extrinsic_index: '123456-1',
    fee: '1000000000',
    from: polkadotAddress,
    hash: '0xabcdef1234567890',
    module: 'balances',
    success: true,
    to: '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3', // Different address
  };

  const createMockRawDataItem = (transaction: SubscanTransfer, sourceAddress: string): RawData => ({
    created_at: Date.now().toString(),
    id: 1,
    import_session_id: 1,
    metadata: JSON.stringify({ providerId: 'subscan', sourceAddress }),
    processed_at: null,
    processing_error: null,
    processing_status: 'pending',
    provider_id: null,
    raw_data: JSON.stringify(transaction),
  });

  describe('SS58 Address Variant Handling', () => {
    it('should enrich session context with SS58 address variants', () => {
      const rawDataItems = [createMockRawDataItem(mockTransaction, polkadotAddress)];

      const sessionMetadata: ImportSessionMetadata = {
        address: kusamaAddress, // Different format than source
      };

      // Access the enrichSessionContext method via reflection to test it
      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses?.length).toBeGreaterThan(0);

      // Should contain variants for both addresses
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);
      expect(enrichedContext.derivedAddresses).toContain(kusamaAddress);

      // Should contain various SS58 format variants
      expect(enrichedContext.derivedAddresses?.length).toBeGreaterThanOrEqual(6);
    });

    it('should handle multiple source addresses with different SS58 formats', () => {
      const transaction2: SubscanTransfer = {
        ...mockTransaction,
        from: genericAddress,
        hash: '0xfedcba0987654321',
      };

      const rawDataItems = [
        createMockRawDataItem(mockTransaction, polkadotAddress),
        createMockRawDataItem(transaction2, genericAddress),
      ];

      const sessionMetadata: ImportSessionMetadata = {
        address: kusamaAddress,
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses?.length).toBeGreaterThan(0);

      // Should contain all address variants
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);
      expect(enrichedContext.derivedAddresses).toContain(kusamaAddress);
      expect(enrichedContext.derivedAddresses).toContain(genericAddress);

      // Should generate more variants with more source addresses
      expect(enrichedContext.derivedAddresses?.length).toBeGreaterThanOrEqual(6);
    });

    it('should deduplicate identical SS58 variants', () => {
      const rawDataItems = [
        createMockRawDataItem(mockTransaction, polkadotAddress),
        createMockRawDataItem(mockTransaction, polkadotAddress), // Same address twice
      ];

      const sessionMetadata: ImportSessionMetadata = {
        address: polkadotAddress, // Same address again
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();

      // Should not have duplicates
      const uniqueAddresses = new Set(enrichedContext.derivedAddresses);
      expect(uniqueAddresses.size).toBe(enrichedContext.derivedAddresses?.length);
    });

    it('should handle invalid addresses gracefully', () => {
      const invalidTransaction: SubscanTransfer = {
        ...mockTransaction,
        from: 'invalid-address',
        hash: '0x999999999',
      };

      const rawDataItems = [createMockRawDataItem(invalidTransaction, 'invalid-address')];

      const sessionMetadata: ImportSessionMetadata = {
        address: 'another-invalid-address',
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses).toContain('invalid-address');
      expect(enrichedContext.derivedAddresses).toContain('another-invalid-address');
    });
  });

  describe('SS58 Address Matching in Processing Context', () => {
    it('should enrich session context before processing transactions', () => {
      // Test that enrichSessionContext generates proper SS58 variants
      const rawDataItems = [createMockRawDataItem(mockTransaction, polkadotAddress)];

      const sessionMetadata: ImportSessionMetadata = {
        address: kusamaAddress, // Different format than source
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      // Verify that both the original address and the source address variants are included
      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses!.length).toBeGreaterThan(2);
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress); // Source address
      expect(enrichedContext.derivedAddresses).toContain(kusamaAddress); // Session address
    });

    it('should handle address format mismatches through variant generation', () => {
      // Simulate a scenario where transaction data uses one format but session uses another
      const transactionWithGenericFormat: SubscanTransfer = {
        ...mockTransaction,
        from: genericAddress, // Generic Substrate format
      };

      const rawDataItems = [createMockRawDataItem(transactionWithGenericFormat, genericAddress)];

      const sessionMetadata: ImportSessionMetadata = {
        address: polkadotAddress, // Polkadot mainnet format
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      // Both addresses should have variants generated that allow matching
      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses).toContain(genericAddress);
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);

      // Should have generated multiple format variants
      expect(enrichedContext.derivedAddresses!.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty session metadata', () => {
      const rawDataItems = [createMockRawDataItem(mockTransaction, polkadotAddress)];

      const sessionMetadata: ImportSessionMetadata = {};

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);
    });

    it('should handle empty raw data items', () => {
      const rawDataItems: RawData[] = [];

      const sessionMetadata: ImportSessionMetadata = {
        address: polkadotAddress,
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);
    });

    it('should handle missing sourceAddress in raw data', () => {
      const rawDataItem: RawData = {
        created_at: Date.now().toString(),
        id: 1,
        import_session_id: 1,
        metadata: JSON.stringify({ providerId: 'subscan' }),
        processed_at: null,
        processing_error: null,
        processing_status: 'pending',
        provider_id: null,
        raw_data: JSON.stringify(mockTransaction),
      };

      const rawDataItems = [rawDataItem];

      const sessionMetadata: ImportSessionMetadata = {
        address: polkadotAddress,
      };

      const enrichedContext = (processor as TestablePolkadotTransactionProcessor).enrichSessionContext(
        rawDataItems,
        sessionMetadata
      );

      expect(enrichedContext.derivedAddresses).toBeDefined();
      expect(enrichedContext.derivedAddresses).toContain(polkadotAddress);
    });
  });
});
