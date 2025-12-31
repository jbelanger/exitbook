import { beforeAll, describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../core/index.js';
import { ProviderRegistry } from '../../../../core/index.js';
import type { CardanoTransaction } from '../../schemas.js';
import { BlockfrostApiClient } from '../blockfrost-api-client.js';
import type { BlockfrostTransactionWithMetadata } from '../blockfrost.schemas.js';

describe('BlockfrostApiClient E2E', () => {
  let client: BlockfrostApiClient;

  // Set the API key and create client before tests run
  // To run these tests, you need a valid Blockfrost API key
  // Get one from https://blockfrost.io/ and set it in your .env file or here
  beforeAll(() => {
    // Use environment variable if set, otherwise use the provided key
    // Note: The provided key may be invalid/expired - replace with your own valid key
    if (!process.env.BLOCKFROST_API_KEY) {
      process.env.BLOCKFROST_API_KEY = 'mainnetQwP2Nb7Y47Zn5Cl73a5V9okE2nvmyDoZ';
    }
    const config = ProviderRegistry.createDefaultConfig('cardano', 'blockfrost');
    client = new BlockfrostApiClient(config);
  });

  // Minswap DEX contract address - a well-known public address with many transactions
  const testAddress =
    'addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha';

  it('should connect to Blockfrost API and test health', async () => {
    const result = await client.isHealthy();
    if (result.isErr()) {
      console.error('Health check error:', result.error.message);
    }
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(true);
    }
  }, 60000);

  it('should fetch and normalize transactions for a Cardano address', async () => {
    const result = await client.execute<TransactionWithRawData<CardanoTransaction>[]>({
      address: testAddress,
      type: 'getAddressTransactions',
      transactionType: 'normal' as const,
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

        // Verify raw data structure (Blockfrost combined format with metadata)
        // The API client now combines data from 3 endpoints:
        // 1. /addresses/{address}/transactions - tx hashes
        // 2. /txs/{hash} - fees, block_height, block_hash, valid_contract
        // 3. /txs/{hash}/utxos - inputs and outputs
        const raw = txWithRaw.raw as BlockfrostTransactionWithMetadata;
        expect(raw).toHaveProperty('hash');
        expect(raw).toHaveProperty('inputs');
        expect(raw).toHaveProperty('outputs');
        expect(raw).toHaveProperty('block_height');
        expect(raw).toHaveProperty('block_time');
        expect(raw).toHaveProperty('block_hash');
        expect(raw).toHaveProperty('fees');
        expect(raw).toHaveProperty('valid_contract');
        expect(Array.isArray(raw.inputs)).toBe(true);
        expect(Array.isArray(raw.outputs)).toBe(true);
        // Verify block metadata fields are present and properly typed
        expect(typeof raw.block_height).toBe('number');
        expect(raw.block_time instanceof Date).toBe(true);
        expect(typeof raw.block_hash).toBe('string');
        // Verify fee field is present (not placeholder)
        expect(typeof raw.fees).toBe('string');
        expect(parseFloat(raw.fees)).toBeGreaterThan(0);
        // Verify transaction status field (determines success/failed)
        expect(typeof raw.valid_contract).toBe('boolean');

        // Verify normalized transaction matches CardanoTransaction schema
        const tx = txWithRaw.normalized;
        expect(tx).toBeDefined();
        expect(typeof tx.id).toBe('string');
        expect(tx.id.length).toBeGreaterThan(0);
        expect(tx.currency).toBe('ADA');
        expect(tx.providerName).toBe('blockfrost');
        // Verify status is set based on valid_contract field from Blockfrost API
        // This was fixed to use valid_contract instead of always being 'confirmed'
        expect(tx.status).toMatch(/^(success|failed)$/);

        // Verify timestamp uses real block time from Blockfrost API (not Date.now())
        // This was fixed to use block_time from the API instead of generating a timestamp
        expect(typeof tx.timestamp).toBe('number');
        expect(tx.timestamp).toBeGreaterThan(0);
        // Should be in the past (before current time) - not a fresh timestamp
        expect(tx.timestamp).toBeLessThan(Date.now());
        // Should be after Cardano mainnet launch (September 2017)
        expect(tx.timestamp).toBeGreaterThan(new Date('2017-09-01').getTime());

        // Verify fee is captured from Blockfrost API and converted from lovelace to ADA
        // This was fixed to use the actual 'fees' field from txDetails instead of '0'
        expect(tx.feeAmount).toBeDefined();
        expect(typeof tx.feeAmount).toBe('string');
        expect(tx.feeCurrency).toBe('ADA');
        // Fee should be a valid numeric string greater than 0 (not the placeholder '0')
        if (tx.feeAmount) {
          const feeValue = parseFloat(tx.feeAmount);
          expect(feeValue).toBeGreaterThan(0);
          // Most Cardano transactions have fees between 0.1 and 2 ADA
          expect(feeValue).toBeLessThan(100); // Sanity check
        }

        // Verify block metadata is captured from Blockfrost API responses
        // This was fixed to include block_height and block_hash from txDetails
        expect(typeof tx.blockHeight).toBe('number');
        expect(tx.blockHeight).toBeGreaterThan(0);
        expect(tx.blockId).toBeDefined();
        expect(typeof tx.blockId).toBe('string');
        if (tx.blockId) {
          // Block hash should be a 64-character hex string
          expect(tx.blockId.length).toBeGreaterThan(0);
        }

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
      transactionType: 'normal' as const,
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

  it('should fetch address balance', async () => {
    const result = await client.execute<{
      decimalAmount?: string;
      decimals?: number;
      rawAmount?: string;
      symbol?: string;
    }>({
      address: testAddress,
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const balanceData = result.value;

      // Verify structure
      expect(balanceData).toHaveProperty('rawAmount');
      expect(balanceData).toHaveProperty('decimalAmount');
      expect(balanceData).toHaveProperty('symbol');
      expect(balanceData).toHaveProperty('decimals');

      // Verify balance data
      expect(balanceData.symbol).toBe('ADA');
      expect(balanceData.decimals).toBe(6);

      // Verify rawAmount (lovelace) is a numeric string
      expect(typeof balanceData.rawAmount).toBe('string');
      if (balanceData.rawAmount) {
        const lovelace = parseFloat(balanceData.rawAmount);
        expect(lovelace).toBeGreaterThanOrEqual(0);
      }

      // Verify decimalAmount (ADA) is a numeric string
      expect(typeof balanceData.decimalAmount).toBe('string');
      if (balanceData.decimalAmount) {
        const ada = parseFloat(balanceData.decimalAmount);
        expect(ada).toBeGreaterThanOrEqual(0);

        // Verify conversion is correct: 1 ADA = 1,000,000 lovelace
        if (balanceData.rawAmount) {
          const lovelace = parseFloat(balanceData.rawAmount);
          const expectedAda = lovelace / 1000000;
          expect(Math.abs(ada - expectedAda)).toBeLessThan(0.000001); // Allow for floating point precision
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
