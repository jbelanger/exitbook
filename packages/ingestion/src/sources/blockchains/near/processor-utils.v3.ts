/**
 * NEAR V3 Processor Utilities
 *
 * Pure utility functions for processing NEAR transactions in V3 architecture:
 * - Group normalized data by transaction hash
 * - Two-hop correlation: receipts → transactions, activities/ft-transfers → receipts
 * - Attach orphaned activities/ft-transfers (missing/invalid receipt_id) to synthetic receipts with logging
 * - Extract fees with single source of truth
 * - Extract fund flows from receipts
 * - Aggregate movements by asset
 * - Classify operation types
 *
 * All functions are pure (no side effects) for easier testing.
 */

import type {
  NearBalanceChangeV3,
  NearReceiptV3 as NearReceiptSchema,
  NearTokenTransferV3,
  NearTransactionV3,
  NearBalanceChangeCause,
  NearActionType,
} from '@exitbook/blockchain-providers';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { CorrelatedTransaction, NearReceipt, RawTransactionGroup } from './types.v3.js';

const logger = getLogger('near-processor-utils-v3');

const NEAR_DECIMALS = 24;

const FEE_CAUSES = new Set<NearBalanceChangeCause>(['FEE', 'GAS', 'GAS_REFUND']);

function normalizeNearAmount(yoctoAmount: Decimal | string): Decimal {
  return new Decimal(yoctoAmount).dividedBy(new Decimal(10).pow(NEAR_DECIMALS));
}

function normalizeTokenAmount(rawAmount: Decimal | string, decimals: number): Decimal {
  return new Decimal(rawAmount).dividedBy(new Decimal(10).pow(decimals));
}

/**
 * Movement represents a fund flow (inflow or outflow) in a transaction
 */
export interface Movement {
  asset: string;
  amount: Decimal;
  contractAddress?: string | undefined;
  direction: 'in' | 'out';
  flowType: 'native' | 'token_transfer' | 'fee' | 'unknown';
}

export interface DerivedDeltaResult {
  derivedDeltas: Map<string, string>;
  warnings: string[];
}

function parseBlockHeight(blockHeight: string | undefined): number {
  if (!blockHeight) return 0;
  const parsed = parseInt(blockHeight, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Derive missing deltaAmount values for balance changes using absolute balances.
 *
 * Uses a single ordered stream per affected account to compute deltas:
 * delta = currentAbsolute - previousAbsolute
 *
 * If the first activity for an account is missing deltaAmount, we assume
 * a prior balance of 0 ONLY for INBOUND events (and warn). OUTBOUND events
 * without a prior balance remain unresolved.
 */
export function deriveBalanceChangeDeltasFromAbsolutes(balanceChanges: NearBalanceChangeV3[]): DerivedDeltaResult {
  const derivedDeltas = new Map<string, string>();
  const warnings: string[] = [];

  const byAccount = new Map<string, NearBalanceChangeV3[]>();
  for (const change of balanceChanges) {
    const existing = byAccount.get(change.affectedAccountId) || [];
    existing.push(change);
    byAccount.set(change.affectedAccountId, existing);
  }

  for (const [accountId, changes] of byAccount.entries()) {
    const ordered = [...changes].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      const heightA = parseBlockHeight(a.blockHeight);
      const heightB = parseBlockHeight(b.blockHeight);
      if (heightA !== heightB) {
        return heightA - heightB;
      }
      const hasReceiptA = a.receiptId !== undefined && a.receiptId !== null;
      const hasReceiptB = b.receiptId !== undefined && b.receiptId !== null;
      if (hasReceiptA !== hasReceiptB) {
        return hasReceiptA ? -1 : 1;
      }
      const receiptA = a.receiptId ?? '';
      const receiptB = b.receiptId ?? '';
      if (receiptA !== receiptB) {
        return receiptA.localeCompare(receiptB);
      }
      return (a.eventId ?? '').localeCompare(b.eventId ?? '');
    });

    let previousBalance: Decimal | undefined;

    for (const change of ordered) {
      const currentBalance = new Decimal(change.absoluteNonstakedAmount);

      if (change.deltaAmountYocto) {
        previousBalance = currentBalance;
        continue;
      }

      if (previousBalance) {
        const delta = currentBalance.minus(previousBalance);
        const deltaStr = delta.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        previousBalance = currentBalance;
        continue;
      }

      if (change.direction === 'INBOUND' && !currentBalance.isZero()) {
        const deltaStr = currentBalance.toFixed();
        derivedDeltas.set(change.eventId, deltaStr);
        warnings.push(
          `Derived delta for first activity (assumed prior balance 0). ` +
            `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Amount=${deltaStr}`
        );
        previousBalance = currentBalance;
        continue;
      }

      warnings.push(
        `Unable to derive delta for first activity (missing prior balance). ` +
          `Account=${accountId}, Receipt=${change.receiptId ?? 'unknown'}, Direction=${change.direction}`
      );
      previousBalance = currentBalance;
    }
  }

  return { derivedDeltas, warnings };
}

/**
 * Fee extraction result with optional warning for conflicts
 */
export interface FeeExtractionResult {
  movements: Movement[];
  warning?: string | undefined;
  source?: 'receipt' | 'balance-change' | undefined;
}

/**
 * Operation classification result
 */
export interface OperationClassification {
  category: 'transfer' | 'trade' | 'staking' | 'defi' | 'governance' | 'fee';
  type:
    | 'transfer'
    | 'deposit'
    | 'withdrawal'
    | 'swap'
    | 'buy'
    | 'sell'
    | 'stake'
    | 'unstake'
    | 'reward'
    | 'batch'
    | 'refund'
    | 'vote'
    | 'proposal'
    | 'airdrop'
    | 'fee';
}

/**
 * Group normalized transaction data by transaction hash
 *
 * Takes normalized data rows from the database and groups them by blockchain_transaction_hash.
 * Each group contains all 4 stream types (transactions, receipts, balance-changes, token-transfers)
 * for a single parent transaction.
 *
 * IMPORTANT: This uses two-pass processing to resolve transaction hashes for orphaned items:
 * 1. First pass: Build receipt_id → transaction_hash map from receipts
 * 2. Second pass: Resolve transaction hash for activities/ft-transfers using receipt map
 *
 * @param rawData - Normalized transaction rows from database
 * @returns Map of transaction hash to grouped data
 */
export function groupNearEventsByTransaction(
  rawData: {
    blockchainTransactionHash: string;
    normalizedData: unknown;
    transactionTypeHint: string;
  }[]
): Map<string, RawTransactionGroup> {
  // First pass: Build receipt_id → transaction_hash map
  const receiptIdToTxHash = new Map<string, string>();

  for (const row of rawData) {
    if (row.transactionTypeHint === 'receipts') {
      const receipt = row.normalizedData as NearReceiptSchema;
      if (receipt.receiptId && receipt.transactionHash) {
        receiptIdToTxHash.set(receipt.receiptId, receipt.transactionHash);
      }
    }
  }

  // Second pass: Group by transaction hash, resolving via receipt_id when needed
  const groups = new Map<string, RawTransactionGroup>();
  const skippedBalanceChanges: NearBalanceChangeV3[] = [];
  const skippedTokenTransfers: NearTokenTransferV3[] = [];

  for (const row of rawData) {
    let txHash = row.blockchainTransactionHash;

    // Resolve transaction hash for balance changes/token transfers via receipt lookup
    if (row.transactionTypeHint === 'balance-changes') {
      const balanceChange = row.normalizedData as NearBalanceChangeV3;
      if (balanceChange.receiptId && receiptIdToTxHash.has(balanceChange.receiptId)) {
        txHash = receiptIdToTxHash.get(balanceChange.receiptId)!;
      } else if (!balanceChange.receiptId && !txHash) {
        // CRITICAL: Cannot correlate this balance change - missing both receipt_id and transaction_hash
        logger.warn(
          `Skipping orphaned balance change - missing both receipt_id and transaction_hash. ` +
            `Account: ${balanceChange.affectedAccountId}, Block: ${balanceChange.blockHeight}, ` +
            `Delta: ${balanceChange.deltaAmountYocto ?? 'null'}, Cause: ${balanceChange.cause}. ` +
            `THIS DATA WILL BE LOST.`
        );
        skippedBalanceChanges.push(balanceChange);
        continue;
      }
    } else if (row.transactionTypeHint === 'token-transfers') {
      const tokenTransfer = row.normalizedData as NearTokenTransferV3;
      if (tokenTransfer.receiptId && receiptIdToTxHash.has(tokenTransfer.receiptId)) {
        txHash = receiptIdToTxHash.get(tokenTransfer.receiptId)!;
      } else if (!tokenTransfer.receiptId && !txHash) {
        // CRITICAL: Cannot correlate this token transfer - missing both receipt_id and transaction_hash
        logger.warn(
          `Skipping orphaned token transfer - missing both receipt_id and transaction_hash. ` +
            `Account: ${tokenTransfer.affectedAccountId}, Contract: ${tokenTransfer.contractAddress}, ` +
            `Block: ${tokenTransfer.blockHeight}, Delta: ${tokenTransfer.deltaAmountYocto ?? 'null'}. ` +
            `THIS DATA WILL BE LOST.`
        );
        skippedTokenTransfers.push(tokenTransfer);
        continue;
      }
    }

    let group = groups.get(txHash);
    if (!group) {
      group = {
        transaction: undefined,
        receipts: [],
        balanceChanges: [],
        tokenTransfers: [],
      };
      groups.set(txHash, group);
    }

    switch (row.transactionTypeHint) {
      case 'transactions':
        if (group.transaction) {
          throw new Error(`Duplicate transaction record for hash ${txHash}`);
        }
        group.transaction = row.normalizedData as NearTransactionV3;
        break;
      case 'receipts':
        group.receipts.push(row.normalizedData as NearReceiptSchema);
        break;
      case 'balance-changes':
        group.balanceChanges.push(row.normalizedData as NearBalanceChangeV3);
        break;
      case 'token-transfers':
        group.tokenTransfers.push(row.normalizedData as NearTokenTransferV3);
        break;
      default:
        throw new Error(`Unknown transaction type hint: ${row.transactionTypeHint}`);
    }
  }

  // Report summary of skipped items
  if (skippedBalanceChanges.length > 0 || skippedTokenTransfers.length > 0) {
    logger.error(
      `CRITICAL: Skipped ${skippedBalanceChanges.length} balance changes and ${skippedTokenTransfers.length} token transfers ` +
        `due to missing correlation keys (receipt_id and transaction_hash). ` +
        `This represents data loss in a financial system. ` +
        `Total raw events: ${rawData.length}, Successfully grouped: ${rawData.length - skippedBalanceChanges.length - skippedTokenTransfers.length}`
    );
  }

  return groups;
}

/**
 * Validate that a transaction group has all required data
 *
 * @param txHash - Transaction hash (for error messages)
 * @param group - Transaction group to validate
 * @returns Error if validation fails, undefined if valid
 */
export function validateTransactionGroup(txHash: string, group: RawTransactionGroup): Result<void, Error> {
  if (!group.transaction) {
    return err(new Error(`Missing transaction record for hash ${txHash}`));
  }

  // Receipts, activities, and ft-transfers can be empty arrays (valid for some transactions)
  return ok(undefined);
}

/**
 * Convert normalized V3 receipt schema to processor NearReceipt type
 *
 * The V3 normalized schema from the provider is already in the correct format.
 * This function just adds the balanceChanges and tokenTransfers arrays that will
 * be populated during correlation.
 */
export function convertReceiptToProcessorType(receipt: NearReceiptSchema): NearReceipt {
  return {
    receiptId: receipt.receiptId,
    transactionHash: receipt.transactionHash,
    predecessorAccountId: receipt.predecessorAccountId,
    receiverAccountId: receipt.receiverAccountId,
    receiptKind: receipt.receiptKind,
    blockHash: receipt.blockHash,
    blockHeight: receipt.blockHeight,
    blockTimestamp: receipt.blockTimestamp,
    executorAccountId: receipt.executorAccountId,
    gasBurnt: receipt.gasBurnt,
    tokensBurntYocto: receipt.tokensBurntYocto,
    status: receipt.status,
    logs: receipt.logs,
    actions: receipt.actions,
    // These will be populated during correlation
    balanceChanges: [],
    tokenTransfers: [],
  };
}

/**
 * Correlate receipts with activities and ft-transfers by receipt_id
 *
 * Attaches balance changes and token transfers to their corresponding receipts.
 * This implements the two-hop correlation: transactions → receipts → activities/ft-transfers.
 *
 * Items without receipt_id are attached to a synthetic receipt at the transaction level.
 *
 * IMPORTANT: Assumes deltas have already been derived by deriveBalanceChangeDeltasFromAbsolutes()
 * before this function is called. This function validates delta presence and fails fast if missing.
 *
 * @param group - Transaction group with normalized V3 data
 * @returns Correlated transaction with enriched receipts
 */
export function correlateTransactionData(group: RawTransactionGroup): Result<CorrelatedTransaction, Error> {
  if (!group.transaction) {
    return err(new Error('Missing transaction in group'));
  }

  // Convert receipts to processor type (adds empty balanceChanges/tokenTransfers arrays)
  const processedReceipts = group.receipts.map(convertReceiptToProcessorType);

  // Validate that all balance changes have deltas (should have been derived earlier)
  // Fail-fast on balance changes with missing deltas that would be used for correlation
  const balanceChangesWithoutDeltas = group.balanceChanges.filter((bc) => !bc.deltaAmountYocto && bc.receiptId);

  if (balanceChangesWithoutDeltas.length > 0) {
    const first = balanceChangesWithoutDeltas[0]!;
    return err(
      new Error(
        `Balance change missing deltaAmount for receipt ${first.receiptId} (account ${first.affectedAccountId}). ` +
          `Deltas should have been derived before correlation.`
      )
    );
  }

  // Group balance changes and token transfers by receipt_id
  // Items without receipt_id OR with receipt_id that doesn't match any receipt
  // are attached to a synthetic receipt at the transaction level.
  const balanceChangesByReceipt = new Map<string, NearBalanceChangeV3[]>();
  const tokenTransfersByReceipt = new Map<string, NearTokenTransferV3[]>();
  const syntheticReceiptId = `tx:${group.transaction.transactionHash}:missing-receipt`;
  let hasSyntheticItems = false;

  // Build set of valid receipt IDs
  const validReceiptIds = new Set(processedReceipts.map((r) => r.receiptId));

  for (const balanceChange of group.balanceChanges) {
    // Use synthetic receipt if balance change has no receipt_id or receipt_id doesn't match any receipt
    let receiptId = balanceChange.receiptId;
    if (!receiptId || !validReceiptIds.has(receiptId)) {
      receiptId = syntheticReceiptId;
      hasSyntheticItems = true;
    }
    const existing = balanceChangesByReceipt.get(receiptId) || [];
    existing.push(balanceChange);
    balanceChangesByReceipt.set(receiptId, existing);
  }

  for (const tokenTransfer of group.tokenTransfers) {
    // Use synthetic receipt if transfer has no receipt_id or receipt_id doesn't match any receipt
    let receiptId = tokenTransfer.receiptId;
    if (!receiptId || !validReceiptIds.has(receiptId)) {
      receiptId = syntheticReceiptId;
      hasSyntheticItems = true;
    }
    const existing = tokenTransfersByReceipt.get(receiptId) || [];
    existing.push(tokenTransfer);
    tokenTransfersByReceipt.set(receiptId, existing);
  }

  if (hasSyntheticItems) {
    const bcCount = balanceChangesByReceipt.get(syntheticReceiptId)?.length || 0;
    const ttCount = tokenTransfersByReceipt.get(syntheticReceiptId)?.length || 0;
    logger.warn(
      `Created synthetic receipt for tx ${group.transaction.transactionHash}: ${bcCount} balance change(s), ${ttCount} token transfer(s)`
    );
    processedReceipts.push({
      receiptId: syntheticReceiptId,
      transactionHash: group.transaction.transactionHash,
      predecessorAccountId: group.transaction.signerAccountId,
      receiverAccountId: group.transaction.receiverAccountId,
      receiptKind: 'ACTION',
      blockHash: group.transaction.blockHash,
      blockHeight: group.transaction.blockHeight,
      blockTimestamp: group.transaction.blockTimestamp,
      status: group.transaction.status,
      balanceChanges: [],
      tokenTransfers: [],
      isSynthetic: true,
    });
  }

  // Attach to receipts
  for (const receipt of processedReceipts) {
    receipt.balanceChanges = balanceChangesByReceipt.get(receipt.receiptId) || [];
    receipt.tokenTransfers = tokenTransfersByReceipt.get(receipt.receiptId) || [];
  }

  return ok({
    transaction: group.transaction,
    receipts: processedReceipts,
  });
}

/**
 * Extract fees from a receipt with single source of truth and conflict detection
 *
 * Priority order (per V4 plan):
 * 1. Receipt gas_burnt and tokens_burnt (most authoritative)
 * 2. Balance changes with 'fee' or 'gas' cause
 *
 * Logs a warning if both sources exist and differ significantly (>1% variance).
 *
 * @param receipt - Enriched receipt with balance changes
 * @param primaryAddress - User's address (fee payer filter)
 * @returns Fee extraction result with movements and optional warning
 */
export function extractReceiptFees(receipt: NearReceipt, primaryAddress: string): FeeExtractionResult {
  // Calculate both sources if they exist
  let receiptFee: Decimal | undefined;
  let balanceChangeFee: Decimal | undefined;
  const isPrimaryPayer = receipt.predecessorAccountId === primaryAddress;

  // Source 1: Explicit gas fees from receipt
  if (receipt.gasBurnt && receipt.tokensBurntYocto) {
    const tokensBurnt = new Decimal(receipt.tokensBurntYocto);
    if (!tokensBurnt.isZero()) {
      receiptFee = normalizeNearAmount(tokensBurnt);
    }
  }

  // Source 2: Balance changes with fee/gas cause
  // IMPORTANT: These conditions must match extractFlows to avoid double-counting
  if (receipt.balanceChanges && receipt.balanceChanges.length > 0) {
    const feeActivities = receipt.balanceChanges.filter(
      (bc) => FEE_CAUSES.has(bc.cause) && bc.affectedAccountId === primaryAddress
    );

    if (feeActivities.length > 0) {
      let totalFee = new Decimal(0);
      for (const activity of feeActivities) {
        if (activity.deltaAmountYocto) {
          const delta = new Decimal(activity.deltaAmountYocto);
          totalFee = totalFee.plus(normalizeNearAmount(delta.abs()));
        }
      }
      if (!totalFee.isZero()) {
        balanceChangeFee = totalFee;
      }
    }
  }

  // Detect conflicts if both sources exist
  let warning: string | undefined;
  if (receiptFee && balanceChangeFee && isPrimaryPayer) {
    // Check if they differ by more than 1%
    const diff = receiptFee.minus(balanceChangeFee).abs();
    const percentDiff = diff.dividedBy(receiptFee).times(100);

    if (percentDiff.greaterThan(1)) {
      warning =
        `Fee mismatch for receipt ${receipt.receiptId}: ` +
        `receipt tokensBurnt=${receiptFee.toFixed()} NEAR vs ` +
        `balance changes=${balanceChangeFee.toFixed()} NEAR ` +
        `(${percentDiff.toFixed(2)}% difference). Using receipt value as authoritative.`;
    }
  }

  // Priority 1: Use receipt fee if available
  if (receiptFee && isPrimaryPayer) {
    return {
      movements: [
        {
          asset: 'NEAR',
          amount: receiptFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'receipt',
    };
  }

  // Priority 2: Use balance change fee if available
  if (balanceChangeFee) {
    return {
      movements: [
        {
          asset: 'NEAR',
          amount: balanceChangeFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'balance-change',
    };
  }

  // No fees found
  return { movements: [] };
}

/**
 * Extract fund flows (inflows/outflows) from a receipt
 *
 * Analyzes balance changes and token transfers to determine movements.
 * Excludes fee-related flows (handled separately).
 *
 * @param receipt - Enriched receipt
 * @param primaryAddress - User's address
 * @returns Array of movements
 */
export function extractFlows(receipt: NearReceipt, primaryAddress: string): Movement[] {
  const movements: Movement[] = [];

  // Process balance changes (NEAR)
  if (receipt.balanceChanges) {
    for (const activity of receipt.balanceChanges) {
      if (activity.affectedAccountId !== primaryAddress) {
        continue;
      }
      // Skip fee-related activities (handled by extractReceiptFees)
      // Must match the same conditions as extractReceiptFees to avoid double-counting
      if (FEE_CAUSES.has(activity.cause)) {
        continue;
      }

      if (!activity.deltaAmountYocto) {
        continue; // Skip if no delta (already validated in correlation)
      }

      const delta = new Decimal(activity.deltaAmountYocto);
      if (delta.isZero()) {
        continue;
      }

      const direction = delta.isNegative() ? 'out' : 'in';
      const expectedDirection = activity.direction === 'INBOUND' ? 'in' : 'out';
      if (direction !== expectedDirection) {
        logger.warn(
          `NEAR balance change direction mismatch for ${activity.receiptId ?? 'unknown-receipt'}: ` +
            `declared=${activity.direction}, derived=${direction}, delta=${delta.toFixed()}`
        );
      }
      const normalizedAmount = normalizeNearAmount(delta.abs());

      movements.push({
        asset: 'NEAR',
        amount: normalizedAmount,
        direction,
        flowType: 'native',
      });
    }
  }

  // Process token transfers
  if (receipt.tokenTransfers) {
    for (const transfer of receipt.tokenTransfers) {
      if (!transfer.deltaAmountYocto) {
        continue;
      }

      const delta = new Decimal(transfer.deltaAmountYocto);
      if (delta.isZero()) {
        continue;
      }

      // Determine direction based on affected account
      const direction = transfer.affectedAccountId === primaryAddress ? 'in' : 'out';
      const normalizedAmount = normalizeTokenAmount(delta.abs(), transfer.decimals);

      movements.push({
        asset: transfer.symbol || 'UNKNOWN',
        amount: normalizedAmount,
        contractAddress: transfer.contractAddress,
        direction,
        flowType: 'token_transfer',
      });
    }
  }

  return movements;
}

/**
 * Consolidate movements by asset
 *
 * Aggregates multiple movements of the same asset into a single movement.
 * Used to create transaction-level inflows/outflows from receipt-level movements.
 *
 * @param movements - Array of movements to consolidate
 * @returns Map of asset to consolidated movement
 */
export function consolidateByAsset(movements: Movement[]): Map<string, Movement> {
  const consolidated = new Map<string, Movement>();

  for (const movement of movements) {
    const key = movement.contractAddress || movement.asset;

    const existing = consolidated.get(key);
    if (existing) {
      existing.amount = existing.amount.plus(movement.amount);
    } else {
      consolidated.set(key, { ...movement });
    }
  }

  return consolidated;
}

/**
 * Check if transaction is fee-only based on outflows
 *
 * A transaction has fee-only outflows when:
 * - No inflows
 * - Has outflows (which are treated as fees)
 * - No token transfers
 * - No deposit actions
 * - All outflows are NEAR native asset
 */
export function isFeeOnlyFromOutflows(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    consolidatedInflows.length === 0 &&
    consolidatedOutflows.length > 0 &&
    !hasTokenTransfers &&
    !hasActionDeposits &&
    consolidatedOutflows.every((movement) => movement.asset === 'NEAR')
  );
}

/**
 * Check if transaction is fee-only based on fees
 *
 * A transaction has fee-only fees when:
 * - No inflows
 * - No outflows
 * - Has fees
 * - No token transfers
 * - No deposit actions
 * - All fees are NEAR native asset
 */
function isFeeOnlyFromFees(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  consolidatedFees: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    consolidatedInflows.length === 0 &&
    consolidatedOutflows.length === 0 &&
    consolidatedFees.length > 0 &&
    !hasTokenTransfers &&
    !hasActionDeposits &&
    consolidatedFees.every((movement) => movement.asset === 'NEAR')
  );
}

/**
 * Determine if transaction is fee-only
 *
 * Fee-only transactions have no meaningful fund flows, only network fees.
 * This occurs in two scenarios:
 * 1. Outflows that represent fees (no inflows, NEAR-only outflows)
 * 2. Pure fees with no other movements
 */
export function isFeeOnlyTransaction(
  consolidatedInflows: Movement[],
  consolidatedOutflows: Movement[],
  consolidatedFees: Movement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    isFeeOnlyFromOutflows(consolidatedInflows, consolidatedOutflows, hasTokenTransfers, hasActionDeposits) ||
    isFeeOnlyFromFees(consolidatedInflows, consolidatedOutflows, consolidatedFees, hasTokenTransfers, hasActionDeposits)
  );
}

/**
 * Extract all action types from receipts
 */
function getActionTypes(receipts: NearReceipt[]): NearActionType[] {
  const actionTypes: NearActionType[] = [];
  for (const receipt of receipts) {
    if (receipt.actions) {
      for (const action of receipt.actions) {
        actionTypes.push(action.actionType);
      }
    }
  }
  return actionTypes;
}

/**
 * Check if actions contain specific type
 */
function hasActionType(actionTypes: NearActionType[], type: NearActionType): boolean {
  return actionTypes.includes(type);
}

/**
 * Analyze balance change causes to determine operation context
 */
function analyzeBalanceChangeCauses(receipts: NearReceipt[]): {
  hasRefunds: boolean;
  hasRewards: boolean;
} {
  let hasRewards = false;
  let hasRefunds = false;

  for (const receipt of receipts) {
    if (receipt.balanceChanges) {
      for (const change of receipt.balanceChanges) {
        if (change.cause === 'CONTRACT_REWARD') {
          hasRewards = true;
        }
        if (change.cause === 'GAS_REFUND') {
          hasRefunds = true;
        }
      }
    }
  }

  return { hasRewards, hasRefunds };
}

/**
 * Classify operation type from correlated transaction
 *
 * Determines the transaction type based on receipts, actions, and fund flows.
 *
 * @param correlated - Correlated transaction
 * @param allInflows - All inflows across receipts
 * @param allOutflows - All outflows across receipts
 * @returns Operation classification
 */
export function classifyOperation(
  correlated: CorrelatedTransaction,
  allInflows: Movement[],
  allOutflows: Movement[]
): OperationClassification {
  const hasInflows = allInflows.length > 0;
  const hasOutflows = allOutflows.length > 0;
  const hasTokenTransfers =
    allInflows.some((m) => m.flowType === 'token_transfer') || allOutflows.some((m) => m.flowType === 'token_transfer');

  const actionTypes = getActionTypes(correlated.receipts);
  const { hasRewards, hasRefunds } = analyzeBalanceChangeCauses(correlated.receipts);

  // Staking operations
  if (hasActionType(actionTypes, 'stake')) {
    return {
      category: 'staking',
      type: 'stake',
    };
  }

  // Staking rewards (inflow with reward cause)
  if (hasInflows && !hasOutflows && hasRewards) {
    return {
      category: 'staking',
      type: 'reward',
    };
  }

  // Refunds (inflow with refund cause)
  if (hasInflows && !hasOutflows && hasRefunds) {
    return {
      category: 'transfer',
      type: 'refund',
    };
  }

  // Account creation
  if (hasActionType(actionTypes, 'create_account')) {
    return {
      category: 'defi',
      type: 'batch',
    };
  }

  // Inflows only (deposits)
  if (hasInflows && !hasOutflows) {
    return {
      category: 'transfer',
      type: 'deposit',
    };
  }

  // Outflows only (withdrawals)
  if (hasOutflows && !hasInflows) {
    return {
      category: 'transfer',
      type: 'withdrawal',
    };
  }

  // Both flows with tokens (swap/trade)
  if (hasInflows && hasOutflows && hasTokenTransfers) {
    return {
      category: 'trade',
      type: 'swap',
    };
  }

  // Both flows without tokens (transfer)
  if (hasInflows && hasOutflows) {
    return {
      category: 'transfer',
      type: 'transfer',
    };
  }

  // No flows (fee-only transaction or contract interaction)
  return {
    category: 'defi',
    type: 'batch',
  };
}
