import type { SourceMetadata } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { lovelaceToAda, mapAssetAmounts, mapBlockfrostTransaction } from './blockfrost.mapper-utils.js';
import type { BlockfrostAssetAmount, BlockfrostTransactionWithMetadata } from './blockfrost.schemas.js';

describe('blockfrost.mapper-utils', () => {
  const sourceContext: SourceMetadata = {
    address: 'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
  };

  describe('lovelaceToAda', () => {
    it('should convert lovelace to ADA with correct precision', () => {
      expect(lovelaceToAda('1000000')).toBe('1');
      expect(lovelaceToAda('500000')).toBe('0.5');
      expect(lovelaceToAda('250000')).toBe('0.25');
      expect(lovelaceToAda('170000')).toBe('0.17');
    });

    it('should handle zero lovelace', () => {
      expect(lovelaceToAda('0')).toBe('0');
    });

    it('should handle very small amounts (single lovelace)', () => {
      expect(lovelaceToAda('1')).toBe('0.000001');
      expect(lovelaceToAda('10')).toBe('0.00001');
      expect(lovelaceToAda('100')).toBe('0.0001');
    });

    it('should handle large amounts without scientific notation', () => {
      expect(lovelaceToAda('10000000000')).toBe('10000'); // 10,000 ADA
      expect(lovelaceToAda('45000000000000')).toBe('45000000'); // 45M ADA (max supply is ~45B)
    });

    it('should preserve full precision for fractional lovelace', () => {
      expect(lovelaceToAda('123456')).toBe('0.123456');
      expect(lovelaceToAda('999999')).toBe('0.999999');
      expect(lovelaceToAda('1234567')).toBe('1.234567');
    });

    it('should use Decimal.js for precise calculations', () => {
      const input = '123456789';
      const result = lovelaceToAda(input);
      const expected = new Decimal(input).dividedBy(1_000_000).toFixed();
      expect(result).toBe(expected);
      expect(result).toBe('123.456789');
    });

    it('should handle typical fee amounts correctly', () => {
      // Typical Cardano transaction fees
      expect(lovelaceToAda('170000')).toBe('0.17'); // ~0.17 ADA
      expect(lovelaceToAda('180000')).toBe('0.18'); // ~0.18 ADA
      expect(lovelaceToAda('200000')).toBe('0.2'); // ~0.2 ADA
    });

    it('should handle typical transfer amounts', () => {
      expect(lovelaceToAda('5000000')).toBe('5'); // 5 ADA
      expect(lovelaceToAda('100000000')).toBe('100'); // 100 ADA
      expect(lovelaceToAda('1000000000')).toBe('1000'); // 1,000 ADA
    });
  });

  describe('mapAssetAmounts', () => {
    it('should map lovelace to ADA with symbol and decimals', () => {
      const input: BlockfrostAssetAmount[] = [{ unit: 'lovelace', quantity: '5000000' }];

      const result = mapAssetAmounts(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        unit: 'lovelace',
        quantity: '5000000',
        symbol: 'ADA',
        decimals: 6,
      });
    });

    it('should map native tokens without symbol or decimals', () => {
      const input: BlockfrostAssetAmount[] = [
        {
          unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
          quantity: '1000',
        },
      ];

      const result = mapAssetAmounts(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
        quantity: '1000',
        // No symbol or decimals for native tokens
      });
      expect(result[0]?.symbol).toBeUndefined();
      expect(result[0]?.decimals).toBeUndefined();
    });

    it('should map mixed ADA and native tokens', () => {
      const input: BlockfrostAssetAmount[] = [
        { unit: 'lovelace', quantity: '5000000' },
        {
          unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
          quantity: '1000',
        },
        {
          unit: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a6e7574636f696e',
          quantity: '500',
        },
      ];

      const result = mapAssetAmounts(input);

      expect(result).toHaveLength(3);

      // ADA
      expect(result[0]).toEqual({
        unit: 'lovelace',
        quantity: '5000000',
        symbol: 'ADA',
        decimals: 6,
      });

      // Native token 1
      expect(result[1]).toEqual({
        unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
        quantity: '1000',
      });
      expect(result[1]?.symbol).toBeUndefined();
      expect(result[1]?.decimals).toBeUndefined();

      // Native token 2
      expect(result[2]).toEqual({
        unit: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a6e7574636f696e',
        quantity: '500',
      });
      expect(result[2]?.symbol).toBeUndefined();
      expect(result[2]?.decimals).toBeUndefined();
    });

    it('should handle empty array', () => {
      const result = mapAssetAmounts([]);
      expect(result).toHaveLength(0);
    });

    it('should preserve exact quantity strings', () => {
      const input: BlockfrostAssetAmount[] = [
        { unit: 'lovelace', quantity: '1234567890123456789' }, // Very large quantity
        {
          unit: 'token123',
          quantity: '999999999999999999999',
        },
      ];

      const result = mapAssetAmounts(input);

      expect(result[0]?.quantity).toBe('1234567890123456789');
      expect(result[1]?.quantity).toBe('999999999999999999999');
    });

    it('should handle zero quantities', () => {
      const input: BlockfrostAssetAmount[] = [
        { unit: 'lovelace', quantity: '0' },
        { unit: 'token123', quantity: '0' },
      ];

      const result = mapAssetAmounts(input);

      expect(result).toHaveLength(2);
      expect(result[0]?.quantity).toBe('0');
      expect(result[1]?.quantity).toBe('0');
    });
  });

  describe('mapBlockfrostTransaction', () => {
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
          address:
            'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
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
        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          // Transaction identification
          expect(normalized.id).toBe(mockTransaction.hash);
          expect(normalized.providerName).toBe('blockfrost');

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
        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          expect(normalized.inputs).toHaveLength(1);
          expect(normalized.inputs[0]).toEqual({
            address: mockTransaction.inputs[0]?.address,
            amounts: [
              {
                unit: 'lovelace',
                quantity: '5000000',
                symbol: 'ADA',
                decimals: 6,
              },
            ],
            txHash: mockTransaction.inputs[0]?.tx_hash,
            outputIndex: 0,
          });
        }
      });

      it('should map outputs with correct structure', () => {
        const mockTransaction = createBaseFixture();
        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          expect(normalized.outputs).toHaveLength(1);
          expect(normalized.outputs[0]).toEqual({
            address: mockTransaction.outputs[0]?.address,
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

          const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.feeAmount).toBe('0');
        }
      });

      it('should handle large fee amounts without scientific notation', () => {
        const mockTransaction = {
          ...createBaseFixture(),
          fees: '10000000000', // 10,000 ADA (unrealistic but tests precision)
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.feeAmount).toBe('10000');
          expect(result.value.feeAmount).not.toContain('e'); // No scientific notation
        }
      });

      it('should use Decimal.js for precise fee conversion', () => {
        const feeInLovelace = '123456789';
        const mockTransaction = {
          ...createBaseFixture(),
          fees: feeInLovelace,
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const expected = new Decimal(feeInLovelace).dividedBy(1_000_000).toFixed();
          expect(result.value.feeAmount).toBe(expected);
          expect(result.value.feeAmount).toBe('123.456789');
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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

          const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

          expect(result.isOk()).toBe(true);
          if (result.isOk()) {
            expect(result.value.timestamp).toBe(expected);
          }
        });
      });

      it('should preserve millisecond precision in timestamps', () => {
        const blockTime = new Date('2024-01-15T10:30:45.789Z');
        const mockTransaction = {
          ...createBaseFixture(),
          block_time: blockTime,
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          // Verify milliseconds are preserved
          expect(result.value.timestamp % 1000).toBe(789);
        }
      });
    });

    describe('Transaction status based on valid_contract', () => {
      it('should map successful transaction with valid_contract=true', () => {
        const mockTransaction = {
          ...createBaseFixture(),
          valid_contract: true,
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

          const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

          const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          // Check input has both ADA and native token
          expect(normalized.inputs[0]?.amounts).toHaveLength(2);
          expect(normalized.inputs[0]?.amounts[0]).toEqual({
            unit: 'lovelace',
            quantity: '5000000',
            symbol: 'ADA',
            decimals: 6,
          });
          expect(normalized.inputs[0]?.amounts[1]).toEqual({
            unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
            quantity: '1000',
          });

          // Check output has both ADA and native token
          expect(normalized.outputs[0]?.amounts).toHaveLength(2);
          expect(normalized.outputs[0]?.amounts[0]).toEqual({
            unit: 'lovelace',
            quantity: '4830000',
            symbol: 'ADA',
            decimals: 6,
          });
          expect(normalized.outputs[0]?.amounts[1]).toEqual({
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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          expect(normalized.outputs[0]?.amounts[0]).toEqual({
            unit: 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a6e7574636f696e',
            quantity: '500000',
          });
          expect(normalized.outputs[0]?.amounts[0]?.symbol).toBeUndefined();
          expect(normalized.outputs[0]?.amounts[0]?.decimals).toBeUndefined();
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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          expect(normalized.inputs).toHaveLength(2);
          expect(normalized.outputs).toHaveLength(2);

          // Verify all inputs and outputs are mapped correctly
          expect(normalized.inputs[0]?.amounts[0]?.quantity).toBe('3000000');
          expect(normalized.inputs[1]?.amounts[0]?.quantity).toBe('2000000');
          expect(normalized.outputs[0]?.amounts[0]?.quantity).toBe('2500000');
          expect(normalized.outputs[1]?.amounts[0]?.quantity).toBe('2330000');
        }
      });

      it('should handle transaction with only native tokens (no ADA)', () => {
        const mockTransaction: BlockfrostTransactionWithMetadata = {
          ...createBaseFixture(),
          inputs: [
            {
              address:
                'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty',
              amount: [
                {
                  unit: 'token123abc',
                  quantity: '1000000',
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
                {
                  unit: 'token123abc',
                  quantity: '1000000',
                },
              ],
              output_index: 0,
            },
          ],
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          expect(normalized.inputs[0]?.amounts[0]?.unit).toBe('token123abc');
          expect(normalized.inputs[0]?.amounts[0]?.symbol).toBeUndefined();
          expect(normalized.outputs[0]?.amounts[0]?.unit).toBe('token123abc');
          expect(normalized.outputs[0]?.amounts[0]?.symbol).toBeUndefined();
        }
      });

      it('should handle very large token quantities', () => {
        const largeQuantity = '999999999999999999999999';
        const mockTransaction: BlockfrostTransactionWithMetadata = {
          ...createBaseFixture(),
          outputs: [
            {
              address:
                'addr1qxyz789abc123def456ghi789jkl012mno345pqr678stu901vwx234yza567bcd890efg123hij456klm789nop012qrs',
              amount: [
                { unit: 'lovelace', quantity: largeQuantity },
                { unit: 'nativetoken', quantity: largeQuantity },
              ],
              output_index: 0,
            },
          ],
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          // Verify quantities are preserved as strings
          expect(normalized.outputs[0]?.amounts[0]?.quantity).toBe(largeQuantity);
          expect(normalized.outputs[0]?.amounts[1]?.quantity).toBe(largeQuantity);
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

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const normalized = result.value;

          // Verify all top-level fields
          expect(normalized.id).toBe(mockTransaction.hash);
          expect(normalized.providerName).toBe('blockfrost');
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
          expect(normalized.inputs[0]?.address).toBe(mockTransaction.inputs[0]?.address);
          expect(normalized.inputs[0]?.txHash).toBe(mockTransaction.inputs[0]?.tx_hash);
          expect(normalized.inputs[0]?.outputIndex).toBe(2);
          expect(normalized.inputs[0]?.amounts).toHaveLength(2);

          // Verify outputs structure
          expect(normalized.outputs).toHaveLength(2);
          expect(normalized.outputs[0]?.address).toBe(mockTransaction.outputs[0]?.address);
          expect(normalized.outputs[0]?.outputIndex).toBe(0);
          expect(normalized.outputs[0]?.amounts).toHaveLength(2);
          expect(normalized.outputs[1]?.address).toBe(mockTransaction.outputs[1]?.address);
          expect(normalized.outputs[1]?.outputIndex).toBe(1);
          expect(normalized.outputs[1]?.amounts).toHaveLength(1);
        }
      });
    });

    describe('Edge cases', () => {
      it('should handle minimum block height (0 or 1)', () => {
        const mockTransaction = {
          ...createBaseFixture(),
          block_height: 0,
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.blockHeight).toBe(0);
        }
      });

      it('should handle single input and single output', () => {
        const mockTransaction = createBaseFixture();

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.inputs).toHaveLength(1);
          expect(result.value.outputs).toHaveLength(1);
        }
      });

      it('should preserve output_index values correctly', () => {
        const mockTransaction: BlockfrostTransactionWithMetadata = {
          ...createBaseFixture(),
          inputs: [
            {
              address: 'addr1',
              amount: [{ unit: 'lovelace', quantity: '1000000' }],
              tx_hash: 'hash1',
              output_index: 5,
            },
          ],
          outputs: [
            {
              address: 'addr2',
              amount: [{ unit: 'lovelace', quantity: '500000' }],
              output_index: 10,
            },
          ],
        };

        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.inputs[0]?.outputIndex).toBe(5);
          expect(result.value.outputs[0]?.outputIndex).toBe(10);
        }
      });

      it('should always return ok result (never errors)', () => {
        const mockTransaction = createBaseFixture();
        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        // The mapper never returns errors currently
        expect(result.isOk()).toBe(true);
        expect(result.isErr()).toBe(false);
      });
    });

    describe('Provider name', () => {
      it('should always set providerName to blockfrost', () => {
        const mockTransaction = createBaseFixture();
        const result = mapBlockfrostTransaction(mockTransaction, sourceContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.providerName).toBe('blockfrost');
        }
      });

      it('should set providerName regardless of source context', () => {
        const mockTransaction = createBaseFixture();
        const customContext: SourceMetadata = {
          address: 'different-address',
          name: 'custom-name',
        };

        const result = mapBlockfrostTransaction(mockTransaction, customContext);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.providerName).toBe('blockfrost');
        }
      });
    });
  });
});
