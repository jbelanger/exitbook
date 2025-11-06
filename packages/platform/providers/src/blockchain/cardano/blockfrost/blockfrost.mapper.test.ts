import type { SourceMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { BlockfrostTransactionMapper } from './blockfrost.mapper.js';
import type { BlockfrostTransactionWithMetadata } from './blockfrost.schemas.js';

describe('BlockfrostTransactionMapper', () => {
  const mapper = new BlockfrostTransactionMapper();
  const sourceContext: SourceMetadata = {
    address: 'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
  };

  // Base fixture for simple ADA transfer
  const createBaseFixture = (): BlockfrostTransactionWithMetadata => ({
    hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
    inputs: [
      {
        address:
          'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
        amount: [{ unit: 'lovelace', quantity: '5000000' }],
        tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
        output_index: 0,
      },
    ],
    outputs: [
      {
        address: 'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
        amount: [{ unit: 'lovelace', quantity: '4830000' }],
        output_index: 0,
      },
    ],
    block_height: 8129403,
    block_time: new Date('2024-01-15T10:30:00.000Z'),
    block_hash: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    fees: '170000',
    tx_index: 5,
    valid_contract: true,
  });

  describe('Basic transaction mapping', () => {
    it('should map simple ADA transfer with all metadata fields', () => {
      const mockTransaction = createBaseFixture();
      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        // Transaction identification
        expect(normalized.id).toBe(mockTransaction.hash);
        expect(normalized.providerId).toBe('blockfrost');

        // Block metadata
        expect(normalized.blockHeight).toBe(8129403);
        expect(normalized.blockId).toBe(mockTransaction.block_hash);
        expect(normalized.timestamp).toBe(mockTransaction.block_time.getTime());

        // Fee information
        expect(normalized.feeAmount).toBe('0.17'); // 170000 lovelace = 0.17 ADA
        expect(normalized.feeCurrency).toBe('ADA');

        // Currency and status
        expect(normalized.currency).toBe('ADA');
        expect(normalized.status).toBe('success');
      }
    });

    it('should map inputs with correct structure', () => {
      const mockTransaction = createBaseFixture();
      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        expect(normalized.inputs).toHaveLength(1);
        expect(normalized.inputs[0]).toEqual({
          address: mockTransaction.inputs[0].address,
          amounts: [
            {
              unit: 'lovelace',
              quantity: '5000000',
              symbol: 'ADA',
              decimals: 6,
            },
          ],
          txHash: mockTransaction.inputs[0].tx_hash,
          outputIndex: 0,
        });
      }
    });

    it('should map outputs with correct structure', () => {
      const mockTransaction = createBaseFixture();
      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        expect(normalized.outputs).toHaveLength(1);
        expect(normalized.outputs[0]).toEqual({
          address: mockTransaction.outputs[0].address,
          amounts: [
            {
              unit: 'lovelace',
              quantity: '4830000',
              symbol: 'ADA',
              decimals: 6,
            },
          ],
          outputIndex: 0,
        });
      }
    });
  });

  describe('Fee conversion from lovelace to ADA', () => {
    it('should convert various lovelace fee amounts to ADA correctly', () => {
      const testCases = [
        { lovelace: '170000', expectedAda: '0.17' },
        { lovelace: '1000000', expectedAda: '1' },
        { lovelace: '250000', expectedAda: '0.25' },
        { lovelace: '500000', expectedAda: '0.5' },
        { lovelace: '2500000', expectedAda: '2.5' },
        { lovelace: '123456', expectedAda: '0.123456' },
      ];

      testCases.forEach(({ lovelace, expectedAda }) => {
        const mockTransaction = {
          ...createBaseFixture(),
          fees: lovelace,
        };

        const result = mapper.map(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.feeAmount).toBe(expectedAda);
        }
      });
    });

    it('should handle zero fees', () => {
      const mockTransaction = {
        ...createBaseFixture(),
        fees: '0',
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBe('0');
      }
    });

    it('should handle large fee amounts', () => {
      const mockTransaction = {
        ...createBaseFixture(),
        fees: '10000000000', // 10,000 ADA
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.feeAmount).toBe('10000');
      }
    });
  });

  describe('Timestamp handling', () => {
    it('should convert block_time Date to milliseconds timestamp', () => {
      const blockTime = new Date('2024-01-15T10:30:00.000Z');
      const mockTransaction = {
        ...createBaseFixture(),
        block_time: blockTime,
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.timestamp).toBe(blockTime.getTime());
        // Verify it's a positive number (milliseconds since epoch)
        expect(result.value.timestamp).toBeGreaterThan(0);
      }
    });

    it('should handle different timestamps correctly', () => {
      const testCases = [
        { date: '2024-01-01T00:00:00.000Z', expected: 1704067200000 },
        { date: '2024-12-31T23:59:59.999Z', expected: 1735689599999 },
        { date: '2023-06-15T12:30:45.123Z', expected: 1686832245123 },
      ];

      testCases.forEach(({ date, expected }) => {
        const mockTransaction = {
          ...createBaseFixture(),
          block_time: new Date(date),
        };

        const result = mapper.map(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.timestamp).toBe(expected);
        }
      });
    });
  });

  describe('Transaction status based on valid_contract', () => {
    it('should map successful transaction with valid_contract=true', () => {
      const mockTransaction = {
        ...createBaseFixture(),
        valid_contract: true,
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('success');
      }
    });

    it('should map failed smart contract transaction with valid_contract=false', () => {
      const mockTransaction = {
        ...createBaseFixture(),
        valid_contract: false,
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.status).toBe('failed');
      }
    });
  });

  describe('Block metadata', () => {
    it('should include block height in mapped transaction', () => {
      const testCases = [8129403, 5000000, 10000000, 1];

      testCases.forEach((blockHeight) => {
        const mockTransaction = {
          ...createBaseFixture(),
          block_height: blockHeight,
        };

        const result = mapper.map(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.blockHeight).toBe(blockHeight);
        }
      });
    });

    it('should include block hash in mapped transaction', () => {
      const blockHashes = [
        '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
        'aaaa0000bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777',
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      ];

      blockHashes.forEach((blockHash) => {
        const mockTransaction = {
          ...createBaseFixture(),
          block_hash: blockHash,
        };

        const result = mapper.map(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.blockId).toBe(blockHash);
        }
      });
    });
  });

  describe('Multi-asset support', () => {
    it('should map transaction with ADA and native tokens', () => {
      const mockTransaction: BlockfrostTransactionWithMetadata = {
        ...createBaseFixture(),
        inputs: [
          {
            address:
              'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
            amount: [
              { unit: 'lovelace', quantity: '5000000' },
              {
                unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
                quantity: '1000',
              },
            ],
            tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
            output_index: 0,
          },
        ],
        outputs: [
          {
            address:
              'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
            amount: [
              { unit: 'lovelace', quantity: '4830000' },
              {
                unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
                quantity: '1000',
              },
            ],
            output_index: 0,
          },
        ],
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        // Check input has both ADA and native token
        expect(normalized.inputs[0].amounts).toHaveLength(2);
        expect(normalized.inputs[0].amounts[0]).toEqual({
          unit: 'lovelace',
          quantity: '5000000',
          symbol: 'ADA',
          decimals: 6,
        });
        expect(normalized.inputs[0].amounts[1]).toEqual({
          unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
          quantity: '1000',
          // symbol and decimals should be undefined for native tokens (to be enriched later)
        });

        // Check output has both ADA and native token
        expect(normalized.outputs[0].amounts).toHaveLength(2);
        expect(normalized.outputs[0].amounts[0]).toEqual({
          unit: 'lovelace',
          quantity: '4830000',
          symbol: 'ADA',
          decimals: 6,
        });
        expect(normalized.outputs[0].amounts[1]).toEqual({
          unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
          quantity: '1000',
        });
      }
    });

    it('should properly handle native token amounts without symbol or decimals', () => {
      const mockTransaction: BlockfrostTransactionWithMetadata = {
        ...createBaseFixture(),
        outputs: [
          {
            address:
              'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
            amount: [
              {
                unit: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a6e7574636f696e',
                quantity: '500000',
              },
            ],
            output_index: 0,
          },
        ],
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        expect(normalized.outputs[0].amounts[0]).toEqual({
          unit: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a6e7574636f696e',
          quantity: '500000',
          // No symbol or decimals defined - to be enriched later
        });
        expect(normalized.outputs[0].amounts[0].symbol).toBeUndefined();
        expect(normalized.outputs[0].amounts[0].decimals).toBeUndefined();
      }
    });

    it('should handle multiple inputs and outputs', () => {
      const mockTransaction: BlockfrostTransactionWithMetadata = {
        ...createBaseFixture(),
        inputs: [
          {
            address:
              'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
            amount: [{ unit: 'lovelace', quantity: '3000000' }],
            tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
            output_index: 0,
          },
          {
            address:
              'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
            amount: [{ unit: 'lovelace', quantity: '2000000' }],
            tx_hash: 'c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8',
            output_index: 1,
          },
        ],
        outputs: [
          {
            address:
              'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
            amount: [{ unit: 'lovelace', quantity: '2500000' }],
            output_index: 0,
          },
          {
            address:
              'addr1qabc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs345stu',
            amount: [{ unit: 'lovelace', quantity: '2330000' }],
            output_index: 1,
          },
        ],
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        expect(normalized.inputs).toHaveLength(2);
        expect(normalized.outputs).toHaveLength(2);

        // Verify all inputs and outputs are mapped correctly
        expect(normalized.inputs[0].amounts[0].quantity).toBe('3000000');
        expect(normalized.inputs[1].amounts[0].quantity).toBe('2000000');
        expect(normalized.outputs[0].amounts[0].quantity).toBe('2500000');
        expect(normalized.outputs[1].amounts[0].quantity).toBe('2330000');
      }
    });
  });

  describe('Complete transaction mapping', () => {
    it('should map all required fields for a complex transaction', () => {
      const mockTransaction: BlockfrostTransactionWithMetadata = {
        hash: 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2',
        inputs: [
          {
            address:
              'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
            amount: [
              { unit: 'lovelace', quantity: '10000000' },
              {
                unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
                quantity: '5000',
              },
            ],
            tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
            output_index: 2,
          },
        ],
        outputs: [
          {
            address:
              'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
            amount: [
              { unit: 'lovelace', quantity: '4500000' },
              {
                unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
                quantity: '5000',
              },
            ],
            output_index: 0,
          },
          {
            address:
              'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
            amount: [{ unit: 'lovelace', quantity: '5200000' }],
            output_index: 1,
          },
        ],
        block_height: 9234567,
        block_time: new Date('2024-03-20T14:45:30.000Z'),
        block_hash: 'abc1234567890def1234567890abc1234567890def1234567890abc1234567890',
        fees: '300000',
        tx_index: 12,
        valid_contract: true,
      };

      const result = mapper.map(mockTransaction, sourceContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        // Verify all top-level fields
        expect(normalized.id).toBe(mockTransaction.hash);
        expect(normalized.providerId).toBe('blockfrost');
        expect(normalized.currency).toBe('ADA');
        expect(normalized.status).toBe('success');

        // Verify block metadata
        expect(normalized.blockHeight).toBe(9234567);
        expect(normalized.blockId).toBe(mockTransaction.block_hash);
        expect(normalized.timestamp).toBe(mockTransaction.block_time.getTime());

        // Verify fee
        expect(normalized.feeAmount).toBe('0.3'); // 300000 lovelace
        expect(normalized.feeCurrency).toBe('ADA');

        // Verify inputs structure
        expect(normalized.inputs).toHaveLength(1);
        expect(normalized.inputs[0].address).toBe(mockTransaction.inputs[0].address);
        expect(normalized.inputs[0].txHash).toBe(mockTransaction.inputs[0].tx_hash);
        expect(normalized.inputs[0].outputIndex).toBe(2);
        expect(normalized.inputs[0].amounts).toHaveLength(2);

        // Verify outputs structure
        expect(normalized.outputs).toHaveLength(2);
        expect(normalized.outputs[0].address).toBe(mockTransaction.outputs[0].address);
        expect(normalized.outputs[0].outputIndex).toBe(0);
        expect(normalized.outputs[0].amounts).toHaveLength(2);
        expect(normalized.outputs[1].address).toBe(mockTransaction.outputs[1].address);
        expect(normalized.outputs[1].outputIndex).toBe(1);
        expect(normalized.outputs[1].amounts).toHaveLength(1);
      }
    });
  });
});
