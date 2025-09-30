import { beforeAll, describe, expect, it } from 'vitest';

import type { RawTransactionMetadata } from '../../../../../app/ports/importers.js';
import type { ImportSessionMetadata } from '../../../../../app/ports/transaction-processor.interface.js';
import { BlockchainComApiClient } from '../blockchain-com.api-client.js';
import { BlockchainComTransactionMapper } from '../blockchain-com.mapper.js';
import type { BlockchainComTransaction } from '../blockchain-com.types.js';

describe('BlockchainComTransactionMapper E2E', () => {
  let mapper: BlockchainComTransactionMapper;
  let apiClient: BlockchainComApiClient;

  beforeAll(() => {
    console.log('BLOCKCHAIN_COM_API_KEY:', process.env.BLOCKCHAIN_COM_API_KEY ? 'Found' : 'Not found');
    mapper = new BlockchainComTransactionMapper();
    apiClient = new BlockchainComApiClient();
  });

  it('should map real transaction data from API', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

    const rawTransactions = await apiClient.execute<BlockchainComTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    expect(rawTransactions.length).toBeGreaterThan(0);

    const rawTx = rawTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'blockchain.com',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.id).toBe(rawTx.hash);
      expect(normalized.currency).toBe('BTC');
      expect(normalized.providerId).toBe('blockchain.com');
      expect(normalized.status).toMatch(/success|pending/);
      expect(Array.isArray(normalized.inputs)).toBe(true);
      expect(Array.isArray(normalized.outputs)).toBe(true);
      expect(normalized.timestamp).toBeGreaterThan(0);
    }
  }, 45000);

  it('should handle confirmed transactions correctly', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const rawTransactions = await apiClient.execute<BlockchainComTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    const confirmedTx = rawTransactions.find((tx) => tx.block_height && tx.block_height > 0);
    if (!confirmedTx) {
      console.warn('No confirmed transactions found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'blockchain.com',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(confirmedTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.status).toBe('success');
      expect(normalized.blockHeight).toBeDefined();
      expect(normalized.blockHeight).toBeGreaterThan(0);
    }
  }, 45000);

  it('should map transaction fees correctly', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const rawTransactions = await apiClient.execute<BlockchainComTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    const txWithFee = rawTransactions.find((tx) => tx.fee > 0);
    if (!txWithFee) {
      console.warn('No transactions with fees found, skipping test');
      return;
    }

    const metadata: RawTransactionMetadata = {
      providerId: 'blockchain.com',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(txWithFee, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;
      expect(normalized.feeAmount).toBeDefined();
      expect(normalized.feeCurrency).toBe('BTC');
      expect(parseFloat(normalized.feeAmount!)).toBeGreaterThan(0);
    }
  }, 45000);

  it('should map inputs and outputs with addresses', async () => {
    const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

    const rawTransactions = await apiClient.execute<BlockchainComTransaction[]>({
      address: testAddress,
      type: 'getRawAddressTransactions',
    });

    const rawTx = rawTransactions[0]!;
    const metadata: RawTransactionMetadata = {
      providerId: 'blockchain.com',
    };
    const sessionContext: ImportSessionMetadata = {
      address: testAddress,
    };

    const result = mapper.map(rawTx, metadata, sessionContext);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const normalized = result.value;

      // Check inputs
      expect(normalized.inputs.length).toBe(rawTx.inputs.length);
      normalized.inputs.forEach((input) => {
        expect(input).toHaveProperty('txid');
        expect(input).toHaveProperty('value');
        expect(input).toHaveProperty('vout');
      });

      // Check outputs
      expect(normalized.outputs.length).toBe(rawTx.out.length);
      normalized.outputs.forEach((output, index) => {
        expect(output).toHaveProperty('value');
        expect(output.index).toBe(rawTx.out[index]!.n);
      });
    }
  }, 45000);
});
