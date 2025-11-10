import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import type { OperationClassification } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { SolanaBalanceChangeAnalysis, SolanaFundFlow, SolanaMovement } from './types.js';

const logger = getLogger('solana-processor-utils');

/**
 * Program IDs for staking-related operations on Solana
 */
const STAKING_PROGRAMS: string[] = [
  '11111111111111111111111111111112', // System Program (stake account creation)
  'Stake11111111111111111111111111111111111112', // Stake Program
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', // Marinade Finance
  'CREAMfFfjMFogWFdFhLpAiRX8qC3BkyPUz7gW9DDfnMv', // Marinade MNDE staking
  'CgBg8TebSu4JbGQHRw6W7XvMc2UbNm8PXqEf9YUq4d7w', // Lido (Solido)
  'SoL1dMULNATED9WvXZVZoLTM1PnJqHQCkfkxLx7dWMk', // Solido Staking
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // Jito Staking
  'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxsgqyXsT', // Sanctum SPL Stake Pool
];

/**
 * Program IDs for DEX and swap operations on Solana
 */
const DEX_PROGRAMS: string[] = [
  // Aggregators
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', // Jupiter v4
  'JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo', // Jupiter v2

  // DEXs
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Serum DEX v3
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', // Raydium AMM v3
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpools
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // Serum DEX v2
  'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1', // Orca v1
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', // Phoenix
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora Pools
  '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c', // Lifinity v2
  'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S', // Lifinity v1
  'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ', // Saber Stable Swap
  'MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky', // Mercurial Stable Swap
];

/**
 * Program IDs for SPL token operations on Solana
 */
const TOKEN_PROGRAMS: string[] = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022 Program
];

/**
 * Program IDs for NFT-related operations on Solana
 */
const NFT_PROGRAMS: string[] = [
  // Metaplex
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Token Metadata Program
  'p1exdMJcjVao65QdewkaZRUnU6VPSXhus9n2GzWfh98', // Token Metadata (old)
  'cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTzeNMm2gRZ', // Candy Machine v3
  'cndyAnrLdpjq1Ssp1z8xxDsB8dxe7u4HL5Nxi2K5WXZ', // Candy Machine v2
  'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Candy Guard
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY', // Bubblegum (cNFTs)

  // Marketplaces
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K', // Magic Eden v2
  'MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8', // Magic Eden
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', // Tensor Swap
  'TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp', // Tensor cNFT
  'hadeK9DLv9eA7ya5KCTqSvSvRZeJC3JgD5a9Y3CNbvu', // Hadeswap
  'CJsLwbP1iu5DuUikHEJnLfANgKy6stB2uFgvBBHoyxwz', // Coral Cube
];

/**
 * Detect staking-related instructions in a Solana transaction
 */
export function detectSolanaStakingInstructions(instructions: SolanaTransaction['instructions']): boolean {
  if (!instructions) return false;

  return instructions.some((instruction) => instruction.programId && STAKING_PROGRAMS.includes(instruction.programId));
}

/**
 * Detect swap/DEX instructions in a Solana transaction
 */
export function detectSolanaSwapInstructions(instructions: SolanaTransaction['instructions']): boolean {
  if (!instructions) return false;

  return instructions.some((instruction) => instruction.programId && DEX_PROGRAMS.includes(instruction.programId));
}

/**
 * Detect SPL token transfer instructions in a Solana transaction
 */
export function detectSolanaTokenTransferInstructions(instructions: SolanaTransaction['instructions']): boolean {
  if (!instructions) return false;

  return instructions.some((instruction) => instruction.programId && TOKEN_PROGRAMS.includes(instruction.programId));
}

/**
 * Detect NFT-related instructions in a Solana transaction
 */
export function detectSolanaNFTInstructions(instructions: SolanaTransaction['instructions']): boolean {
  if (!instructions) return false;

  return instructions.some((instruction) => instruction.programId && NFT_PROGRAMS.includes(instruction.programId));
}

/**
 * Consolidate duplicate assets by summing amounts for the same asset
 */
export function consolidateSolanaMovements(movements: SolanaMovement[]): SolanaMovement[] {
  const assetMap = new Map<
    string,
    { amount: Decimal; decimals?: number | undefined; tokenAddress?: string | undefined }
  >();

  for (const movement of movements) {
    const existing = assetMap.get(movement.asset);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      const entry: { amount: Decimal; decimals?: number; tokenAddress?: string } = {
        amount: parseDecimal(movement.amount),
      };
      if (movement.decimals !== undefined) {
        entry.decimals = movement.decimals;
      }
      if (movement.tokenAddress !== undefined) {
        entry.tokenAddress = movement.tokenAddress;
      }
      assetMap.set(movement.asset, entry);
    }
  }

  return Array.from(assetMap.entries()).map(([asset, data]) => {
    const result: SolanaMovement = {
      amount: data.amount.toFixed(),
      asset,
      decimals: data.decimals,
      tokenAddress: data.tokenAddress,
    };
    return result;
  });
}

/**
 * Classify operation based on fund flow analysis with conservative pattern matching.
 * Only classifies patterns with 9/10 confidence. Complex cases get notes.
 */
export function classifySolanaOperationFromFundFlow(
  fundFlow: SolanaFundFlow,
  _instructions: SolanaTransaction['instructions']
): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const primaryAmount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const isZero = primaryAmount.isZero();

  // Pattern 1: Staking operations (high confidence based on program detection)
  if (fundFlow.hasStaking) {
    if (outflows.length > 0 && inflows.length === 0) {
      return {
        operation: {
          category: 'staking',
          type: 'stake',
        },
      };
    }

    if (inflows.length > 0 && outflows.length === 0) {
      // Check if reward or withdrawal based on amount
      const isReward = primaryAmount.greaterThan(0) && primaryAmount.lessThan(1); // Rewards are typically small
      return {
        operation: {
          category: 'staking',
          type: isReward ? 'reward' : 'unstake',
        },
      };
    }

    // Complex staking with both inflows and outflows
    return {
      note: {
        message: 'Complex staking operation with both inflows and outflows. Manual review recommended.',
        metadata: {
          hasStaking: true,
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'info',
        type: 'classification_uncertain',
      },
      operation: {
        category: 'staking',
        type: 'stake',
      },
    };
  }

  // Pattern 2: Fee-only transaction (no movements)
  if (isZero && inflows.length === 0 && outflows.length === 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 3: Single-asset swap (9/10 confident)
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset !== inAsset) {
      return {
        operation: {
          category: 'trade',
          type: 'swap',
        },
      };
    }
  }

  // Pattern 4: DEX swap detected by program (less confident than single-asset swap)
  if (fundFlow.hasSwaps) {
    return {
      note: {
        message: 'DEX program detected. Classified as swap based on program analysis.',
        metadata: {
          hasSwaps: true,
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'info',
        type: 'program_based_classification',
      },
      operation: {
        category: 'trade',
        type: 'swap',
      },
    };
  }

  // Pattern 6: Simple deposit (only inflows)
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 7: Simple withdrawal (only outflows)
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 8: Self-transfer (same asset in and out)
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset === inAsset) {
      return {
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }
  }

  // Pattern 9: Complex multi-asset transaction (UNCERTAIN - add note)
  if (fundFlow.classificationUncertainty) {
    return {
      note: {
        message: fundFlow.classificationUncertainty,
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'info',
        type: 'classification_uncertain',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 10: Batch operations (multiple instructions)
  if (fundFlow.hasMultipleInstructions && fundFlow.instructionCount > 3) {
    return {
      note: {
        message: `Batch transaction with ${fundFlow.instructionCount} instructions. May contain multiple operations.`,
        metadata: {
          hasMultipleInstructions: true,
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          instructionCount: fundFlow.instructionCount,
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'info',
        type: 'batch_operation',
      },
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Ultimate fallback: Couldn't match any confident pattern
  return {
    note: {
      message: 'Unable to determine transaction classification using confident patterns.',
      metadata: {
        inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
        outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
      },
      severity: 'warning',
      type: 'classification_failed',
    },
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  };
}

/**
 * Check if a decimal string value is zero
 */
export function isZeroDecimal(value: string): boolean {
  try {
    return parseDecimal(value || '0').isZero();
  } catch (error) {
    logger.warn({ error, value }, 'Failed to parse decimal value, treating as zero');
    return true;
  }
}

/**
 * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
 */
export function analyzeSolanaBalanceChanges(
  tx: SolanaTransaction,
  allWalletAddresses: Set<string>
): Result<SolanaBalanceChangeAnalysis, Error> {
  const inflows: SolanaMovement[] = [];
  const outflows: SolanaMovement[] = [];
  let fromAddress = tx.from;
  let toAddress = tx.to;

  // Collect ALL token balance changes involving the user
  if (tx.tokenChanges && tx.tokenChanges.length > 0) {
    for (const change of tx.tokenChanges) {
      const isUserAccount =
        allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));

      if (!isUserAccount) continue;

      const tokenAmountInSmallestUnits = parseFloat(change.postAmount) - parseFloat(change.preAmount);
      if (tokenAmountInSmallestUnits === 0) continue; // Skip zero changes

      // Normalize token amount using decimals metadata
      // All providers return amounts in smallest units; normalization ensures consistency and safety
      const normalizedAmountResult = normalizeTokenAmount(
        Math.abs(tokenAmountInSmallestUnits).toString(),
        change.decimals
      );
      if (normalizedAmountResult.isErr()) {
        return err(
          new Error(
            `Failed to normalize Solana token amount for account ${change.account}: ${normalizedAmountResult.error.message}. ` +
              `Raw amount: ${Math.abs(tokenAmountInSmallestUnits).toString()}, decimals: ${change.decimals}, mint: ${change.mint}`
          )
        );
      }

      const movement: SolanaMovement = {
        amount: normalizedAmountResult.value,
        asset: change.symbol || change.mint,
        decimals: change.decimals,
        tokenAddress: change.mint,
      };

      if (tokenAmountInSmallestUnits > 0) {
        inflows.push(movement);
        toAddress = change.account;
      } else {
        outflows.push(movement);
        fromAddress = change.account;
      }
    }
  }

  // Collect ALL SOL balance changes involving the user (excluding fee-only changes)
  if (tx.accountChanges && tx.accountChanges.length > 0) {
    for (const change of tx.accountChanges) {
      const isUserAccount = allWalletAddresses.has(change.account);
      if (!isUserAccount) continue;

      const solAmountInLamports = parseFloat(change.postBalance) - parseFloat(change.preBalance);
      if (solAmountInLamports === 0) continue; // Skip zero changes

      // Normalize lamports to SOL using native amount normalization (SOL has 9 decimals)
      const normalizedSolAmountResult = normalizeNativeAmount(Math.abs(solAmountInLamports).toString(), 9);
      if (normalizedSolAmountResult.isErr()) {
        return err(
          new Error(
            `Failed to normalize SOL balance change for account ${change.account}: ${normalizedSolAmountResult.error.message}. ` +
              `Raw amount: ${Math.abs(solAmountInLamports).toString()}, decimals: 9`
          )
        );
      }

      const movement = {
        amount: normalizedSolAmountResult.value,
        asset: 'SOL',
      };

      if (solAmountInLamports > 0) {
        inflows.push(movement);
        toAddress = change.account;
      } else {
        outflows.push(movement);
        fromAddress = change.account;
      }
    }
  }

  const consolidatedInflows = consolidateSolanaMovements(inflows);
  const consolidatedOutflows = consolidateSolanaMovements(outflows);

  // Determine if the user paid the transaction fee
  // User pays fee when:
  // 1. They have outflows (sent funds, swapped, staked, etc.), OR
  // 2. They initiated a transaction with no movements (contract interactions, failed txs)
  const hasInflows = consolidatedInflows.length > 0;
  const hasOutflows = consolidatedOutflows.length > 0;
  const initiatorIsUser = tx.from ? allWalletAddresses.has(tx.from) : false;
  const inferredSenderIsUser = fromAddress ? allWalletAddresses.has(fromAddress) : false;
  const feePaidByUser = hasOutflows || (!hasInflows && (initiatorIsUser || inferredSenderIsUser));

  // Fix Issue #78: Prevent double-counting of fees in SOL balance calculations
  // Solana accountChanges already include fees (net lamport deltas), so we must
  // deduct fees from SOL outflows to avoid subtracting them twice in accounting.
  // For fee-only transactions, this reduces the outflow to zero, which we track
  // via `feeAbsorbedByMovement` to avoid recording a separate fee entry later.
  let hadOutflowsBeforeFeeAdjustment = false;
  if (feePaidByUser && tx.feeAmount) {
    let remainingFee = parseDecimal(tx.feeAmount);

    if (!remainingFee.isZero()) {
      for (const movement of consolidatedOutflows) {
        if (movement.asset !== 'SOL') {
          continue;
        }

        const movementAmount = parseDecimal(movement.amount);
        if (movementAmount.isZero()) {
          continue;
        }

        hadOutflowsBeforeFeeAdjustment = true;
        if (movementAmount.lessThanOrEqualTo(remainingFee)) {
          remainingFee = remainingFee.minus(movementAmount);
          movement.amount = '0';
        } else {
          movement.amount = movementAmount.minus(remainingFee).toFixed();
          remainingFee = parseDecimal('0');
          break;
        }
      }

      // Remove zero-value SOL movements that resulted from fee deduction
      for (let index = consolidatedOutflows.length - 1; index >= 0; index--) {
        const movement = consolidatedOutflows[index];
        if (movement?.asset === 'SOL' && isZeroDecimal(movement.amount)) {
          consolidatedOutflows.splice(index, 1);
        }
      }
    }
  }

  // Select primary asset for simplified consumption and single-asset display
  // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
  let primary: SolanaMovement = {
    amount: '0',
    asset: 'SOL',
  };

  // Use largest inflow as primary (prefer tokens with more decimals)
  const largestInflow = consolidatedInflows
    .sort((a, b) => {
      try {
        return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
      } catch (error) {
        logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
        return 0;
      }
    })
    .find((inflow) => !isZeroDecimal(inflow.amount));

  if (largestInflow) {
    primary = { ...largestInflow };
  } else {
    // If no inflows, use largest outflow
    const largestOutflow = consolidatedOutflows
      .sort((a, b) => {
        try {
          return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
        } catch (error) {
          logger.warn(
            { error, itemA: a, itemB: b },
            'Failed to parse amount during sort comparison, treating as equal'
          );
          return 0;
        }
      })
      .find((outflow) => !isZeroDecimal(outflow.amount));

    if (largestOutflow) {
      primary = { ...largestOutflow };
    }
  }

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
  }

  // Track fee-only transactions where the fee was fully absorbed by movement adjustment
  // When true, prevents recording a duplicate fee entry in the transaction record
  const feeAbsorbedByMovement = hadOutflowsBeforeFeeAdjustment && consolidatedOutflows.length === 0;

  return ok({
    classificationUncertainty,
    feeAbsorbedByMovement,
    feePaidByUser,
    fromAddress,
    inflows: consolidatedInflows,
    outflows: consolidatedOutflows,
    primary,
    toAddress,
  });
}

/**
 * Analyze fund flow from normalized SolanaTransaction data
 */
export function analyzeSolanaFundFlow(
  tx: SolanaTransaction,
  sessionMetadata: Record<string, unknown>
): Result<SolanaFundFlow, string> {
  if (!sessionMetadata.address || typeof sessionMetadata.address !== 'string') {
    return err('Missing user address in session metadata');
  }

  const userAddress = sessionMetadata.address;
  const derivedAddresses = Array.isArray(sessionMetadata.derivedAddresses)
    ? sessionMetadata.derivedAddresses.filter((addr): addr is string => typeof addr === 'string')
    : [];
  const allWalletAddresses = new Set<string>([userAddress, ...derivedAddresses]);

  // Analyze instruction complexity
  const instructionCount = tx.instructions?.length || 0;
  const hasMultipleInstructions = instructionCount > 1;

  // Detect transaction types based on instructions
  const hasStaking = detectSolanaStakingInstructions(tx.instructions || []);
  const hasSwaps = detectSolanaSwapInstructions(tx.instructions || []);
  const hasTokenTransfers = detectSolanaTokenTransferInstructions(tx.instructions || []);

  // Enhanced fund flow analysis using balance changes
  const flowAnalysisResult = analyzeSolanaBalanceChanges(tx, allWalletAddresses);
  if (flowAnalysisResult.isErr()) {
    return err(flowAnalysisResult.error.message);
  }
  const flowAnalysis = flowAnalysisResult.value;

  const fundFlow: SolanaFundFlow = {
    computeUnitsUsed: tx.computeUnitsConsumed,
    feeAmount: tx.feeAmount || '0',
    feeCurrency: tx.feeCurrency || 'SOL',
    feePaidByUser: flowAnalysis.feePaidByUser,
    feeAbsorbedByMovement: flowAnalysis.feeAbsorbedByMovement,
    fromAddress: flowAnalysis.fromAddress,
    toAddress: flowAnalysis.toAddress,
    hasMultipleInstructions,
    hasStaking,
    hasSwaps,
    hasTokenTransfers,
    instructionCount,
    transactionCount: 1, // Always 1 for Solana (no correlation like EVM)

    inflows: flowAnalysis.inflows,
    outflows: flowAnalysis.outflows,
    primary: flowAnalysis.primary,

    // Classification uncertainty
    classificationUncertainty: flowAnalysis.classificationUncertainty,
  };

  return ok(fundFlow);
}
