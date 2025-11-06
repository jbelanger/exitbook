import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import type { CardanoTransaction } from '../../schemas.js';
import { BlockfrostApiClient } from '../blockfrost-api-client.js';
import type { BlockfrostTransactionUtxos } from '../blockfrost.schemas.js';

describe.skipIf(!process.env.BLOCKFROST_API_KEY)('BlockfrostApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('cardano', 'blockfrost');
  const client = new BlockfrostApiClient(config);

  // Minswap DEX contract address - a well-known public address with many transactions
  const testAddress =
    'addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha';

  it('should connect to Blockfrost API and test health', async () => {
    const result = await client.isHealthy();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should fetch and normalize transactions for a Cardano address', async () => {
    const result = await client.execute<TransactionWithRawData<CardanoTransaction>[]>({
      address: testAddress,
      type: 'getAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeGreaterThan(0);

      if (transactions.length > 0) {
        const txWithRaw = transactions[0]!;

        // Verify structure has both raw and normalized data
        expect(txWithRaw).toHaveProperty('raw');
        expect(txWithRaw).toHaveProperty('normalized');

        // Verify raw data structure (Blockfrost UTXO format)
        const raw = txWithRaw.raw as BlockfrostTransactionUtxos;
        expect(raw).toHaveProperty('hash');
        expect(raw).toHaveProperty('inputs');
        expect(raw).toHaveProperty('outputs');
        expect(Array.isArray(raw.inputs)).toBe(true);
        expect(Array.isArray(raw.outputs)).toBe(true);

        // Verify normalized transaction matches CardanoTransaction schema
        const tx = txWithRaw.normalized;
        expect(tx).toBeDefined();
        expect(typeof tx.id).toBe('string');
        expect(tx.id.length).toBeGreaterThan(0);
        expect(tx.currency).toBe('ADA');
        expect(tx.providerId).toBe('blockfrost');
        expect(tx.status).toBe('success');
        expect(typeof tx.timestamp).toBe('number');
        expect(tx.timestamp).toBeGreaterThan(0);

        // Verify inputs and outputs structure
        expect(Array.isArray(tx.inputs)).toBe(true);
        expect(Array.isArray(tx.outputs)).toBe(true);
        expect(tx.inputs.length).toBeGreaterThan(0);
        expect(tx.outputs.length).toBeGreaterThan(0);

        // Verify input structure
        const input = tx.inputs[0]!;
        expect(input).toHaveProperty('address');
        expect(input).toHaveProperty('amounts');
        expect(input).toHaveProperty('txHash');
        expect(input).toHaveProperty('outputIndex');
        expect(Array.isArray(input.amounts)).toBe(true);
        expect(input.amounts.length).toBeGreaterThan(0);

        // Verify output structure
        const output = tx.outputs[0]!;
        expect(output).toHaveProperty('address');
        expect(output).toHaveProperty('amounts');
        expect(output).toHaveProperty('outputIndex');
        expect(Array.isArray(output.amounts)).toBe(true);
        expect(output.amounts.length).toBeGreaterThan(0);

        // Verify asset amount structure
        const amount = input.amounts[0]!;
        expect(amount).toHaveProperty('unit');
        expect(amount).toHaveProperty('quantity');
        expect(typeof amount.unit).toBe('string');
        expect(typeof amount.quantity).toBe('string');

        // Verify that lovelace (ADA's smallest unit) is present
        const hasLovelace = input.amounts.some((amt) => amt.unit === 'lovelace');
        expect(hasLovelace).toBe(true);
      }
    }
  }, 60000);

  it('should handle multi-asset transactions', async () => {
    const result = await client.execute<TransactionWithRawData<CardanoTransaction>[]>({
      address: testAddress,
      type: 'getAddressTransactions',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const transactions = result.value;

      // Find a transaction with multiple assets (native tokens)
      const multiAssetTx = transactions.find((tx) => tx.normalized.inputs.some((input) => input.amounts.length > 1));

      if (multiAssetTx) {
        const input = multiAssetTx.normalized.inputs.find((inp) => inp.amounts.length > 1)!;

        // Should have lovelace plus at least one native token
        expect(input.amounts.length).toBeGreaterThan(1);

        // Verify lovelace is present
        const lovelaceAmount = input.amounts.find((amt) => amt.unit === 'lovelace');
        expect(lovelaceAmount).toBeDefined();

        // Verify at least one native token (unit is policyId + hex asset name)
        const nativeToken = input.amounts.find((amt) => amt.unit !== 'lovelace');
        expect(nativeToken).toBeDefined();
        if (nativeToken) {
          expect(nativeToken.unit.length).toBeGreaterThan(10); // Policy ID is 56 chars + asset name
        }
      }
    }
  }, 60000);

  it('should handle unsupported operations gracefully', async () => {
    const result = await client.execute<unknown>({
      address: testAddress,
      type: 'nonExistent' as never,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Unsupported operation');
    }
  }, 60000);
});
