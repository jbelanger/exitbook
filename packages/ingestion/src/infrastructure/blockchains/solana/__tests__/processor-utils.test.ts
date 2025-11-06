/* eslint-disable unicorn/no-useless-undefined -- needed by testing logic */
import type { SolanaTransaction } from '@exitbook/providers';
import { describe, expect, it } from 'vitest';

import {
  analyzeSolanaBalanceChanges,
  classifySolanaOperationFromFundFlow,
  consolidateSolanaMovements,
  detectSolanaNFTInstructions,
  detectSolanaStakingInstructions,
  detectSolanaSwapInstructions,
  detectSolanaTokenTransferInstructions,
  isZeroDecimal,
} from '../processor-utils.js';
import type { SolanaFundFlow, SolanaMovement } from '../types.js';

describe('Solana Processor Utils', () => {
  describe('detectSolanaStakingInstructions', () => {
    it('should return false for undefined instructions', () => {
      expect(detectSolanaStakingInstructions(undefined)).toBe(false);
    });

    it('should return false for empty instructions', () => {
      expect(detectSolanaStakingInstructions([])).toBe(false);
    });

    it('should detect System Program staking', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: '11111111111111111111111111111112',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(true);
    });

    it('should detect Stake Program', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'Stake11111111111111111111111111111111111112',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(true);
    });

    it('should detect Marinade Finance staking', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(true);
    });

    it('should detect Jito Staking', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(true);
    });

    it('should return false for non-staking programs', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(false);
    });

    it('should detect staking in mixed instructions', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
        {
          programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
        },
      ];
      expect(detectSolanaStakingInstructions(instructions)).toBe(true);
    });
  });

  describe('detectSolanaSwapInstructions', () => {
    it('should return false for undefined instructions', () => {
      expect(detectSolanaSwapInstructions(undefined)).toBe(false);
    });

    it('should return false for empty instructions', () => {
      expect(detectSolanaSwapInstructions([])).toBe(false);
    });

    it('should detect Jupiter v6', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        },
      ];
      expect(detectSolanaSwapInstructions(instructions)).toBe(true);
    });

    it('should detect Raydium AMM', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        },
      ];
      expect(detectSolanaSwapInstructions(instructions)).toBe(true);
    });

    it('should detect Orca Whirlpools', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
        },
      ];
      expect(detectSolanaSwapInstructions(instructions)).toBe(true);
    });

    it('should detect Meteora DLMM', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
        },
      ];
      expect(detectSolanaSwapInstructions(instructions)).toBe(true);
    });

    it('should return false for non-swap programs', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
      ];
      expect(detectSolanaSwapInstructions(instructions)).toBe(false);
    });
  });

  describe('detectSolanaTokenTransferInstructions', () => {
    it('should return false for undefined instructions', () => {
      expect(detectSolanaTokenTransferInstructions(undefined)).toBe(false);
    });

    it('should return false for empty instructions', () => {
      expect(detectSolanaTokenTransferInstructions([])).toBe(false);
    });

    it('should detect SPL Token Program', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        },
      ];
      expect(detectSolanaTokenTransferInstructions(instructions)).toBe(true);
    });

    it('should detect Token-2022 Program', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        },
      ];
      expect(detectSolanaTokenTransferInstructions(instructions)).toBe(true);
    });

    it('should return false for non-token programs', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        },
      ];
      expect(detectSolanaTokenTransferInstructions(instructions)).toBe(false);
    });
  });

  describe('detectSolanaNFTInstructions', () => {
    it('should return false for undefined instructions', () => {
      expect(detectSolanaNFTInstructions(undefined)).toBe(false);
    });

    it('should return false for empty instructions', () => {
      expect(detectSolanaNFTInstructions([])).toBe(false);
    });

    it('should detect Metaplex Token Metadata Program', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
        },
      ];
      expect(detectSolanaNFTInstructions(instructions)).toBe(true);
    });

    it('should detect Magic Eden v2', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K',
        },
      ];
      expect(detectSolanaNFTInstructions(instructions)).toBe(true);
    });

    it('should detect Candy Machine v3', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ',
        },
      ];
      expect(detectSolanaNFTInstructions(instructions)).toBe(true);
    });

    it('should return false for non-NFT programs', () => {
      const instructions: SolanaTransaction['instructions'] = [
        {
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        },
      ];
      expect(detectSolanaNFTInstructions(instructions)).toBe(false);
    });
  });

  describe('consolidateSolanaMovements', () => {
    it('should return empty array for empty input', () => {
      expect(consolidateSolanaMovements([])).toEqual([]);
    });

    it('should return single movement unchanged', () => {
      const movements: SolanaMovement[] = [
        {
          amount: '100',
          asset: 'SOL',
        },
      ];
      expect(consolidateSolanaMovements(movements)).toEqual(movements);
    });

    it('should consolidate duplicate assets by summing amounts', () => {
      const movements: SolanaMovement[] = [
        {
          amount: '100',
          asset: 'SOL',
        },
        {
          amount: '50',
          asset: 'SOL',
        },
      ];
      const result = consolidateSolanaMovements(movements);
      expect(result).toHaveLength(1);
      expect(result[0]?.asset).toBe('SOL');
      expect(result[0]?.amount).toBe('150');
    });

    it('should preserve token metadata when consolidating', () => {
      const movements: SolanaMovement[] = [
        {
          amount: '100',
          asset: 'USDC',
          decimals: 6,
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
        {
          amount: '50',
          asset: 'USDC',
          decimals: 6,
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ];
      const result = consolidateSolanaMovements(movements);
      expect(result).toHaveLength(1);
      expect(result[0]?.asset).toBe('USDC');
      expect(result[0]?.amount).toBe('150');
      expect(result[0]?.decimals).toBe(6);
      expect(result[0]?.tokenAddress).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should keep different assets separate', () => {
      const movements: SolanaMovement[] = [
        {
          amount: '100',
          asset: 'SOL',
        },
        {
          amount: '50',
          asset: 'USDC',
          decimals: 6,
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        },
      ];
      const result = consolidateSolanaMovements(movements);
      expect(result).toHaveLength(2);
      expect(result.find((m) => m.asset === 'SOL')?.amount).toBe('100');
      expect(result.find((m) => m.asset === 'USDC')?.amount).toBe('50');
    });

    it('should handle multiple consolidations correctly', () => {
      const movements: SolanaMovement[] = [
        { amount: '100', asset: 'SOL' },
        { amount: '50', asset: 'USDC', decimals: 6 },
        { amount: '25', asset: 'SOL' },
        { amount: '75', asset: 'USDC', decimals: 6 },
        { amount: '10', asset: 'BONK', decimals: 5 },
      ];
      const result = consolidateSolanaMovements(movements);
      expect(result).toHaveLength(3);
      expect(result.find((m) => m.asset === 'SOL')?.amount).toBe('125');
      expect(result.find((m) => m.asset === 'USDC')?.amount).toBe('125');
      expect(result.find((m) => m.asset === 'BONK')?.amount).toBe('10');
    });

    it('should handle decimal amounts correctly', () => {
      const movements: SolanaMovement[] = [
        { amount: '0.1', asset: 'SOL' },
        { amount: '0.2', asset: 'SOL' },
        { amount: '0.3', asset: 'SOL' },
      ];
      const result = consolidateSolanaMovements(movements);
      expect(result).toHaveLength(1);
      expect(result[0]?.asset).toBe('SOL');
      expect(result[0]?.amount).toBe('0.6');
    });
  });

  describe('classifySolanaOperationFromFundFlow', () => {
    describe('Pattern 1: Staking operations', () => {
      it('should classify staking with only outflows as stake', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'stake456',
          hasMultipleInstructions: true,
          hasStaking: true,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 2,
          transactionCount: 1,
          inflows: [],
          outflows: [{ amount: '10', asset: 'SOL' }],
          primary: { amount: '10', asset: 'SOL' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('staking');
        expect(result.operation.type).toBe('stake');
      });

      it('should classify staking with small inflow as reward', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'stake456',
          toAddress: 'user123',
          hasMultipleInstructions: true,
          hasStaking: true,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 2,
          transactionCount: 1,
          inflows: [{ amount: '0.5', asset: 'SOL' }],
          outflows: [],
          primary: { amount: '0.5', asset: 'SOL' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('staking');
        expect(result.operation.type).toBe('reward');
      });

      it('should classify staking with large inflow as unstake', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'stake456',
          toAddress: 'user123',
          hasMultipleInstructions: true,
          hasStaking: true,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 2,
          transactionCount: 1,
          inflows: [{ amount: '10', asset: 'SOL' }],
          outflows: [],
          primary: { amount: '10', asset: 'SOL' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('staking');
        expect(result.operation.type).toBe('unstake');
      });

      it('should handle complex staking with both inflows and outflows', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'stake456',
          hasMultipleInstructions: true,
          hasStaking: true,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 2,
          transactionCount: 1,
          inflows: [{ amount: '5', asset: 'SOL' }],
          outflows: [{ amount: '10', asset: 'SOL' }],
          primary: { amount: '10', asset: 'SOL' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('staking');
        expect(result.operation.type).toBe('stake');
        expect(result.note?.type).toBe('classification_uncertain');
      });
    });

    describe('Pattern 2: Fee-only transactions', () => {
      it('should classify fee-only transactions', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'user123',
          hasMultipleInstructions: false,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 1,
          transactionCount: 1,
          inflows: [],
          outflows: [],
          primary: { amount: '0', asset: 'SOL' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('fee');
        expect(result.operation.type).toBe('fee');
      });
    });

    describe('Pattern 3: Single-asset swaps', () => {
      it('should classify single-asset swap with different assets', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'user123',
          hasMultipleInstructions: true,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 3,
          transactionCount: 1,
          inflows: [{ amount: '1000', asset: 'USDC' }],
          outflows: [{ amount: '5', asset: 'SOL' }],
          primary: { amount: '1000', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('trade');
        expect(result.operation.type).toBe('swap');
      });
    });

    describe('Pattern 4: DEX swap detection', () => {
      it('should classify swap when DEX program detected', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'user123',
          hasMultipleInstructions: true,
          hasStaking: false,
          hasSwaps: true,
          hasTokenTransfers: true,
          instructionCount: 5,
          transactionCount: 1,
          inflows: [
            { amount: '1000', asset: 'USDC' },
            { amount: '0.1', asset: 'SOL' },
          ],
          outflows: [{ amount: '5', asset: 'SOL' }],
          primary: { amount: '1000', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('trade');
        expect(result.operation.type).toBe('swap');
        expect(result.note?.type).toBe('program_based_classification');
      });
    });

    describe('Pattern 6: Deposits', () => {
      it('should classify transactions with only inflows as deposits', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: false,
          feeAbsorbedByMovement: false,
          fromAddress: 'sender123',
          toAddress: 'user123',
          hasMultipleInstructions: false,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 1,
          transactionCount: 1,
          inflows: [{ amount: '100', asset: 'USDC' }],
          outflows: [],
          primary: { amount: '100', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('deposit');
      });
    });

    describe('Pattern 7: Withdrawals', () => {
      it('should classify transactions with only outflows as withdrawals', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'recipient456',
          hasMultipleInstructions: false,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 1,
          transactionCount: 1,
          inflows: [],
          outflows: [{ amount: '100', asset: 'USDC' }],
          primary: { amount: '100', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('withdrawal');
      });
    });

    describe('Pattern 8: Self-transfers', () => {
      it('should classify same-asset in and out as transfer', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'user456',
          hasMultipleInstructions: false,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 1,
          transactionCount: 1,
          inflows: [{ amount: '100', asset: 'USDC' }],
          outflows: [{ amount: '100', asset: 'USDC' }],
          primary: { amount: '100', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('transfer');
      });
    });

    describe('Pattern 9: Complex multi-asset transactions', () => {
      it('should handle complex transactions with uncertainty note', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'pool456',
          hasMultipleInstructions: true,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 10,
          transactionCount: 1,
          inflows: [
            { amount: '100', asset: 'USDC' },
            { amount: '50', asset: 'USDT' },
          ],
          outflows: [
            { amount: '5', asset: 'SOL' },
            { amount: '1000', asset: 'BONK' },
          ],
          primary: { amount: '100', asset: 'USDC' },
          classificationUncertainty:
            'Complex transaction with 2 outflow(s) and 2 inflow(s). May be liquidity provision, batch operation, or multi-asset swap.',
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('transfer');
        expect(result.note?.type).toBe('classification_uncertain');
        expect(result.note?.message).toContain('Complex transaction');
      });
    });

    describe('Pattern 10: Batch operations', () => {
      it('should classify batch operations with many instructions', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'user123',
          hasMultipleInstructions: true,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: true,
          instructionCount: 5,
          transactionCount: 1,
          inflows: [
            { amount: '100', asset: 'USDC' },
            { amount: '50', asset: 'SOL' },
          ],
          outflows: [
            { amount: '100', asset: 'USDC' },
            { amount: '25', asset: 'SOL' },
          ],
          primary: { amount: '100', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('transfer');
        expect(result.note?.type).toBe('batch_operation');
        expect(result.note?.message).toContain('Batch transaction with 5 instructions');
      });
    });

    describe('Ultimate fallback', () => {
      it('should fallback when no pattern matches', () => {
        const fundFlow: SolanaFundFlow = {
          computeUnitsUsed: 1000,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          feePaidByUser: true,
          feeAbsorbedByMovement: false,
          fromAddress: 'user123',
          toAddress: 'unknown456',
          hasMultipleInstructions: false,
          hasStaking: false,
          hasSwaps: false,
          hasTokenTransfers: false,
          instructionCount: 1,
          transactionCount: 1,
          inflows: [
            { amount: '100', asset: 'USDC' },
            { amount: '50', asset: 'USDT' },
          ],
          outflows: [
            { amount: '75', asset: 'SOL' },
            { amount: '25', asset: 'BONK' },
          ],
          primary: { amount: '100', asset: 'USDC' },
        };

        const result = classifySolanaOperationFromFundFlow(fundFlow, []);
        expect(result.operation.category).toBe('transfer');
        expect(result.operation.type).toBe('transfer');
        expect(result.note?.type).toBe('classification_failed');
        expect(result.note?.severity).toBe('warning');
      });
    });
  });

  describe('analyzeSolanaBalanceChanges', () => {
    const userAddress = 'userAddress123';
    const otherAddress = 'otherAddress456';
    const allWalletAddresses = new Set([userAddress]);

    // Helper to create minimal valid SolanaTransaction
    const createTx = (overrides: Partial<SolanaTransaction> = {}): SolanaTransaction => ({
      amount: '0',
      currency: 'SOL',
      from: userAddress,
      id: 'tx1',
      providerId: 'helius',
      status: 'success',
      timestamp: Date.now(),
      to: otherAddress,
      ...overrides,
    });

    it('should collect SOL outflows from account changes', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '1000000000', // 1 SOL in lamports
            postBalance: '500000000', // 0.5 SOL in lamports
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.asset).toBe('SOL');
      expect(result.outflows[0]?.amount).toBe('0.499995'); // 0.5 - 0.000005 fee
      expect(result.inflows).toHaveLength(0);
    });

    it('should collect SOL inflows from account changes', () => {
      const tx = createTx({
        from: otherAddress,
        to: userAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '500000000', // 0.5 SOL in lamports
            postBalance: '1000000000', // 1 SOL in lamports
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.asset).toBe('SOL');
      expect(result.inflows[0]?.amount).toBe('0.5');
      expect(result.outflows).toHaveLength(0);
    });

    it('should collect token outflows from token changes', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        tokenChanges: [
          {
            account: 'tokenAccount123',
            owner: userAddress,
            mint: 'USDCMint',
            symbol: 'USDC',
            decimals: 6,
            preAmount: '1000000', // 1 USDC in smallest units
            postAmount: '500000', // 0.5 USDC in smallest units
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.outflows).toHaveLength(1);
      expect(result.outflows[0]?.asset).toBe('USDC');
      expect(result.outflows[0]?.amount).toBe('0.5');
      expect(result.outflows[0]?.decimals).toBe(6);
      expect(result.outflows[0]?.tokenAddress).toBe('USDCMint');
      expect(result.inflows).toHaveLength(0);
    });

    it('should collect token inflows from token changes', () => {
      const tx = createTx({
        from: otherAddress,
        to: userAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        tokenChanges: [
          {
            account: 'tokenAccount123',
            owner: userAddress,
            mint: 'USDCMint',
            symbol: 'USDC',
            decimals: 6,
            preAmount: '500000', // 0.5 USDC in smallest units
            postAmount: '1000000', // 1 USDC in smallest units
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.inflows).toHaveLength(1);
      expect(result.inflows[0]?.asset).toBe('USDC');
      expect(result.inflows[0]?.amount).toBe('0.5');
      expect(result.outflows).toHaveLength(0);
    });

    it('should determine feePaidByUser when user has outflows', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '1000000000',
            postBalance: '500000000',
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.feePaidByUser).toBe(true);
    });

    it('should determine feePaidByUser is false when user only has inflows', () => {
      const tx = createTx({
        from: otherAddress,
        to: userAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '500000000',
            postBalance: '1000000000',
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.feePaidByUser).toBe(false);
    });

    it('should determine feePaidByUser when user initiated transaction with no movements', () => {
      const tx = createTx({
        from: userAddress,
        to: userAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [],
        tokenChanges: [],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.feePaidByUser).toBe(true);
    });

    describe('Fee deduction logic (Issue #78)', () => {
      it('should deduct fee from SOL outflow', () => {
        const tx = createTx({
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000', // 1 SOL
              postBalance: '999994995', // 0.999994995 SOL (already includes fee deduction)
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        // The raw outflow is 0.000005005, fee is 0.000005, so result should be 0.000000005
        expect(result.outflows).toHaveLength(1);
        expect(result.outflows[0]?.asset).toBe('SOL');
        expect(parseFloat(result.outflows[0]?.amount || '0')).toBeCloseTo(0.000000005, 9);
      });

      it('should handle fee-only transaction by removing zero outflow', () => {
        const tx = createTx({
          from: userAddress,
          to: userAddress,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000', // 1 SOL
              postBalance: '999995000', // 0.999995 SOL (only fee deducted)
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        // Fee exactly matches outflow, so outflow is removed
        expect(result.outflows).toHaveLength(0);
        expect(result.feeAbsorbedByMovement).toBe(true);
      });

      it('should set feeAbsorbedByMovement when fee removes all outflows', () => {
        const tx = createTx({
          from: userAddress,
          to: userAddress,
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000',
              postBalance: '999995000',
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        expect(result.feeAbsorbedByMovement).toBe(true);
      });

      it('should not set feeAbsorbedByMovement when outflows remain after fee deduction', () => {
        const tx = createTx({
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000',
              postBalance: '500000000',
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        expect(result.feeAbsorbedByMovement).toBe(false);
        expect(result.outflows.length).toBeGreaterThan(0);
      });

      it('should not deduct fee from token outflows, only SOL', () => {
        const tx = createTx({
          feeAmount: '0.000005',
          feeCurrency: 'SOL',
          tokenChanges: [
            {
              account: 'tokenAccount123',
              owner: userAddress,
              mint: 'USDCMint',
              symbol: 'USDC',
              decimals: 6,
              preAmount: '1000000',
              postAmount: '500000',
            },
          ],
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000',
              postBalance: '999995000', // Only fee deducted
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        // USDC outflow should not be affected by fee
        const usdcOutflow = result.outflows.find((o) => o.asset === 'USDC');
        expect(usdcOutflow?.amount).toBe('0.5');

        // SOL outflow should be removed (fee-only)
        const solOutflow = result.outflows.find((o) => o.asset === 'SOL');
        expect(solOutflow).toBeUndefined();
      });

      it('should handle multiple SOL outflows with fee deduction', () => {
        const tx = createTx({
          feeAmount: '0.000010',
          feeCurrency: 'SOL',
          accountChanges: [
            {
              account: userAddress,
              preBalance: '1000000000',
              postBalance: '999990000', // 0.99999 SOL (0.00001 outflow including fee)
            },
          ],
        });

        const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

        // After fee deduction, outflow should be zero
        expect(result.outflows).toHaveLength(0);
        expect(result.feeAbsorbedByMovement).toBe(true);
      });
    });

    it('should skip zero balance changes', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '1000000000',
            postBalance: '1000000000', // No change
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.inflows).toHaveLength(0);
      expect(result.outflows).toHaveLength(0);
    });

    it('should ignore non-user accounts', () => {
      const tx = createTx({
        from: otherAddress,
        to: otherAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: otherAddress,
            preBalance: '1000000000',
            postBalance: '500000000',
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.inflows).toHaveLength(0);
      expect(result.outflows).toHaveLength(0);
    });

    it('should set classification uncertainty for multi-asset transactions', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        tokenChanges: [
          {
            account: 'tokenAccount123',
            owner: userAddress,
            mint: 'USDCMint',
            symbol: 'USDC',
            decimals: 6,
            preAmount: '500000',
            postAmount: '1000000',
          },
          {
            account: 'tokenAccount456',
            owner: userAddress,
            mint: 'USDTMint',
            symbol: 'USDT',
            decimals: 6,
            preAmount: '500000',
            postAmount: '1000000',
          },
          {
            account: 'tokenAccount789',
            owner: userAddress,
            mint: 'BonkMint',
            symbol: 'BONK',
            decimals: 5,
            preAmount: '1000000',
            postAmount: '500000',
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.classificationUncertainty).toBeDefined();
      expect(result.classificationUncertainty).toContain('Complex transaction');
      expect(result.classificationUncertainty).toContain('2 inflow(s)');
    });

    it('should select largest inflow as primary', () => {
      const tx = createTx({
        from: otherAddress,
        to: userAddress,
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        tokenChanges: [
          {
            account: 'tokenAccount123',
            owner: userAddress,
            mint: 'USDCMint',
            symbol: 'USDC',
            decimals: 6,
            preAmount: '500000',
            postAmount: '2000000', // +1.5 USDC
          },
          {
            account: 'tokenAccount456',
            owner: userAddress,
            mint: 'USDTMint',
            symbol: 'USDT',
            decimals: 6,
            preAmount: '500000',
            postAmount: '1000000', // +0.5 USDT
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      expect(result.primary.asset).toBe('USDC');
      expect(result.primary.amount).toBe('1.5');
    });

    it('should select largest outflow as primary when no inflows', () => {
      const tx = createTx({
        feeAmount: '0.000005',
        feeCurrency: 'SOL',
        accountChanges: [
          {
            account: userAddress,
            preBalance: '2000000000',
            postBalance: '1000000000', // -1 SOL + fee
          },
        ],
        tokenChanges: [
          {
            account: 'tokenAccount123',
            owner: userAddress,
            mint: 'USDCMint',
            symbol: 'USDC',
            decimals: 6,
            preAmount: '1000000',
            postAmount: '500000', // -0.5 USDC
          },
        ],
      });

      const result = analyzeSolanaBalanceChanges(tx, allWalletAddresses);

      // SOL outflow (0.999995) is larger than USDC (0.5)
      expect(result.primary.asset).toBe('SOL');
    });
  });

  describe('isZeroDecimal', () => {
    it('should return true for "0"', () => {
      expect(isZeroDecimal('0')).toBe(true);
    });

    it('should return true for "0.0"', () => {
      expect(isZeroDecimal('0.0')).toBe(true);
    });

    it('should return true for "0.00000"', () => {
      expect(isZeroDecimal('0.00000')).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isZeroDecimal('')).toBe(true);
    });

    it('should return false for "1"', () => {
      expect(isZeroDecimal('1')).toBe(false);
    });

    it('should return false for "0.1"', () => {
      expect(isZeroDecimal('0.1')).toBe(false);
    });

    it('should return false for "-0.1"', () => {
      expect(isZeroDecimal('-0.1')).toBe(false);
    });

    it('should return true for invalid decimal string', () => {
      expect(isZeroDecimal('invalid')).toBe(true);
    });
  });
});
