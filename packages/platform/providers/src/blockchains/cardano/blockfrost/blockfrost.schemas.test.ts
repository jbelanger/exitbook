import { describe, expect, it } from 'vitest';

import {
  BlockfrostAddressSchema,
  BlockfrostAssetAmountSchema,
  BlockfrostTransactionDetailsSchema,
  BlockfrostTransactionHashSchema,
  BlockfrostTransactionUtxosSchema,
  BlockfrostTransactionWithMetadataSchema,
  BlockfrostUtxoInputSchema,
  BlockfrostUtxoOutputSchema,
} from './blockfrost.schemas.js';

describe('blockfrost.schemas', () => {
  describe('BlockfrostAssetAmountSchema', () => {
    describe('valid data', () => {
      it('should validate lovelace amount', () => {
        const valid = {
          unit: 'lovelace',
          quantity: '1000000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate native token amount', () => {
        const valid = {
          unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e',
          quantity: '5000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate zero amount', () => {
        const valid = {
          unit: 'lovelace',
          quantity: '0',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate very large amounts', () => {
        const valid = {
          unit: 'lovelace',
          quantity: '45000000000000000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject empty unit', () => {
        const invalid = {
          unit: '',
          quantity: '1000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Asset unit must not be empty');
        }
      });

      it('should reject missing unit', () => {
        const invalid = {
          quantity: '1000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject missing quantity', () => {
        const invalid = {
          unit: 'lovelace',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject non-numeric quantity', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: 'abc123',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Asset quantity must be a numeric string');
        }
      });

      it('should reject negative quantity', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: '-1000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Asset quantity must be a numeric string');
        }
      });

      it('should reject quantity with decimal point', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: '1000.5',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Asset quantity must be a numeric string');
        }
      });

      it('should reject scientific notation', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: '1e6',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Asset quantity must be a numeric string');
        }
      });

      it('should reject quantity with spaces', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: '1 000 000',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          unit: 'lovelace',
          quantity: '1000',
          extraField: 'not allowed',
        };

        const result = BlockfrostAssetAmountSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostTransactionHashSchema', () => {
    describe('valid data', () => {
      it('should validate transaction hash entry', () => {
        const valid = {
          tx_hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
          tx_index: 5,
          block_height: 8129403,
          block_time: 1705318200000,
        };

        const result = BlockfrostTransactionHashSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.block_time).toBeInstanceOf(Date);
        }
      });

      it('should convert Unix timestamp to Date', () => {
        const valid = {
          tx_hash: 'abc123',
          tx_index: 0,
          block_height: 1000000,
          block_time: 1704067200,
        };

        const result = BlockfrostTransactionHashSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.block_time).toBeInstanceOf(Date);
          expect(result.data.block_time.getTime()).toBe(1704067200000);
        }
      });
    });

    describe('invalid data', () => {
      it('should reject empty tx_hash', () => {
        const invalid = {
          tx_hash: '',
          tx_index: 5,
          block_height: 100,
          block_time: 1704067200,
        };

        const result = BlockfrostTransactionHashSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction hash must not be empty');
        }
      });

      it('should reject negative tx_index', () => {
        const invalid = {
          tx_hash: 'abc123',
          tx_index: -1,
          block_height: 100,
          block_time: 1704067200,
        };

        const result = BlockfrostTransactionHashSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction index must be non-negative');
        }
      });

      it('should reject negative block_height', () => {
        const invalid = {
          tx_hash: 'abc123',
          tx_index: 0,
          block_height: -100,
          block_time: 1704067200,
        };

        const result = BlockfrostTransactionHashSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Block height must be non-negative');
        }
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          tx_hash: 'abc123',
          tx_index: 0,
          block_height: 100,
          block_time: 1704067200,
          extra: 'field',
        };

        const result = BlockfrostTransactionHashSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostUtxoInputSchema', () => {
    const validCardanoAddress =
      'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty';

    describe('valid data', () => {
      it('should validate basic input', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'b6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7',
          output_index: 0,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate input with multiple assets', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [
            { unit: 'lovelace', quantity: '5000000' },
            { unit: 'b0d07d45fe9514f80213f4020e5a61241458be626841cde717cb38a76e7574636f696e', quantity: '1000' },
          ],
          tx_hash: 'abc123',
          output_index: 1,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate input with optional Plutus fields', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'abc123',
          output_index: 0,
          data_hash: 'hash123',
          inline_datum: 'datum123',
          reference_script_hash: 'script123',
          collateral: true,
          reference: false,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should allow nullable optional fields', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'abc123',
          output_index: 0,
          data_hash: undefined,
          inline_datum: undefined,
          reference_script_hash: undefined,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject invalid address format', () => {
        const invalid = {
          address: 'invalid-address',
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'abc123',
          output_index: 0,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject empty amount array', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [],
          tx_hash: 'abc123',
          output_index: 0,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Input must have at least one asset');
        }
      });

      it('should reject empty tx_hash', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: '',
          output_index: 0,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Input transaction hash must not be empty');
        }
      });

      it('should reject negative output_index', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'abc123',
          output_index: -1,
        };

        const result = BlockfrostUtxoInputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Output index must be non-negative');
        }
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '5000000' }],
          tx_hash: 'abc123',
          output_index: 0,
          unknown_field: 'value',
        };

        const result = BlockfrostUtxoInputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostUtxoOutputSchema', () => {
    const validCardanoAddress =
      'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty';

    describe('valid data', () => {
      it('should validate basic output', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '4830000' }],
          output_index: 0,
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate output with optional fields', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '4830000' }],
          output_index: 0,
          data_hash: 'hash123',
          inline_datum: 'datum123',
          reference_script_hash: 'script123',
          collateral: false,
          reference: true,
          consumed_by_tx: 'tx_hash_123',
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should allow nullable optional fields', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '4830000' }],
          output_index: 0,
          consumed_by_tx: undefined,
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject empty amount array', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [],
          output_index: 0,
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Output must have at least one asset');
        }
      });

      it('should reject negative output_index', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '4830000' }],
          output_index: -1,
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Output index must be non-negative');
        }
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '4830000' }],
          output_index: 0,
          extra: 'field',
        };

        const result = BlockfrostUtxoOutputSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostTransactionUtxosSchema', () => {
    const validCardanoAddress =
      'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty';

    describe('valid data', () => {
      it('should validate transaction with UTXOs', () => {
        const valid = {
          hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev_tx',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate transaction with multiple inputs and outputs', () => {
        const valid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '3000000' }],
              tx_hash: 'prev1',
              output_index: 0,
            },
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '2000000' }],
              tx_hash: 'prev2',
              output_index: 1,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '2500000' }],
              output_index: 0,
            },
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '2330000' }],
              output_index: 1,
            },
          ],
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject empty hash', () => {
        const invalid = {
          hash: '',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction hash must not be empty');
        }
      });

      it('should reject empty inputs array', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction must have at least one input');
        }
      });

      it('should reject empty outputs array', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [],
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction must have at least one output');
        }
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          unknown: 'field',
        };

        const result = BlockfrostTransactionUtxosSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostTransactionDetailsSchema', () => {
    describe('valid data', () => {
      it('should validate complete transaction details', () => {
        const valid = {
          hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
          block: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
          block_height: 8129403,
          block_time: 1705318200,
          slot: 123456789,
          index: 5,
          fees: '170000',
          size: 450,
          invalid_before: undefined,
          invalid_hereafter: undefined,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.block_time).toBeInstanceOf(Date);
        }
      });

      it('should validate transaction with optional deposit field', () => {
        const valid = {
          hash: 'tx123',
          block: 'block123',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 1,
          stake_cert_count: 1,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
          deposit: '2000000',
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate transaction with output_amount', () => {
        const valid = {
          hash: 'tx123',
          block: 'block123',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
          output_amount: [
            { unit: 'lovelace', quantity: '5000000' },
            { unit: 'token123', quantity: '1000' },
          ],
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject empty block hash', () => {
        const invalid = {
          hash: 'tx123',
          block: '',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Block hash must not be empty');
        }
      });

      it('should reject non-numeric string for fees', () => {
        const invalid = {
          hash: 'tx123',
          block: 'block123',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: 'abc',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Fee must be a numeric string (lovelace)');
        }
      });

      it('should reject negative block_height', () => {
        const invalid = {
          hash: 'tx123',
          block: 'block123',
          block_height: -100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Block height must be non-negative');
        }
      });

      it('should reject negative fee amount in deposit', () => {
        const invalid = {
          hash: 'tx123',
          block: 'block123',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
          deposit: '-100',
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Deposit must be a numeric string (lovelace)');
        }
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          hash: 'tx123',
          block: 'block123',
          block_height: 100,
          block_time: 1704067200,
          slot: 12345,
          index: 0,
          fees: '170000',
          size: 300,
          utxo_count: 2,
          withdrawal_count: 0,
          mir_cert_count: 0,
          delegation_count: 0,
          stake_cert_count: 0,
          pool_update_count: 0,
          pool_retire_count: 0,
          asset_mint_or_burn_count: 0,
          redeemer_count: 0,
          valid_contract: true,
          unknown: 'field',
        };

        const result = BlockfrostTransactionDetailsSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostAddressSchema', () => {
    const validCardanoAddress =
      'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty';

    describe('valid data', () => {
      it('should validate Shelley address', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          stake_address: undefined,
          type: 'shelley' as const,
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate Byron address', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'byron' as const,
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate address with stake_address', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          stake_address: 'stake1uxyz123',
          type: 'shelley' as const,
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate script address', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'shelley' as const,
          script: true,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate address with multiple assets', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [
            { unit: 'lovelace', quantity: '5000000' },
            { unit: 'token123', quantity: '1000' },
            { unit: 'token456', quantity: '500' },
          ],
          type: 'shelley' as const,
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject invalid address format', () => {
        const invalid = {
          address: 'not-a-cardano-address',
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'shelley' as const,
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should allow empty amount array (zero balance)', () => {
        const valid = {
          address: validCardanoAddress,
          amount: [], // Empty array indicates zero balance
          script: false,
          type: 'shelley' as const,
        };

        const result = BlockfrostAddressSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.amount).toEqual([]);
        }
      });

      it('should reject invalid type', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'invalid',
          script: false,
        };

        const result = BlockfrostAddressSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject non-boolean script field', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'shelley' as const,
          script: 'true',
        };

        const result = BlockfrostAddressSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject unknown fields due to strict()', () => {
        const invalid = {
          address: validCardanoAddress,
          amount: [{ unit: 'lovelace', quantity: '1000000' }],
          type: 'shelley' as const,
          script: false,
          extra: 'field',
        };

        const result = BlockfrostAddressSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
        }
      });
    });
  });

  describe('BlockfrostTransactionWithMetadataSchema', () => {
    const validCardanoAddress =
      'addr1qxy483kxdaezq6qk0ptlh7gzcmqm2q6uyz4rjz5aq92whlvje44s8rhd3eyt9q3yvdvs3dw6y80ttwspnsmg5tgxa72su3mnty';

    describe('valid data', () => {
      it('should validate complete transaction with metadata', () => {
        const valid = {
          hash: 'a5c6df0e7e94f4b8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev_tx',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
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
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });

      it('should validate transaction with failed contract', () => {
        const valid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev_tx',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          block_height: 100,
          block_time: new Date('2024-01-01T00:00:00.000Z'),
          block_hash: 'block123',
          fees: '170000',
          tx_index: 0,
          valid_contract: false,
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(valid);
        expect(result.success).toBe(true);
      });
    });

    describe('invalid data', () => {
      it('should reject missing metadata fields', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          // Missing metadata fields
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject invalid fee format', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          block_height: 100,
          block_time: new Date(),
          block_hash: 'block123',
          fees: 'not-a-number',
          tx_index: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Fee must be a numeric string (lovelace)');
        }
      });

      it('should reject non-Date block_time', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          block_height: 100,
          block_time: 1704067200,
          block_hash: 'block123',
          fees: '170000',
          tx_index: 0,
          valid_contract: true,
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(invalid);
        expect(result.success).toBe(false);
      });

      it('should reject negative tx_index', () => {
        const invalid = {
          hash: 'tx123',
          inputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '5000000' }],
              tx_hash: 'prev',
              output_index: 0,
            },
          ],
          outputs: [
            {
              address: validCardanoAddress,
              amount: [{ unit: 'lovelace', quantity: '4830000' }],
              output_index: 0,
            },
          ],
          block_height: 100,
          block_time: new Date(),
          block_hash: 'block123',
          fees: '170000',
          tx_index: -1,
          valid_contract: true,
        };

        const result = BlockfrostTransactionWithMetadataSchema.safeParse(invalid);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('Transaction index must be non-negative');
        }
      });
    });
  });
});
