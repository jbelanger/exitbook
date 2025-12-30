import type { NearReceiptEvent } from '@exitbook/blockchain-providers';
import type { OperationType } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import type { NearEventAnalysis, NearFundFlow, NearFundFlowInternal } from './types.v2.js';

const logger = getLogger('near-processor-utils-v2');

/**
 * NEAR native token decimals (1 NEAR = 10^24 yoctoNEAR)
 */
const NEAR_DECIMALS = 24;
const NEAR_SYMBOL = 'NEAR';

/**
 * Extract NEAR native token flows from balance changes (array)
 *
 * Rules:
 * - Positive delta = receive
 * - Negative delta = send
 * - Zero delta = no flow (just action execution)
 * - Multiple balance changes = multiple flows (one per account affected)
 *
 * Important: Deltas already include fee impact - do not subtract fee again
 */
export function extractNativeFlows(event: NearReceiptEvent, accountId: string): NearFundFlowInternal[] {
  const flows: NearFundFlowInternal[] = [];

  if (!event.balanceChanges || event.balanceChanges.length === 0) {
    return flows;
  }

  for (const change of event.balanceChanges) {
    const preBalance = new Decimal(change.preBalance);
    const postBalance = new Decimal(change.postBalance);
    const delta = postBalance.minus(preBalance);

    // Skip zero deltas
    if (delta.isZero()) {
      continue;
    }

    // Determine direction
    let direction: 'in' | 'out' | 'self';
    let from: string | undefined;
    let to: string | undefined;

    if (delta.isPositive()) {
      // Receive
      direction = 'in';
      to = change.accountId;
      from = undefined; // Source is implicit from the transaction context
    } else {
      // Send
      direction = 'out';
      from = change.accountId;
      to = undefined; // Destination is implicit from the transaction context
    }

    // Only emit flows for the queried account
    if (change.accountId !== accountId) {
      logger.debug(
        {
          receiptId: event.receiptId,
          changeAccountId: change.accountId,
          queriedAccountId: accountId,
        },
        'Skipping balance change for different account'
      );
      continue;
    }

    flows.push({
      receiptId: event.receiptId,
      transactionHash: event.id,
      flowType: 'native_balance_change',
      asset: NEAR_SYMBOL,
      amount: delta.abs().dividedBy(new Decimal(10).pow(NEAR_DECIMALS)), // Normalize from yoctoNEAR to NEAR
      decimals: NEAR_DECIMALS,
      from,
      to,
      direction,
      timestamp: event.timestamp,
    });
  }

  return flows;
}

/**
 * Extract NEP-141 token flows from token transfers (array)
 * One flow per token transfer
 */
export function extractTokenFlows(event: NearReceiptEvent, accountId: string): NearFundFlowInternal[] {
  const flows: NearFundFlowInternal[] = [];

  if (!event.tokenTransfers || event.tokenTransfers.length === 0) {
    return flows;
  }

  for (const transfer of event.tokenTransfers) {
    // Determine direction based on queried account
    let direction: 'in' | 'out' | 'self';

    if (transfer.from === accountId && transfer.to === accountId) {
      direction = 'self';
    } else if (transfer.from === accountId) {
      direction = 'out';
    } else if (transfer.to === accountId) {
      direction = 'in';
    } else {
      // Transfer doesn't involve queried account
      logger.warn(
        {
          receiptId: event.receiptId,
          from: transfer.from,
          to: transfer.to,
          accountId,
        },
        'Token transfer does not involve queried account'
      );
      continue;
    }

    flows.push({
      receiptId: event.receiptId,
      transactionHash: event.id,
      flowType: 'token_transfer',
      asset: transfer.symbol ?? transfer.contractId,
      amount: new Decimal(transfer.amount), // Amount already normalized by mapper
      decimals: transfer.decimals,
      from: transfer.from,
      to: transfer.to,
      direction,
      contractId: transfer.contractId,
      timestamp: event.timestamp,
    });
  }

  return flows;
}

/**
 * Extract fee flow from receipt fee metadata
 *
 * Fee is already computed in the event (from tokens_burnt)
 * This is informational - balance changes already reflect fee impact
 *
 * @returns Fee flow if queried account is the payer, undefined otherwise
 */
export function extractFeeFlow(event: NearReceiptEvent, accountId: string): NearFundFlowInternal | undefined {
  if (!event.fee) {
    return undefined;
  }

  // Only create a fee flow if the queried account is the payer
  if (event.fee.payer !== accountId) {
    return undefined;
  }

  return {
    receiptId: event.receiptId,
    transactionHash: event.id,
    flowType: 'fee',
    asset: NEAR_SYMBOL,
    amount: new Decimal(event.fee.amountYocto).dividedBy(new Decimal(10).pow(NEAR_DECIMALS)), // Normalize from yoctoNEAR to NEAR
    decimals: NEAR_DECIMALS,
    from: event.fee.payer,
    to: undefined, // Fees are burned
    direction: 'out',
    timestamp: event.timestamp,
  };
}

/**
 * Classify NEAR operation based on receipt actions and flows
 *
 * Classification logic:
 * - FunctionCall with ft_transfer method → transfer (token)
 * - FunctionCall with stake/unstake method → stake/unstake
 * - Transfer action + balance change → transfer (native)
 * - CreateAccount, DeleteAccount, Key actions → batch (admin operations)
 * - No balance change → batch (contract interaction)
 */
export function classifyNearOperation(event: NearReceiptEvent, flows: NearFundFlowInternal[]): OperationType {
  // Check actions for hints
  const actions = event.actions ?? [];
  const hasTransferAction = actions.some((a) => a.actionType === 'transfer');
  const hasFunctionCall = actions.some((a) => a.actionType === 'function_call');
  const hasCreateAccount = actions.some((a) => a.actionType === 'create_account');
  const hasDeleteAccount = actions.some((a) => a.actionType === 'delete_account');
  const hasKeyAction = actions.some((a) => a.actionType === 'add_key' || a.actionType === 'delete_key');

  // Check for specific function call methods
  const functionCallAction = actions.find((a) => a.actionType === 'function_call');
  const methodName = functionCallAction?.methodName?.toLowerCase() ?? '';

  // Check flows
  const hasTokenTransfer = flows.some((f) => f.flowType === 'token_transfer');
  const hasNativeTransfer = flows.some((f) => f.flowType === 'native_balance_change');

  // Classification
  if (hasTokenTransfer) {
    return 'transfer';
  }

  // Check 'unstake' before 'stake' to avoid misclassification
  if (methodName.includes('unstake')) {
    return 'unstake';
  }

  if (methodName.includes('stake')) {
    return 'stake';
  }

  if (hasCreateAccount || hasDeleteAccount || hasKeyAction) {
    return 'batch';
  }

  if (hasTransferAction && hasNativeTransfer) {
    return 'transfer';
  }

  if (hasFunctionCall) {
    return 'batch';
  }

  // Default: batch (generic contract interaction)
  return 'batch';
}

/**
 * Convert internal flow to schema-validated flow
 */
function toNearFundFlow(internal: NearFundFlowInternal): NearFundFlow {
  return {
    receiptId: internal.receiptId,
    transactionHash: internal.transactionHash,
    flowType: internal.flowType,
    asset: internal.asset,
    amount: internal.amount.toFixed(),
    decimals: internal.decimals,
    from: internal.from,
    to: internal.to,
    direction: internal.direction,
    contractId: internal.contractId,
    timestamp: internal.timestamp,
  };
}

/**
 * Analyze a NEAR event and extract fund flows
 *
 * Process:
 * 1. Determine operation type from receipt actions
 * 2. Extract balance changes (NEAR native)
 * 3. Extract token transfers (NEP-141)
 * 4. Calculate fees (tokens_burnt)
 * 5. Determine flow direction relative to queried account
 * 6. Classify operation
 */
export function analyzeNearEvent(event: NearReceiptEvent, accountId: string): Result<NearEventAnalysis, Error> {
  try {
    // Extract flows
    const nativeFlows = extractNativeFlows(event, accountId);
    const tokenFlows = extractTokenFlows(event, accountId);
    const feeFlow = extractFeeFlow(event, accountId);

    // Combine all flows
    const internalFlows = [...nativeFlows, ...tokenFlows];
    if (feeFlow) {
      internalFlows.push(feeFlow);
    }

    // Classify operation
    const operationType = classifyNearOperation(event, internalFlows);

    // Convert to validated flows
    const flows = internalFlows.map(toNearFundFlow);

    const analysis: NearEventAnalysis = {
      event,
      flows,
      operationType,
    };

    return ok(analysis);
  } catch (error) {
    return err(new Error(`Failed to analyze NEAR event: ${error instanceof Error ? error.message : String(error)}`));
  }
}
