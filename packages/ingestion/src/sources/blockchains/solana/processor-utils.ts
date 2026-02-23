import type { SolanaTransaction } from '@exitbook/blockchain-providers';
import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/blockchain-providers';
import { parseDecimal, type Currency } from '@exitbook/core';
import type { OperationClassification, TransactionNote } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { SolanaFlowAnalysis, SolanaFundFlow, SolanaMovement } from './types.js';

const logger = getLogger('solana-processor-utils');

/**
 * Program IDs for staking-related operations on Solana
 */
const STAKING_PROGRAMS: string[] = [
  // Note: System Program (11111111111111111111111111111111) is NOT included
  // because it's used for many non-staking operations (transfers, account creation, etc.)
  'Stake11111111111111111111111111111111111111', // Stake Program (native Solana staking)
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

function hasMatchingProgram(instructions: SolanaTransaction['instructions'], programIds: string[]): boolean {
  if (!instructions) return false;
  return instructions.some((instruction) => instruction.programId && programIds.includes(instruction.programId));
}

export function detectSolanaStakingInstructions(instructions: SolanaTransaction['instructions']): boolean {
  return hasMatchingProgram(instructions, STAKING_PROGRAMS);
}

export function detectSolanaSwapInstructions(instructions: SolanaTransaction['instructions']): boolean {
  return hasMatchingProgram(instructions, DEX_PROGRAMS);
}

export function detectSolanaTokenTransferInstructions(instructions: SolanaTransaction['instructions']): boolean {
  return hasMatchingProgram(instructions, TOKEN_PROGRAMS);
}

export function detectSolanaNFTInstructions(instructions: SolanaTransaction['instructions']): boolean {
  return hasMatchingProgram(instructions, NFT_PROGRAMS);
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
      assetMap.set(movement.asset, {
        amount: parseDecimal(movement.amount),
        decimals: movement.decimals,
        tokenAddress: movement.tokenAddress,
      });
    }
  }

  return Array.from(assetMap.entries()).map(([asset, data]) => ({
    amount: data.amount.toFixed(),
    asset: asset as Currency,
    decimals: data.decimals,
    tokenAddress: data.tokenAddress,
  }));
}

/**
 * Inference failure reasons that represent truly ambiguous cases (multiple candidates).
 * Expected missing-counterparty cases are excluded - those don't warrant a note.
 */
const AMBIGUOUS_INFERENCE_REASONS = new Set([
  'multiple_non_user_recipients',
  'multiple_non_user_senders',
  'multiple_user_accounts',
  'same_asset_multiple_movements',
]);

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

  const addInferenceFailureNote = (classification: OperationClassification): OperationClassification => {
    if (!fundFlow.inferenceFailureReason || !AMBIGUOUS_INFERENCE_REASONS.has(fundFlow.inferenceFailureReason)) {
      return classification;
    }

    const inferenceNote: TransactionNote = {
      message: `Could not infer transaction counterparty: ${fundFlow.inferenceFailureReason}`,
      metadata: {
        inferenceFailureReason: fundFlow.inferenceFailureReason,
        fromAddress: fundFlow.fromAddress,
        toAddress: fundFlow.toAddress,
      },
      severity: 'info',
      type: 'inference_failed',
    };

    return {
      ...classification,
      notes: classification.notes ? [...classification.notes, inferenceNote] : [inferenceNote],
    };
  };

  // Pattern 1: Staking operations (high confidence based on program detection)
  if (fundFlow.hasStaking) {
    if (outflows.length > 0 && inflows.length === 0) {
      return addInferenceFailureNote({
        operation: {
          category: 'staking',
          type: 'stake',
        },
      });
    }

    if (inflows.length > 0 && outflows.length === 0) {
      // Check if reward or withdrawal based on amount
      const isReward = primaryAmount.greaterThan(0) && primaryAmount.lessThan(1); // Rewards are typically small
      return addInferenceFailureNote({
        operation: {
          category: 'staking',
          type: isReward ? 'reward' : 'unstake',
        },
      });
    }

    // Complex staking with both inflows and outflows
    return addInferenceFailureNote({
      notes: [
        {
          message: 'Complex staking operation with both inflows and outflows. Manual review recommended.',
          metadata: {
            hasStaking: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
      ],
      operation: {
        category: 'staking',
        type: 'stake',
      },
    });
  }

  // Pattern 2: Fee-only transaction (no movements)
  if (isZero && inflows.length === 0 && outflows.length === 0) {
    return addInferenceFailureNote({
      operation: {
        category: 'fee',
        type: 'fee',
      },
    });
  }

  // Pattern 3: Single one-in one-out - swap or self-transfer based on asset identity
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset !== inAsset) {
      return addInferenceFailureNote({
        operation: {
          category: 'trade',
          type: 'swap',
        },
      });
    }

    // Same asset in and out - self-transfer
    return addInferenceFailureNote({
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    });
  }

  // Pattern 4: DEX swap detected by program (less confident than single-asset swap)
  if (fundFlow.hasSwaps) {
    return addInferenceFailureNote({
      notes: [
        {
          message: 'DEX program detected. Classified as swap based on program analysis.',
          metadata: {
            hasSwaps: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'program_based_classification',
        },
      ],
      operation: {
        category: 'trade',
        type: 'swap',
      },
    });
  }

  // Pattern 5: Simple deposit (only inflows)
  if (outflows.length === 0 && inflows.length >= 1) {
    return addInferenceFailureNote({
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    });
  }

  // Pattern 6: Simple withdrawal (only outflows)
  if (outflows.length >= 1 && inflows.length === 0) {
    return addInferenceFailureNote({
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    });
  }

  // Pattern 8: Complex multi-asset transaction (UNCERTAIN - add note)
  if (fundFlow.classificationUncertainty) {
    return addInferenceFailureNote({
      notes: [
        {
          message: fundFlow.classificationUncertainty,
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          type: 'classification_uncertain',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    });
  }

  // Pattern 9: Batch operations (multiple instructions)
  if (fundFlow.hasMultipleInstructions && fundFlow.instructionCount > 3) {
    return addInferenceFailureNote({
      notes: [
        {
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
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    });
  }

  // Ultimate fallback: Couldn't match any confident pattern
  return addInferenceFailureNote({
    notes: [
      {
        message: 'Unable to determine transaction classification using confident patterns.',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        type: 'classification_failed',
      },
    ],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  });
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
 * Find the largest non-zero movement by amount, or undefined if none found.
 */
function findLargestMovement(movements: SolanaMovement[]): SolanaMovement | undefined {
  return movements
    .slice()
    .sort((a, b) => {
      try {
        return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
      } catch (error) {
        logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
        return 0;
      }
    })
    .find((movement) => !isZeroDecimal(movement.amount));
}

/**
 * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
 */
export function analyzeSolanaBalanceChanges(
  tx: SolanaTransaction,
  allWalletAddresses: Set<string>
): Result<SolanaFlowAnalysis, Error> {
  const inflows: SolanaMovement[] = [];
  const outflows: SolanaMovement[] = [];

  // Collect ALL token balance changes involving the user
  if (tx.tokenChanges && tx.tokenChanges.length > 0) {
    for (const change of tx.tokenChanges) {
      const isUserAccount =
        allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));

      if (!isUserAccount) continue;

      // Use Decimal for token amounts (arbitrary precision for token balances)
      const preAmount = parseDecimal(change.preAmount);
      const postAmount = parseDecimal(change.postAmount);
      const tokenDelta = postAmount.minus(preAmount);

      if (tokenDelta.isZero()) continue; // Skip zero changes

      // Normalize token amount using decimals metadata
      // All providers return amounts in smallest units; normalization ensures consistency and safety
      const normalizedAmountResult = normalizeTokenAmount(tokenDelta.abs().toFixed(), change.decimals);
      if (normalizedAmountResult.isErr()) {
        return err(
          new Error(
            `Failed to normalize Solana token amount for account ${change.account}: ${normalizedAmountResult.error.message}. ` +
              `Raw amount: ${tokenDelta.abs().toFixed()}, decimals: ${change.decimals}, mint: ${change.mint}`
          )
        );
      }

      const movement: SolanaMovement = {
        amount: normalizedAmountResult.value,
        asset: (change.symbol || change.mint) as Currency,
        decimals: change.decimals,
        tokenAddress: change.mint,
      };

      if (tokenDelta.isPositive()) {
        inflows.push(movement);
      } else {
        outflows.push(movement);
      }
    }
  }

  // Collect ALL SOL balance changes involving the user (excluding fee-only changes)
  if (tx.accountChanges && tx.accountChanges.length > 0) {
    for (const change of tx.accountChanges) {
      const isUserAccount = allWalletAddresses.has(change.account);
      if (!isUserAccount) continue;

      // Use BigInt for lamports (SOL native units) for precision
      const preLamports = BigInt(change.preBalance);
      const postLamports = BigInt(change.postBalance);
      const solDeltaLamports = postLamports - preLamports;

      if (solDeltaLamports === 0n) continue; // Skip zero changes

      // Normalize lamports to SOL using native amount normalization (SOL has 9 decimals)
      const absLamports = solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports;
      const normalizedSolAmountResult = normalizeNativeAmount(absLamports.toString(), 9);
      if (normalizedSolAmountResult.isErr()) {
        return err(
          new Error(
            `Failed to normalize SOL balance change for account ${change.account}: ${normalizedSolAmountResult.error.message}. ` +
              `Raw amount: ${absLamports.toString()}, decimals: 9`
          )
        );
      }

      const movement = {
        amount: normalizedSolAmountResult.value,
        asset: 'SOL' as Currency,
      };

      if (solDeltaLamports > 0n) {
        inflows.push(movement);
      } else {
        outflows.push(movement);
      }
    }
  }

  const consolidatedInflows = consolidateSolanaMovements(inflows);
  const consolidatedOutflows = consolidateSolanaMovements(outflows);

  // Infer from/to by analyzing ALL account changes (not just user changes)
  // Only populate when there's a clear, unambiguous counterparty
  let fromAddress: string | undefined;
  let toAddress: string | undefined;
  let inferenceFailureReason: string | undefined;

  // Build net deltas per asset for ALL accounts (user and non-user)
  // This allows us to detect swaps and multi-asset transactions properly
  const hasInflows = consolidatedInflows.length > 0;
  const hasOutflows = consolidatedOutflows.length > 0;

  // Gate 1: Only infer when user has movement in exactly ONE asset
  // Use tokenAddress (mint) for identity to avoid symbol collisions (e.g., multiple USDC mints)
  const userAssets = new Set<string>();
  for (const inflow of consolidatedInflows) {
    userAssets.add(inflow.tokenAddress || inflow.asset);
  }
  for (const outflow of consolidatedOutflows) {
    userAssets.add(outflow.tokenAddress || outflow.asset);
  }

  if (userAssets.size === 1) {
    const primaryAsset = Array.from(userAssets)[0];
    if (!primaryAsset) {
      inferenceFailureReason = 'no_primary_asset';
    } else if (consolidatedInflows.length <= 1 && consolidatedOutflows.length <= 1) {
      // Gate 2: Only infer for simple single-asset transfers (not swaps)
      if (primaryAsset === 'SOL' && tx.accountChanges) {
        // Analyze SOL balance changes using BigInt (lamports) for precision
        const userParticipantAccounts: string[] = [];
        const counterpartySenders: { account: string; deltaLamports: bigint }[] = [];
        const counterpartyRecipients: { account: string; deltaLamports: bigint }[] = [];

        for (const change of tx.accountChanges) {
          const preLamports = BigInt(change.preBalance);
          const postLamports = BigInt(change.postBalance);
          const deltaLamports = postLamports - preLamports;

          if (deltaLamports === 0n) continue;

          const isUser = allWalletAddresses.has(change.account);
          if (isUser) {
            userParticipantAccounts.push(change.account);
          } else if (deltaLamports < 0n) {
            counterpartySenders.push({ account: change.account, deltaLamports });
          } else if (deltaLamports > 0n) {
            counterpartyRecipients.push({ account: change.account, deltaLamports });
          }
        }

        // Only set from/to if there's exactly one counterparty AND exactly one user account
        if (userParticipantAccounts.length === 0) {
          inferenceFailureReason = 'no_user_accounts_with_delta';
        } else if (userParticipantAccounts.length > 1) {
          inferenceFailureReason = 'multiple_user_accounts';
        } else if (hasOutflows && counterpartyRecipients.length === 0) {
          inferenceFailureReason = 'missing_counterparty_delta';
        } else if (hasOutflows && counterpartyRecipients.length > 1) {
          inferenceFailureReason = 'multiple_non_user_recipients';
        } else if (hasInflows && counterpartySenders.length === 0) {
          inferenceFailureReason = 'missing_counterparty_delta';
        } else if (hasInflows && counterpartySenders.length > 1) {
          inferenceFailureReason = 'multiple_non_user_senders';
        } else if (hasOutflows && counterpartyRecipients.length === 1) {
          fromAddress = userParticipantAccounts[0]; // User sent
          toAddress = counterpartyRecipients[0]?.account;
        } else if (hasInflows && counterpartySenders.length === 1) {
          fromAddress = counterpartySenders[0]?.account;
          toAddress = userParticipantAccounts[0]; // User received
        }
      } else if (primaryAsset && tx.tokenChanges) {
        // Analyze token changes using Decimal for precision
        // primaryAsset holds the mint address (tokenAddress) for SPL tokens

        // Aggregate deltas by owner account to handle multiple token accounts per user
        const userAccountDeltas = new Map<string, Decimal>();
        const nonUserSenderDeltas = new Map<string, Decimal>();
        const nonUserRecipientDeltas = new Map<string, Decimal>();

        for (const change of tx.tokenChanges) {
          if (change.mint !== primaryAsset) continue; // Only analyze the primary token

          const preAmount = parseDecimal(change.preAmount);
          const postAmount = parseDecimal(change.postAmount);
          const delta = postAmount.minus(preAmount);

          if (delta.isZero()) continue;

          const ownerAccount = change.owner || change.account;
          const isUser = allWalletAddresses.has(ownerAccount);

          if (isUser) {
            const existing = userAccountDeltas.get(ownerAccount) || parseDecimal('0');
            userAccountDeltas.set(ownerAccount, existing.plus(delta));
          } else if (delta.isNegative()) {
            const existing = nonUserSenderDeltas.get(ownerAccount) || parseDecimal('0');
            nonUserSenderDeltas.set(ownerAccount, existing.plus(delta));
          } else if (delta.isPositive()) {
            const existing = nonUserRecipientDeltas.get(ownerAccount) || parseDecimal('0');
            nonUserRecipientDeltas.set(ownerAccount, existing.plus(delta));
          }
        }

        // Only set from/to if there's exactly one counterparty AND exactly one user account
        if (userAccountDeltas.size === 0) {
          inferenceFailureReason = 'no_user_accounts_with_delta';
        } else if (userAccountDeltas.size > 1) {
          inferenceFailureReason = 'multiple_user_accounts';
        } else if (hasOutflows && nonUserRecipientDeltas.size === 0) {
          inferenceFailureReason = 'missing_counterparty_delta';
        } else if (hasOutflows && nonUserRecipientDeltas.size > 1) {
          inferenceFailureReason = 'multiple_non_user_recipients';
        } else if (hasInflows && nonUserSenderDeltas.size === 0) {
          inferenceFailureReason = 'missing_counterparty_delta';
        } else if (hasInflows && nonUserSenderDeltas.size > 1) {
          inferenceFailureReason = 'multiple_non_user_senders';
        } else if (hasOutflows && nonUserRecipientDeltas.size === 1) {
          const userAccount = Array.from(userAccountDeltas.keys())[0];
          const recipientAccount = Array.from(nonUserRecipientDeltas.keys())[0];
          fromAddress = userAccount; // User sent
          toAddress = recipientAccount;
        } else if (hasInflows && nonUserSenderDeltas.size === 1) {
          const userAccount = Array.from(userAccountDeltas.keys())[0];
          const senderAccount = Array.from(nonUserSenderDeltas.keys())[0];
          fromAddress = senderAccount;
          toAddress = userAccount; // User received
        }
      }
    } else {
      // Multiple inflows or outflows for the same asset - likely a complex transaction
      inferenceFailureReason = 'same_asset_multiple_movements';
    }
  } else if (userAssets.size > 1) {
    // User has movements in multiple assets - this is a swap or complex DeFi operation
    inferenceFailureReason = 'multi_asset_user_delta';
  }

  // Determine if the user paid the transaction fee
  // User pays fee when:
  // 1. They have outflows (sent funds, swapped, staked, etc.), OR
  // 2. They initiated a transaction with no movements (contract interactions, failed txs)
  // Note: Use explicit feePayer field from mapper, fallback to legacy 'from' field for backward compatibility
  const feePayer = tx.feePayer;
  const feePayerIsUser = feePayer ? allWalletAddresses.has(feePayer) : false;
  const inferredSenderIsUser = fromAddress ? allWalletAddresses.has(fromAddress) : false;
  const feePaidByUser = hasOutflows || (!hasInflows && (feePayerIsUser || inferredSenderIsUser));

  // Warn if fee payer is ambiguous
  if (!hasInflows && !hasOutflows && !feePayer) {
    logger.warn(
      { txId: tx.id, provider: tx.providerName },
      'Fee payer detection: no movements and no explicit feePayer field - fee attribution may be incorrect'
    );
  }

  // Warn on inference failures
  if (inferenceFailureReason) {
    logger.warn(
      {
        inferenceFailureReason,
        provider: tx.providerName,
        txId: tx.id,
        userAssets: Array.from(userAssets),
      },
      `Cannot infer from/to counterparty: ${inferenceFailureReason}`
    );
  }

  // Prevent double-counting of fees in SOL balance calculations.
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

  // Handle fee-only transactions after fee deduction
  // If outflows became empty after fee deduction, this was a fee-only transaction
  if (consolidatedOutflows.length === 0 && consolidatedInflows.length === 0 && !fromAddress && !toAddress) {
    // Set from = to = fee payer address for fee-only transactions
    if (tx.accountChanges && tx.accountChanges.length > 0) {
      for (const change of tx.accountChanges) {
        const isUser = allWalletAddresses.has(change.account);
        const preLamports = BigInt(change.preBalance);
        const postLamports = BigInt(change.postBalance);
        const deltaLamports = postLamports - preLamports;
        if (isUser && deltaLamports < 0n) {
          fromAddress = change.account;
          toAddress = change.account;
          break;
        }
      }
    }
  }

  // Select primary asset: largest inflow, or largest outflow if no inflows.
  // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions.
  const primaryFallback: SolanaMovement = { amount: '0', asset: 'SOL' as Currency };
  const primary =
    findLargestMovement(consolidatedInflows) ?? findLargestMovement(consolidatedOutflows) ?? primaryFallback;

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
    inferenceFailureReason,
    inflows: consolidatedInflows,
    outflows: consolidatedOutflows,
    primary,
    toAddress,
  });
}

/**
 * Analyze fund flow from normalized SolanaTransaction data
 */
export function analyzeSolanaFundFlow(tx: SolanaTransaction, context: AddressContext): Result<SolanaFundFlow, string> {
  // Use all user addresses for multi-address fund-flow analysis
  const allWalletAddresses = new Set<string>(context.userAddresses);

  // Analyze instruction complexity
  const instructionCount = tx.instructions?.length || 0;
  const hasMultipleInstructions = instructionCount > 1;

  // Detect transaction types based on instructions
  const hasStaking = detectSolanaStakingInstructions(tx.instructions);
  const hasSwaps = detectSolanaSwapInstructions(tx.instructions);
  const hasTokenTransfers = detectSolanaTokenTransferInstructions(tx.instructions);

  // Enhanced fund flow analysis using balance changes
  const flowAnalysisResult = analyzeSolanaBalanceChanges(tx, allWalletAddresses);
  if (flowAnalysisResult.isErr()) {
    return err(flowAnalysisResult.error.message);
  }
  const flowAnalysis = flowAnalysisResult.value;

  const fundFlow: SolanaFundFlow = {
    computeUnitsUsed: tx.computeUnitsConsumed,
    feeAmount: tx.feeAmount || '0',
    feeCurrency: (tx.feeCurrency || 'SOL') as Currency,
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
    inferenceFailureReason: flowAnalysis.inferenceFailureReason,
  };

  return ok(fundFlow);
}
