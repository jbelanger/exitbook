import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import type {
  NearReceipt,
  NearAction,
  NearBalanceChange,
  NearTokenTransfer,
  NearReceiptEvent,
  NearReceiptOutcome,
} from '../../schemas.v2.js';
import { extractReceiptFee } from '../../utils.v2.js';

import type {
  NearBlocksReceiptV2,
  NearBlocksActionV2,
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceiptOutcomeV2,
  NearBlocksTransactionV2,
} from './nearblocks.schemas.js';

const logger = getLogger('nearblocks-mapper-v2');

/**
 * Normalize action type to snake_case
 * Handles both PascalCase (e.g., "FunctionCall") and SCREAMING_SNAKE_CASE (e.g., "TRANSFER")
 */
function normalizeActionType(action: string): string {
  // If already in SCREAMING_SNAKE_CASE (all uppercase with optional underscores), just lowercase it
  if (/^[A-Z_]+$/.test(action)) {
    return action.toLowerCase();
  }

  // Otherwise, convert PascalCase to snake_case
  return action
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Map NearBlocks action to NEAR-native action
 */
export function mapNearBlocksAction(rawAction: NearBlocksActionV2): Result<NearAction, Error> {
  try {
    const action: NearAction = {
      actionType: normalizeActionType(rawAction.action),
      methodName: rawAction.method ?? undefined,
      args: rawAction.args ?? undefined,
      attachedDeposit: rawAction.deposit ?? undefined,
      gas: rawAction.gas ?? undefined,
      publicKey: rawAction.public_key ?? undefined,
      beneficiaryId: rawAction.beneficiary_id ?? undefined,
    };

    return ok(action);
  } catch (error) {
    return err(new Error(`Failed to map NearBlocks action: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Map NearBlocks receipt outcome to NEAR-native outcome
 */
export function mapNearBlocksReceiptOutcome(rawOutcome: NearBlocksReceiptOutcomeV2): Result<NearReceiptOutcome, Error> {
  try {
    const outcome: NearReceiptOutcome = {
      status: rawOutcome.status,
      gasBurnt: rawOutcome.gas_burnt,
      tokensBurntYocto: rawOutcome.tokens_burnt,
      logs: rawOutcome.logs ?? undefined,
      executorAccountId: rawOutcome.executor_account_id,
    };

    return ok(outcome);
  } catch (error) {
    return err(
      new Error(`Failed to map NearBlocks receipt outcome: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Parse NearBlocks timestamp to Unix milliseconds (integer)
 */
function parseNearBlocksTimestamp(timestamp: string): number {
  // NearBlocks returns timestamps in nanoseconds as strings
  // Convert to milliseconds and floor to integer (schemas require int)
  const nanos = new Decimal(timestamp);
  const millis = nanos.dividedBy(1_000_000);
  return Math.floor(millis.toNumber());
}

/**
 * Map NearBlocks receipt to NEAR-native receipt
 */
export function mapNearBlocksReceipt(rawReceipt: NearBlocksReceiptV2): Result<NearReceipt, Error> {
  try {
    // Map actions if present
    let actions: NearAction[] | undefined;
    if (rawReceipt.actions && rawReceipt.actions.length > 0) {
      const actionResults = rawReceipt.actions.map(mapNearBlocksAction);
      const failed = actionResults.find((r) => r.isErr());
      if (failed?.isErr()) {
        return err(failed.error);
      }
      actions = actionResults.map((r) => r._unsafeUnwrap());
    }

    // Map outcome if present (from receipt_outcome nested object)
    let outcome: NearReceiptOutcome | undefined;
    if (rawReceipt.receipt_outcome) {
      const outcomeResult = mapNearBlocksReceiptOutcome(rawReceipt.receipt_outcome);
      if (outcomeResult.isErr()) {
        return err(outcomeResult.error);
      }
      outcome = outcomeResult.value;
    }

    // Extract block data from receipt_block nested object
    // Note: blockTimestamp is required (schema enforces positive())
    if (!rawReceipt.receipt_block?.block_timestamp) {
      return err(
        new Error(
          `Receipt ${rawReceipt.receipt_id} missing block timestamp. ` +
            `This is required for event ordering and cannot be null.`
        )
      );
    }

    const blockHeight = rawReceipt.receipt_block?.block_height ?? 0;
    const blockHash = rawReceipt.receipt_block?.block_hash;
    const blockTimestamp = parseNearBlocksTimestamp(String(rawReceipt.receipt_block.block_timestamp));

    // Determine receipt kind: use API value if present, otherwise infer from data
    let receiptKind: 'ACTION' | 'DATA' | 'REFUND';
    if (rawReceipt.receipt_kind) {
      receiptKind = rawReceipt.receipt_kind.toUpperCase() as 'ACTION' | 'DATA' | 'REFUND';
    } else {
      // Infer from presence of actions: ACTION receipts have actions, DATA receipts don't
      receiptKind = rawReceipt.actions && rawReceipt.actions.length > 0 ? 'ACTION' : 'DATA';
      logger.warn(
        { receiptId: rawReceipt.receipt_id, inferredKind: receiptKind, hasActions: !!rawReceipt.actions?.length },
        'NearBlocks API missing receipt_kind, inferred from actions presence'
      );
    }

    const receipt: NearReceipt = {
      receiptId: rawReceipt.receipt_id,
      transactionHash: rawReceipt.transaction_hash,
      predecessorId: rawReceipt.predecessor_account_id,
      receiverId: rawReceipt.receiver_account_id,
      receiptKind,
      blockHeight,
      blockHash,
      blockTimestamp,
      actions,
      outcome,
    };

    return ok(receipt);
  } catch (error) {
    return err(
      new Error(`Failed to map NearBlocks receipt: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Map NearBlocks activity to NEAR balance change
 */
export function mapNearBlocksActivity(rawActivity: NearBlocksActivity): Result<NearBalanceChange, Error> {
  try {
    // Calculate pre and post balance from absolute amounts and delta
    const absoluteAmount = new Decimal(rawActivity.absolute_nonstaked_amount);
    const delta = rawActivity.delta_nonstaked_amount ? new Decimal(rawActivity.delta_nonstaked_amount) : new Decimal(0);

    // For OUTBOUND: post = absolute, pre = absolute + |delta|
    // For INBOUND: post = absolute, pre = absolute - delta
    let preBalance: Decimal;
    let postBalance: Decimal;

    if (rawActivity.direction === 'OUTBOUND') {
      postBalance = absoluteAmount;
      preBalance = absoluteAmount.plus(delta.abs());
    } else {
      postBalance = absoluteAmount;
      preBalance = absoluteAmount.minus(delta);
    }

    const blockTimestamp = parseNearBlocksTimestamp(rawActivity.block_timestamp);

    const balanceChange: NearBalanceChange = {
      accountId: rawActivity.affected_account_id,
      preBalance: preBalance.toFixed(),
      postBalance: postBalance.toFixed(),
      receiptId: rawActivity.receipt_id ?? undefined,
      transactionHash: rawActivity.transaction_hash ?? undefined,
      blockTimestamp,
    };

    return ok(balanceChange);
  } catch (error) {
    return err(
      new Error(`Failed to map NearBlocks activity: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Map NearBlocks FT transaction to NEAR token transfer
 */
export function mapNearBlocksFtTransaction(rawFt: NearBlocksFtTransaction): Result<NearTokenTransfer, Error> {
  try {
    if (!rawFt.ft) {
      return err(new Error('FT transaction missing token contract data'));
    }

    if (!rawFt.delta_amount) {
      return err(new Error('FT transaction missing delta amount'));
    }

    // Determine direction from delta (positive = receive, negative = send)
    const delta = new Decimal(rawFt.delta_amount);
    const isReceive = delta.isPositive();

    // Handle MINT/BURN cases where involved_account_id is null
    // MINT: receive with no sender → use contract as source
    // BURN: send with no receiver → use contract as destination
    const from = isReceive
      ? (rawFt.involved_account_id ?? rawFt.ft.contract) // MINT: contract is source
      : rawFt.affected_account_id;
    const to = isReceive ? rawFt.affected_account_id : (rawFt.involved_account_id ?? rawFt.ft.contract); // BURN: contract is destination

    // Normalize amount by dividing by decimals (delta_amount is in raw token units)
    const amount = delta.abs().dividedBy(new Decimal(10).pow(rawFt.ft.decimals));

    const blockTimestamp = parseNearBlocksTimestamp(rawFt.block_timestamp);

    // Validate required fields
    if (!rawFt.transaction_hash) {
      return err(
        new Error(
          `FT transaction missing transaction_hash for receipt ${rawFt.receipt_id}. ` +
            `This is required for correlation and cannot be empty.`
        )
      );
    }

    const tokenTransfer: NearTokenTransfer = {
      contractId: rawFt.ft.contract,
      from,
      to,
      amount: amount.toFixed(),
      decimals: rawFt.ft.decimals,
      symbol: rawFt.ft.symbol ?? undefined,
      receiptId: rawFt.receipt_id,
      transactionHash: rawFt.transaction_hash,
      blockTimestamp,
    };

    return ok(tokenTransfer);
  } catch (error) {
    return err(
      new Error(`Failed to map NearBlocks FT transaction: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Correlate balance changes with receipts
 * Returns a map of receiptId -> balance changes
 */
export function correlateBalanceChanges(
  receipts: NearReceipt[],
  balanceChanges: NearBalanceChange[]
): Map<string, NearBalanceChange[]> {
  const mergedReceiptsById = new Map<string, NearBalanceChange[]>();
  const receiptsByTimestamp = new Map<number, NearReceipt[]>();

  for (const receipt of receipts) {
    const existing = receiptsByTimestamp.get(receipt.blockTimestamp) ?? [];
    existing.push(receipt);
    receiptsByTimestamp.set(receipt.blockTimestamp, existing);
  }

  for (const change of balanceChanges) {
    if (change.receiptId) {
      // Primary: Direct receipt ID match
      const existing = mergedReceiptsById.get(change.receiptId) ?? [];
      existing.push(change);
      mergedReceiptsById.set(change.receiptId, existing);
    } else if (change.transactionHash) {
      // Fallback: Match by transaction hash
      logger.warn(
        {
          transactionHash: change.transactionHash,
          accountId: change.accountId,
        },
        'Balance change missing receipt_id, correlating by transaction hash'
      );

      // Find receipts for this transaction
      const txReceipts = receipts.filter((r) => r.transactionHash === change.transactionHash);
      if (txReceipts.length > 0) {
        // If multiple receipts, use heuristics (account involvement)
        const matchingReceipt = txReceipts.find(
          (r) => r.receiverId === change.accountId || r.predecessorId === change.accountId
        );

        if (matchingReceipt) {
          const existing = mergedReceiptsById.get(matchingReceipt.receiptId) ?? [];
          existing.push(change);
          mergedReceiptsById.set(matchingReceipt.receiptId, existing);
        } else if (txReceipts[0]) {
          // Attach to first receipt as fallback
          const existing = mergedReceiptsById.get(txReceipts[0].receiptId) ?? [];
          existing.push(change);
          mergedReceiptsById.set(txReceipts[0].receiptId, existing);
        }
      }
    } else {
      // Last resort: Match by block timestamp
      const timestampReceipts = receiptsByTimestamp.get(change.blockTimestamp) ?? [];

      if (timestampReceipts.length === 1) {
        const receipt = timestampReceipts[0];
        if (receipt) {
          const existing = mergedReceiptsById.get(receipt.receiptId) ?? [];
          existing.push(change);
          mergedReceiptsById.set(receipt.receiptId, existing);
          logger.warn(
            {
              receiptId: receipt.receiptId,
              accountId: change.accountId,
              blockTimestamp: change.blockTimestamp,
            },
            'Balance change correlated by timestamp fallback (single receipt)'
          );
        }
      } else if (timestampReceipts.length > 1) {
        const matchingReceipt = timestampReceipts.find(
          (receipt) => receipt.receiverId === change.accountId || receipt.predecessorId === change.accountId
        );

        if (matchingReceipt) {
          const existing = mergedReceiptsById.get(matchingReceipt.receiptId) ?? [];
          existing.push(change);
          mergedReceiptsById.set(matchingReceipt.receiptId, existing);
          logger.warn(
            {
              receiptId: matchingReceipt.receiptId,
              accountId: change.accountId,
              blockTimestamp: change.blockTimestamp,
            },
            'Balance change correlated by timestamp fallback (account match)'
          );
        } else {
          logger.warn(
            {
              accountId: change.accountId,
              blockTimestamp: change.blockTimestamp,
              receiptCount: timestampReceipts.length,
            },
            'Balance change has no receipt_id or transaction_hash and matches multiple receipts by timestamp'
          );
        }
      } else {
        logger.warn(
          {
            accountId: change.accountId,
            blockTimestamp: change.blockTimestamp,
          },
          'Balance change has no receipt_id or transaction_hash, cannot correlate'
        );
      }
    }
  }

  return mergedReceiptsById;
}

/**
 * Correlate token transfers with receipts
 * Returns a map of receiptId -> token transfers
 */
export function correlateTokenTransfers(
  receipts: NearReceipt[],
  tokenTransfers: NearTokenTransfer[]
): Map<string, NearTokenTransfer[]> {
  const mergedReceiptsById = new Map<string, NearTokenTransfer[]>();

  for (const transfer of tokenTransfers) {
    // Token transfers always have receipt_id from NearBlocks
    const existing = mergedReceiptsById.get(transfer.receiptId) ?? [];
    existing.push(transfer);
    mergedReceiptsById.set(transfer.receiptId, existing);
  }

  return mergedReceiptsById;
}

/**
 * Generate receipt event from a single receipt
 *
 * Rule: ONE RECEIPT = ONE EVENT
 * - Receipt may have 0..N balance changes (stored as array)
 * - Receipt may have 0..N token transfers (stored as array)
 * - Fee is attached as metadata (from tokens_burnt, payer = predecessor)
 */
export function generateReceiptEvent(
  receipt: NearReceipt,
  transactionHash: string,
  signerId: string,
  providerName: string
): Result<NearReceiptEvent, Error> {
  try {
    // Extract fee if present
    const fee = receipt.outcome
      ? extractReceiptFee({
          tokensBurntYocto: receipt.outcome.tokensBurntYocto,
          predecessorId: receipt.predecessorId,
        })
      : undefined;

    // Determine status
    const status = receipt.outcome ? (receipt.outcome.status ? 'success' : 'failed') : ('pending' as const);

    const event: NearReceiptEvent = {
      id: transactionHash,
      eventId: receipt.receiptId, // Receipt ID is the unique event identifier
      receiptId: receipt.receiptId,
      signerId,
      receiverId: receipt.receiverId,
      predecessorId: receipt.predecessorId,
      receiptKind: receipt.receiptKind,
      actions: receipt.actions,
      status,
      gasBurnt: receipt.outcome?.gasBurnt,
      tokensBurntYocto: receipt.outcome?.tokensBurntYocto,
      fee,
      blockHeight: receipt.blockHeight,
      blockHash: receipt.blockHash,
      timestamp: receipt.blockTimestamp,
      balanceChanges: receipt.balanceChanges,
      tokenTransfers: receipt.tokenTransfers,
      providerName,
    };

    return ok(event);
  } catch (error) {
    return err(
      new Error(`Failed to generate receipt event: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

/**
 * Map NearBlocks transaction to receipt events
 *
 * Process:
 * 1. Map receipts from transaction or separate receipts array
 * 2. Map balance changes from activities
 * 3. Map token transfers from FT transactions
 * 4. Correlate receipts with balance changes and token transfers
 * 5. Generate events (one receipt = one event with arrays)
 */
export function mapNearBlocksTransactionToReceiptEvents(params: {
  activities?: NearBlocksActivity[];
  ftTransfers?: NearBlocksFtTransaction[];
  providerName: string;
  receipts?: NearBlocksReceiptV2[];
  transaction: NearBlocksTransactionV2;
}): Result<NearReceiptEvent[], Error> {
  try {
    const { transaction, receipts: extraReceipts, activities, ftTransfers, providerName } = params;

    // 1. Map receipts (merge transaction + enriched receipts, prefer enriched data)
    const mergedReceiptsById = new Map<string, NearBlocksReceiptV2>();

    if (extraReceipts && extraReceipts.length > 0) {
      for (const receipt of extraReceipts) {
        mergedReceiptsById.set(receipt.receipt_id, receipt);
      }
    }

    if (transaction.receipts && transaction.receipts.length > 0) {
      for (const receipt of transaction.receipts) {
        if (!mergedReceiptsById.has(receipt.receipt_id)) {
          mergedReceiptsById.set(receipt.receipt_id, receipt);
        }
      }
    }

    const rawReceipts = Array.from(mergedReceiptsById.values());
    if (rawReceipts.length === 0) {
      logger.error(
        { transactionHash: transaction.transaction_hash },
        'Transaction has no receipts - this indicates incomplete data or a data integrity issue'
      );
      return err(
        new Error(
          `Transaction ${transaction.transaction_hash} has no receipts. ` +
            `Every NEAR transaction must have at least one receipt. This indicates incomplete enrichment data.`
        )
      );
    }

    const receiptResults = rawReceipts.map(mapNearBlocksReceipt);
    const failed = receiptResults.find((r) => r.isErr());
    if (failed?.isErr()) {
      return err(failed.error);
    }
    const mappedReceipts = receiptResults.map((r) => r._unsafeUnwrap());

    // 2. Map balance changes
    let balanceChanges: NearBalanceChange[] = [];
    if (activities && activities.length > 0) {
      const changeResults = activities.map(mapNearBlocksActivity);
      const failedChange = changeResults.find((r) => r.isErr());
      if (failedChange?.isErr()) {
        return err(failedChange.error);
      }
      balanceChanges = changeResults.map((r) => r._unsafeUnwrap());
    }

    // 3. Map token transfers
    let tokenTransfers: NearTokenTransfer[] = [];
    if (ftTransfers && ftTransfers.length > 0) {
      const transferResults = ftTransfers.map(mapNearBlocksFtTransaction);
      const failedTransfer = transferResults.find((r) => r.isErr());
      if (failedTransfer?.isErr()) {
        return err(failedTransfer.error);
      }
      tokenTransfers = transferResults.map((r) => r._unsafeUnwrap());
    }

    // 4. Correlate
    const balanceChangeMap = correlateBalanceChanges(mappedReceipts, balanceChanges);
    const tokenTransferMap = correlateTokenTransfers(mappedReceipts, tokenTransfers);

    // 5. Attach correlated data to receipts
    for (const receipt of mappedReceipts) {
      receipt.balanceChanges = balanceChangeMap.get(receipt.receiptId);
      receipt.tokenTransfers = tokenTransferMap.get(receipt.receiptId);
    }

    // 6. Generate events (one per receipt)
    const events: NearReceiptEvent[] = [];
    for (const receipt of mappedReceipts) {
      const eventResult = generateReceiptEvent(
        receipt,
        transaction.transaction_hash,
        transaction.signer_account_id,
        providerName
      );

      if (eventResult.isErr()) {
        return err(eventResult.error);
      }

      events.push(eventResult.value);
    }

    return ok(events);
  } catch (error) {
    return err(
      new Error(
        `Failed to map NearBlocks transaction to receipt events: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}
