import { type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import type { MovementRole, OperationClassification, TransactionDiagnostic } from '@exitbook/core';
import { fromBaseUnitsToDecimalString, isZeroDecimal, parseDecimal, type Currency } from '@exitbook/foundation';
import { type Result, err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { AddressContext } from '../../../shared/types/processors.js';
import { collapseReturnedInputAssetSwapRefund } from '../shared/account-based-swap-refund-utils.js';

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

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAX_UNSOLICITED_SOL_DUST_AMOUNT = parseDecimal('0.00001');
const MIN_DUST_FANOUT_SYSTEM_INSTRUCTIONS = 10;
const MIN_DUST_FANOUT_ACCOUNT_CHANGES = 10;

interface SolanaMovementAccumulator {
  amount: Decimal;
  decimals?: number | undefined;
  movementRole?: MovementRole | undefined;
  tokenAddress?: string | undefined;
}

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

function detectSolanaRewardDistribution(logMessages: readonly string[] | undefined): boolean {
  if (!logMessages || logMessages.length === 0) {
    return false;
  }

  const normalizedMessages = logMessages.map((message) => message.toLowerCase());
  const hasRewardInstruction = normalizedMessages.some((message) =>
    message.includes('instruction: distributeupgraderewardsv1')
  );
  if (!hasRewardInstruction) {
    return false;
  }

  return normalizedMessages.some((message) => message.includes('claiming') && message.includes('upgrade rewards'));
}

function detectSolanaBridgeReceipt(logMessages: readonly string[] | undefined): boolean {
  if (!logMessages || logMessages.length === 0) {
    return false;
  }

  return logMessages.some((message) => message.toLowerCase().includes('instruction: receiverenderv2'));
}

/**
 * Identify unsolicited SOL dust sprays that do not represent a user-initiated transaction.
 *
 * These rows show up as tiny native SOL deposits where:
 * - the fee was paid externally,
 * - there are no token changes,
 * - instructions are only system transfers / compute budget,
 * - and the transaction fans out to many recipients in one batch.
 *
 * We drop these during processing so they never become link gaps or accounting inputs.
 */
export function isSolanaUnsolicitedDustFanout(tx: SolanaTransaction, fundFlow: SolanaFundFlow): boolean {
  if (tx.status !== 'success') {
    return false;
  }

  if (fundFlow.feePaidByUser || fundFlow.outflows.length > 0 || fundFlow.inflows.length !== 1) {
    return false;
  }

  if ((tx.tokenChanges?.length ?? 0) > 0 || fundFlow.hasStaking || fundFlow.hasSwaps || fundFlow.hasTokenTransfers) {
    return false;
  }

  const inflow = fundFlow.inflows[0];
  if (!inflow || inflow.asset !== 'SOL' || inflow.tokenAddress !== undefined) {
    return false;
  }

  if (parseDecimal(inflow.amount).greaterThan(MAX_UNSOLICITED_SOL_DUST_AMOUNT)) {
    return false;
  }

  const programIds = (tx.instructions ?? []).flatMap((instruction) =>
    instruction.programId ? [instruction.programId] : []
  );
  if (programIds.length === 0) {
    return false;
  }

  const containsOnlySystemPrograms = programIds.every(
    (programId) => programId === SYSTEM_PROGRAM_ID || programId === COMPUTE_BUDGET_PROGRAM_ID
  );
  if (!containsOnlySystemPrograms) {
    return false;
  }

  const systemInstructionCount = programIds.filter((programId) => programId === SYSTEM_PROGRAM_ID).length;
  const accountChangeCount = tx.accountChanges?.length ?? 0;

  return (
    systemInstructionCount >= MIN_DUST_FANOUT_SYSTEM_INSTRUCTIONS ||
    accountChangeCount >= MIN_DUST_FANOUT_ACCOUNT_CHANGES
  );
}

/**
 * Consolidate duplicate assets by summing amounts for the same asset
 */
export function consolidateSolanaMovements(movements: SolanaMovement[]): SolanaMovement[] {
  const assetMap = new Map<string, Map<MovementRole, SolanaMovementAccumulator>>();

  for (const movement of movements) {
    const movementRole = movement.movementRole ?? 'principal';
    const roleMap = assetMap.get(movement.asset) ?? new Map<MovementRole, SolanaMovementAccumulator>();
    const existing = roleMap.get(movementRole);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      roleMap.set(movementRole, {
        amount: parseDecimal(movement.amount),
        decimals: movement.decimals,
        movementRole: movement.movementRole,
        tokenAddress: movement.tokenAddress,
      });
    }

    if (!assetMap.has(movement.asset)) {
      assetMap.set(movement.asset, roleMap);
    }
  }

  return Array.from(assetMap.entries()).flatMap(([asset, roleMap]) =>
    Array.from(roleMap.values()).map((data) => ({
      amount: data.amount.toFixed(),
      asset: asset as Currency,
      decimals: data.decimals,
      movementRole: data.movementRole,
      tokenAddress: data.tokenAddress,
    }))
  );
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

    const inferenceNote: TransactionDiagnostic = {
      message: `Could not infer transaction counterparty: ${fundFlow.inferenceFailureReason}`,
      metadata: {
        inferenceFailureReason: fundFlow.inferenceFailureReason,
        fromAddress: fundFlow.fromAddress,
        toAddress: fundFlow.toAddress,
      },
      severity: 'info',
      code: 'inference_failed',
    };

    return {
      ...classification,
      diagnostics: classification.diagnostics ? [...classification.diagnostics, inferenceNote] : [inferenceNote],
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
      diagnostics: [
        {
          message: 'Complex staking operation with both inflows and outflows. Manual review recommended.',
          metadata: {
            hasStaking: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          code: 'classification_uncertain',
        },
      ],
      operation: {
        category: 'staking',
        type: 'stake',
      },
    });
  }

  if (fundFlow.hasRewardDistribution && inflows.length > 0 && outflows.length === 0) {
    return addInferenceFailureNote({
      diagnostics: [
        {
          message: 'Provider log messages indicate a reward distribution payout.',
          metadata: {
            detectionSource: 'log_messages',
            inflows: inflows.map((inflow) => ({ amount: inflow.amount, asset: inflow.asset })),
          },
          severity: 'info',
          code: 'reward_distribution',
        },
      ],
      operation: {
        category: 'defi',
        type: 'reward',
      },
    });
  }

  if (fundFlow.hasBridgeTransfer && inflows.length > 0 && outflows.length === 0) {
    return addInferenceFailureNote({
      diagnostics: [
        {
          message: 'Provider log messages indicate a bridge or migration receipt.',
          metadata: {
            detectionSource: 'log_messages',
            inflows: inflows.map((inflow) => ({ amount: inflow.amount, asset: inflow.asset })),
          },
          severity: 'info',
          code: 'bridge_transfer',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'deposit',
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
      diagnostics: [
        {
          message: 'DEX program detected. Classified as swap based on program analysis.',
          metadata: {
            hasSwaps: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          code: 'program_based_classification',
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

  // Pattern 8: Complex multi-asset transaction (UNCERTAIN - add diagnostic)
  if (fundFlow.classificationUncertainty) {
    return addInferenceFailureNote({
      diagnostics: [
        {
          message: fundFlow.classificationUncertainty,
          metadata: {
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          code: 'classification_uncertain',
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
      diagnostics: [
        {
          message: `Batch transaction with ${fundFlow.instructionCount} instructions. May contain multiple operations.`,
          metadata: {
            hasMultipleInstructions: true,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            instructionCount: fundFlow.instructionCount,
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'info',
          code: 'batch_operation',
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
    diagnostics: [
      {
        message: 'Unable to determine transaction classification using confident patterns.',
        metadata: {
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        code: 'classification_failed',
      },
    ],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  });
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

interface SolanaMovementCollection {
  inflows: SolanaMovement[];
  outflows: SolanaMovement[];
}

interface CounterpartyInferenceResult {
  fromAddress?: string | undefined;
  inferenceFailureReason?: string | undefined;
  toAddress?: string | undefined;
}

function collectUserTokenMovements(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>
): Result<SolanaMovementCollection, Error> {
  const inflows: SolanaMovement[] = [];
  const outflows: SolanaMovement[] = [];

  for (const change of tx.tokenChanges ?? []) {
    const isUserAccount =
      allWalletAddresses.has(change.account) || (change.owner && allWalletAddresses.has(change.owner));
    if (!isUserAccount) {
      continue;
    }

    const preAmount = parseDecimal(change.preAmount);
    const postAmount = parseDecimal(change.postAmount);
    const tokenDelta = postAmount.minus(preAmount);
    if (tokenDelta.isZero()) {
      continue;
    }

    const normalizedAmountResult = fromBaseUnitsToDecimalString(tokenDelta.abs().toFixed(), change.decimals);
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

  return ok({ inflows, outflows });
}

function collectUserSolMovements(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>
): Result<SolanaMovementCollection, Error> {
  const inflows: SolanaMovement[] = [];
  const outflows: SolanaMovement[] = [];

  for (const change of tx.accountChanges ?? []) {
    if (!allWalletAddresses.has(change.account)) {
      continue;
    }

    const preLamports = BigInt(change.preBalance);
    const postLamports = BigInt(change.postBalance);
    const solDeltaLamports = postLamports - preLamports;
    if (solDeltaLamports === 0n) {
      continue;
    }

    const absLamports = solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports;
    const normalizedSolAmountResult = fromBaseUnitsToDecimalString(absLamports.toString(), 9);
    if (normalizedSolAmountResult.isErr()) {
      return err(
        new Error(
          `Failed to normalize SOL balance change for account ${change.account}: ${normalizedSolAmountResult.error.message}. ` +
            `Raw amount: ${absLamports.toString()}, decimals: 9`
        )
      );
    }

    const movement: SolanaMovement = {
      amount: normalizedSolAmountResult.value,
      asset: 'SOL' as Currency,
    };

    if (solDeltaLamports > 0n) {
      inflows.push(movement);
    } else {
      outflows.push(movement);
    }
  }

  return ok({ inflows, outflows });
}

function sumAssociatedTokenAccountCreationLamports(tx: SolanaTransaction): bigint {
  const hasAssociatedTokenInstruction =
    tx.instructions?.some((instruction) => instruction.programId === ASSOCIATED_TOKEN_PROGRAM_ID) ?? false;

  if (!hasAssociatedTokenInstruction) {
    return 0n;
  }

  let totalLamports = 0n;

  for (const change of tx.accountChanges ?? []) {
    const preLamports = BigInt(change.preBalance);
    const postLamports = BigInt(change.postBalance);

    if (preLamports !== 0n || postLamports <= 0n) {
      continue;
    }

    totalLamports += postLamports;
  }

  return totalLamports;
}

function assignAssociatedTokenAccountProtocolOverhead(
  tx: SolanaTransaction,
  outflows: SolanaMovement[]
): Result<void, Error> {
  const createdLamports = sumAssociatedTokenAccountCreationLamports(tx);
  if (createdLamports === 0n) {
    return ok(undefined);
  }

  const associatedTokenRentAmountResult = fromBaseUnitsToDecimalString(createdLamports.toString(), 9);
  if (associatedTokenRentAmountResult.isErr()) {
    return err(
      new Error(
        `Failed to normalize associated token account creation amount for transaction ${tx.id}: ${associatedTokenRentAmountResult.error.message}`
      )
    );
  }

  const associatedTokenRentAmount = parseDecimal(associatedTokenRentAmountResult.value);
  const solOutflows = outflows.filter((movement) => movement.asset === 'SOL' && movement.tokenAddress === undefined);
  if (solOutflows.length !== 1) {
    return ok(undefined);
  }

  const [solOutflow] = solOutflows;
  if (!solOutflow) {
    return ok(undefined);
  }

  if (!parseDecimal(solOutflow.amount).equals(associatedTokenRentAmount)) {
    return ok(undefined);
  }

  solOutflow.movementRole = 'protocol_overhead';
  return ok(undefined);
}

function collectUserSolanaMovements(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>
): Result<SolanaMovementCollection, Error> {
  const tokenMovementsResult = collectUserTokenMovements(tx, allWalletAddresses);
  if (tokenMovementsResult.isErr()) {
    return err(tokenMovementsResult.error);
  }

  const solMovementsResult = collectUserSolMovements(tx, allWalletAddresses);
  if (solMovementsResult.isErr()) {
    return err(solMovementsResult.error);
  }

  return ok({
    inflows: [...tokenMovementsResult.value.inflows, ...solMovementsResult.value.inflows],
    outflows: [...tokenMovementsResult.value.outflows, ...solMovementsResult.value.outflows],
  });
}

function buildUserAssetSet(inflows: readonly SolanaMovement[], outflows: readonly SolanaMovement[]): Set<string> {
  const userAssets = new Set<string>();
  for (const inflow of inflows) {
    userAssets.add(getSolanaMovementAssetKey(inflow));
  }
  for (const outflow of outflows) {
    userAssets.add(getSolanaMovementAssetKey(outflow));
  }
  return userAssets;
}

function getSolanaMovementAssetKey(movement: SolanaMovement): string {
  return movement.tokenAddress || movement.asset;
}

function filterSolanaMovementsByAsset(
  movements: readonly SolanaMovement[],
  assetKey: string
): readonly SolanaMovement[] {
  return movements.filter((movement) => getSolanaMovementAssetKey(movement) === assetKey);
}

function inferCounterpartyAddressesFromCandidates(params: {
  hasInflows: boolean;
  hasOutflows: boolean;
  nonUserRecipients: ReadonlySet<string>;
  nonUserSenders: ReadonlySet<string>;
  userAccounts: ReadonlySet<string>;
}): CounterpartyInferenceResult {
  if (params.userAccounts.size === 0) {
    return { inferenceFailureReason: 'no_user_accounts_with_delta' };
  }
  if (params.userAccounts.size > 1) {
    return { inferenceFailureReason: 'multiple_user_accounts' };
  }
  if (params.hasOutflows && params.nonUserRecipients.size === 0) {
    return { inferenceFailureReason: 'missing_counterparty_delta' };
  }
  if (params.hasOutflows && params.nonUserRecipients.size > 1) {
    return { inferenceFailureReason: 'multiple_non_user_recipients' };
  }
  if (params.hasInflows && params.nonUserSenders.size === 0) {
    return { inferenceFailureReason: 'missing_counterparty_delta' };
  }
  if (params.hasInflows && params.nonUserSenders.size > 1) {
    return { inferenceFailureReason: 'multiple_non_user_senders' };
  }

  const userAccount = Array.from(params.userAccounts)[0];
  if (!userAccount) {
    return { inferenceFailureReason: 'no_user_accounts_with_delta' };
  }

  if (params.hasOutflows) {
    return {
      fromAddress: userAccount,
      toAddress: Array.from(params.nonUserRecipients)[0],
    };
  }

  if (params.hasInflows) {
    return {
      fromAddress: Array.from(params.nonUserSenders)[0],
      toAddress: userAccount,
    };
  }

  return {};
}

function inferSolCounterpartyAddresses(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>,
  hasInflows: boolean,
  hasOutflows: boolean
): CounterpartyInferenceResult {
  const userAccounts = new Set<string>();
  const nonUserSenders = new Set<string>();
  const nonUserRecipients = new Set<string>();

  for (const change of tx.accountChanges ?? []) {
    const deltaLamports = BigInt(change.postBalance) - BigInt(change.preBalance);
    if (deltaLamports === 0n) {
      continue;
    }

    if (allWalletAddresses.has(change.account)) {
      userAccounts.add(change.account);
    } else if (deltaLamports < 0n) {
      nonUserSenders.add(change.account);
    } else {
      nonUserRecipients.add(change.account);
    }
  }

  return inferCounterpartyAddressesFromCandidates({
    hasInflows,
    hasOutflows,
    nonUserRecipients,
    nonUserSenders,
    userAccounts,
  });
}

function inferTokenCounterpartyAddresses(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>,
  primaryAsset: string,
  hasInflows: boolean,
  hasOutflows: boolean
): CounterpartyInferenceResult {
  const userAccounts = new Set<string>();
  const nonUserSenders = new Set<string>();
  const nonUserRecipients = new Set<string>();

  for (const change of tx.tokenChanges ?? []) {
    if (change.mint !== primaryAsset) {
      continue;
    }

    const delta = parseDecimal(change.postAmount).minus(parseDecimal(change.preAmount));
    if (delta.isZero()) {
      continue;
    }

    const ownerAccount = change.owner || change.account;
    if (allWalletAddresses.has(ownerAccount)) {
      userAccounts.add(ownerAccount);
    } else if (delta.isNegative()) {
      nonUserSenders.add(ownerAccount);
    } else {
      nonUserRecipients.add(ownerAccount);
    }
  }

  return inferCounterpartyAddressesFromCandidates({
    hasInflows,
    hasOutflows,
    nonUserRecipients,
    nonUserSenders,
    userAccounts,
  });
}

function inferCounterpartyAddresses(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>,
  inflows: readonly SolanaMovement[],
  outflows: readonly SolanaMovement[]
): CounterpartyInferenceResult {
  const hasInflows = inflows.length > 0;
  const hasOutflows = outflows.length > 0;
  const userAssets = buildUserAssetSet(inflows, outflows);

  if (userAssets.size === 1) {
    const primaryAsset = Array.from(userAssets)[0];
    if (!primaryAsset) {
      return { inferenceFailureReason: 'no_primary_asset' };
    }

    if (inflows.length > 1 || outflows.length > 1) {
      return { inferenceFailureReason: 'same_asset_multiple_movements' };
    }

    return primaryAsset === 'SOL'
      ? inferSolCounterpartyAddresses(tx, allWalletAddresses, hasInflows, hasOutflows)
      : inferTokenCounterpartyAddresses(tx, allWalletAddresses, primaryAsset, hasInflows, hasOutflows);
  }

  const nonSolAssets = Array.from(userAssets).filter((asset) => asset !== 'SOL');
  if (userAssets.size === 2 && userAssets.has('SOL') && nonSolAssets.length === 1) {
    const tokenAsset = nonSolAssets[0]!;
    const tokenInflows = filterSolanaMovementsByAsset(inflows, tokenAsset);
    const tokenOutflows = filterSolanaMovementsByAsset(outflows, tokenAsset);

    if (
      tokenInflows.length <= 1 &&
      tokenOutflows.length <= 1 &&
      (tokenInflows.length > 0 || tokenOutflows.length > 0)
    ) {
      return inferTokenCounterpartyAddresses(
        tx,
        allWalletAddresses,
        tokenAsset,
        tokenInflows.length > 0,
        tokenOutflows.length > 0
      );
    }
  }

  if (userAssets.size > 1) {
    return { inferenceFailureReason: 'multi_asset_user_delta' };
  }

  return {};
}

function determineFeePaidByUser(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>,
  inflows: readonly SolanaMovement[],
  outflows: readonly SolanaMovement[],
  fromAddress: string | undefined
): boolean {
  const feePayerIsUser = tx.feePayer ? allWalletAddresses.has(tx.feePayer) : false;
  const inferredSenderIsUser = fromAddress ? allWalletAddresses.has(fromAddress) : false;
  return outflows.length > 0 || (inflows.length === 0 && (feePayerIsUser || inferredSenderIsUser));
}

function warnOnAmbiguousFeePayer(
  tx: SolanaTransaction,
  inflows: readonly SolanaMovement[],
  outflows: readonly SolanaMovement[]
): void {
  if (inflows.length === 0 && outflows.length === 0 && !tx.feePayer) {
    logger.warn(
      { txId: tx.id, provider: tx.providerName },
      'Fee payer detection: no movements and no explicit feePayer field - fee attribution may be incorrect'
    );
  }
}

function warnOnCounterpartyInferenceFailure(
  tx: SolanaTransaction,
  userAssets: ReadonlySet<string>,
  inferenceFailureReason: string | undefined
): void {
  if (!inferenceFailureReason) {
    return;
  }

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

function absorbFeeFromSolOutflows(outflows: SolanaMovement[], feeAmount: string | undefined): boolean {
  if (feeAmount === undefined) {
    return false;
  }

  let remainingFee = parseDecimal(feeAmount);
  let hadOutflowsBeforeFeeAdjustment = false;
  if (remainingFee.isZero()) {
    return false;
  }

  for (const movement of outflows) {
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
      break;
    }
  }

  for (let index = outflows.length - 1; index >= 0; index--) {
    const movement = outflows[index];
    if (movement?.asset === 'SOL' && isZeroDecimal(movement.amount)) {
      outflows.splice(index, 1);
    }
  }

  return hadOutflowsBeforeFeeAdjustment && outflows.length === 0;
}

function inferFeeOnlySelfTransfer(
  tx: SolanaTransaction,
  allWalletAddresses: ReadonlySet<string>
): Pick<CounterpartyInferenceResult, 'fromAddress' | 'toAddress'> {
  for (const change of tx.accountChanges ?? []) {
    const deltaLamports = BigInt(change.postBalance) - BigInt(change.preBalance);
    if (allWalletAddresses.has(change.account) && deltaLamports < 0n) {
      return {
        fromAddress: change.account,
        toAddress: change.account,
      };
    }
  }

  return {};
}

function buildClassificationUncertainty(
  inflows: readonly SolanaMovement[],
  outflows: readonly SolanaMovement[]
): string | undefined {
  if (inflows.length <= 1 && outflows.length <= 1) {
    return undefined;
  }

  return `Complex transaction with ${outflows.length} outflow(s) and ${inflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
}

/**
 * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
 */
export function analyzeSolanaBalanceChanges(
  tx: SolanaTransaction,
  allWalletAddresses: Set<string>
): Result<SolanaFlowAnalysis, Error> {
  const movementCollectionResult = collectUserSolanaMovements(tx, allWalletAddresses);
  if (movementCollectionResult.isErr()) {
    return err(movementCollectionResult.error);
  }

  const consolidatedInflows = consolidateSolanaMovements(movementCollectionResult.value.inflows);
  const consolidatedOutflows = consolidateSolanaMovements(movementCollectionResult.value.outflows);
  const userAssets = buildUserAssetSet(consolidatedInflows, consolidatedOutflows);
  const counterpartyInference = inferCounterpartyAddresses(
    tx,
    allWalletAddresses,
    consolidatedInflows,
    consolidatedOutflows
  );

  const feePaidByUser = determineFeePaidByUser(
    tx,
    allWalletAddresses,
    consolidatedInflows,
    consolidatedOutflows,
    counterpartyInference.fromAddress
  );
  warnOnAmbiguousFeePayer(tx, consolidatedInflows, consolidatedOutflows);
  warnOnCounterpartyInferenceFailure(tx, userAssets, counterpartyInference.inferenceFailureReason);

  const feeAbsorbedByMovement = feePaidByUser ? absorbFeeFromSolOutflows(consolidatedOutflows, tx.feeAmount) : false;
  const associatedTokenOverheadResult = assignAssociatedTokenAccountProtocolOverhead(tx, consolidatedOutflows);
  if (associatedTokenOverheadResult.isErr()) {
    return err(associatedTokenOverheadResult.error);
  }

  let fromAddress = counterpartyInference.fromAddress;
  let toAddress = counterpartyInference.toAddress;
  if (consolidatedOutflows.length === 0 && consolidatedInflows.length === 0 && !fromAddress && !toAddress) {
    ({ fromAddress, toAddress } = inferFeeOnlySelfTransfer(tx, allWalletAddresses));
  }

  const primaryFallback: SolanaMovement = { amount: '0', asset: 'SOL' as Currency };
  const primary =
    findLargestMovement(consolidatedInflows) ?? findLargestMovement(consolidatedOutflows) ?? primaryFallback;

  return ok({
    classificationUncertainty: buildClassificationUncertainty(consolidatedInflows, consolidatedOutflows),
    feeAbsorbedByMovement,
    feePaidByUser,
    fromAddress,
    inferenceFailureReason: counterpartyInference.inferenceFailureReason,
    inflows: consolidatedInflows,
    outflows: consolidatedOutflows,
    primary,
    toAddress,
  });
}

/**
 * Analyze fund flow from normalized SolanaTransaction data
 */
export function analyzeSolanaFundFlow(tx: SolanaTransaction, context: AddressContext): Result<SolanaFundFlow, Error> {
  // Use all user addresses for multi-address fund-flow analysis
  const allWalletAddresses = new Set<string>(context.userAddresses);

  // Analyze instruction complexity
  const instructionCount = tx.instructions?.length || 0;
  const hasMultipleInstructions = instructionCount > 1;

  // Detect transaction types based on instructions
  const hasBridgeTransfer = detectSolanaBridgeReceipt(tx.logMessages);
  const hasRewardDistribution = detectSolanaRewardDistribution(tx.logMessages);
  const hasStaking = detectSolanaStakingInstructions(tx.instructions);
  const hasSwaps = detectSolanaSwapInstructions(tx.instructions);
  const hasTokenTransfers = detectSolanaTokenTransferInstructions(tx.instructions);

  // Enhanced fund flow analysis using balance changes
  const flowAnalysisResult = analyzeSolanaBalanceChanges(tx, allWalletAddresses);
  if (flowAnalysisResult.isErr()) {
    return err(flowAnalysisResult.error.message);
  }
  const flowAnalysis = flowAnalysisResult.value;
  const normalizedSwapRefund = collapseReturnedInputAssetSwapRefund({
    enabled: hasSwaps,
    inflows: flowAnalysis.inflows,
    outflows: flowAnalysis.outflows,
  });
  const normalizedPrimaryFallback: SolanaMovement = { amount: '0', asset: 'SOL' as Currency };
  const normalizedPrimary =
    findLargestMovement(normalizedSwapRefund.inflows) ??
    findLargestMovement(normalizedSwapRefund.outflows) ??
    normalizedPrimaryFallback;

  const fundFlow: SolanaFundFlow = {
    computeUnitsUsed: tx.computeUnitsConsumed,
    feeAmount: tx.feeAmount || '0',
    feeCurrency: (tx.feeCurrency || 'SOL') as Currency,
    feePaidByUser: flowAnalysis.feePaidByUser,
    feeAbsorbedByMovement: flowAnalysis.feeAbsorbedByMovement,
    fromAddress: flowAnalysis.fromAddress,
    toAddress: flowAnalysis.toAddress,
    hasBridgeTransfer,
    hasMultipleInstructions,
    hasRewardDistribution,
    hasStaking,
    hasSwaps,
    hasTokenTransfers,
    instructionCount,
    transactionCount: 1, // Always 1 for Solana (no correlation like EVM)

    inflows: normalizedSwapRefund.inflows,
    outflows: normalizedSwapRefund.outflows,
    primary: normalizedPrimary,

    // Classification uncertainty
    classificationUncertainty: buildClassificationUncertainty(
      normalizedSwapRefund.inflows,
      normalizedSwapRefund.outflows
    ),
    inferenceFailureReason: flowAnalysis.inferenceFailureReason,
  };

  return ok(fundFlow);
}
