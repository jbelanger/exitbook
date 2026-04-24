import { type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import type { MovementRole, OperationClassification, TransactionDiagnostic } from '@exitbook/core';
import { fromBaseUnitsToDecimalString, isZeroDecimal, parseDecimal, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { AddressContext } from '../../../shared/types/processors.js';
import { collapseReturnedInputAssetSwapRefund } from '../shared/account-based-swap-refund-utils.js';

import type { EvmFundFlow, EvmMovement } from './types.js';

const logger = getLogger('evm-processor-utils');
const EVM_BRIDGE_FUNCTION_HINTS: Record<
  string,
  {
    bridgeFamily: string;
    message: string;
  }
> = {
  bridgeerc20: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack bridgeERC20.',
  },
  bridgeerc20to: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack bridgeERC20To.',
  },
  bridgeeth: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack bridgeETH.',
  },
  bridgeethto: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack bridgeETHTo.',
  },
  depositerc20: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack depositERC20.',
  },
  depositerc20to: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack depositERC20To.',
  },
  depositeth: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack depositETH.',
  },
  depositethto: {
    bridgeFamily: 'op_stack_standard_bridge',
    message: 'Potential bridge transfer via OP Stack depositETHTo.',
  },
  depositforburn: {
    bridgeFamily: 'cctp',
    message: 'Potential bridge transfer via CCTP depositForBurn.',
  },
  depositforburnwithcaller: {
    bridgeFamily: 'cctp',
    message: 'Potential bridge transfer via CCTP depositForBurnWithCaller.',
  },
  outboundtransfer: {
    bridgeFamily: 'arbitrum_bridge',
    message: 'Potential bridge transfer via Arbitrum outboundTransfer.',
  },
  outboundtransfercustomrefund: {
    bridgeFamily: 'arbitrum_bridge',
    message: 'Potential bridge transfer via Arbitrum outboundTransferCustomRefund.',
  },
  sendtoinjective: {
    bridgeFamily: 'injective_peggy',
    message: 'Potential bridge transfer via Injective sendToInjective.',
  },
  transfertokenswithpayload: {
    bridgeFamily: 'wormhole',
    message: 'Potential bridge transfer via Wormhole transferTokensWithPayload.',
  },
};

const EVM_APPROVAL_FUNCTION_NAMES = new Set([
  'approve',
  'decreaseallowance',
  'increaseallowance',
  'permit',
  'setapprovalforall',
]);
const EVM_APPROVAL_METHOD_IDS = new Set([
  '0x095ea7b3', // ERC-20/ERC-721 approve(address,uint256)
  '0xa22cb465', // ERC-721/ERC-1155 setApprovalForAll(address,bool)
  '0x39509351', // ERC-20 increaseAllowance(address,uint256)
  '0xa457c2d7', // ERC-20 decreaseAllowance(address,uint256)
  '0xd505accf', // EIP-2612 permit(...)
]);

export interface AccountBasedNativeCurrencyConfig {
  nativeCurrency: Currency;
  nativeDecimals: number;
}

/**
 * Tax Classification Rules
 */

/**
 * 32 ETH threshold for classifying beacon withdrawals.
 * - Withdrawals >= 32 ETH: Likely full validator withdrawal (principal return, non-taxable)
 * - Withdrawals < 32 ETH: Likely partial withdrawal (staking rewards, taxable income)
 *
 * Referenced in Product Decision #1
 */
const BEACON_WITHDRAWAL_PRINCIPAL_THRESHOLD = parseDecimal('32');

interface BeaconWithdrawalSemantics {
  diagnostics: NonNullable<OperationClassification['diagnostics']>;
  isPrincipalReturn: boolean;
  movementRole?: MovementRole | undefined;
}

interface EvmMovementAccumulator {
  amount: Decimal;
  movementRole?: MovementRole | undefined;
  tokenAddress?: string | undefined;
  tokenDecimals?: number | undefined;
}

/**
 * Consolidates duplicate assets by summing amounts for the same asset.
 *
 * Pure function that merges multiple movements of the same asset into a single movement
 * with the combined amount. Preserves token metadata (address and decimals) from the
 * first occurrence of each asset.
 */
export function consolidateEvmMovementsByAsset(movements: EvmMovement[]): EvmMovement[] {
  const assetMap = new Map<string, Map<MovementRole, EvmMovementAccumulator>>();

  for (const movement of movements) {
    const movementRole = movement.movementRole ?? 'principal';
    const roleMap = assetMap.get(movement.asset) ?? new Map<MovementRole, EvmMovementAccumulator>();
    const existing = roleMap.get(movementRole);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      roleMap.set(movementRole, {
        amount: parseDecimal(movement.amount),
        movementRole: movement.movementRole,
        tokenAddress: movement.tokenAddress,
        tokenDecimals: movement.tokenDecimals,
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
      movementRole: data.movementRole,
      tokenAddress: data.tokenAddress,
      tokenDecimals: data.tokenDecimals,
    }))
  );
}

/**
 * Selects the primary asset movement from a list of movements.
 *
 * Pure function that prioritizes the largest non-zero movement. Used to provide a simplified
 * summary of complex multi-asset transactions by identifying the most significant asset flow.
 *
 * Returns a zero-amount native currency movement if no non-zero movements are found.
 */
export function selectPrimaryEvmMovement(movements: EvmMovement[], nativeCurrency: Currency): EvmMovement {
  let largestMovement: EvmMovement | undefined;
  let largestAmount: Decimal | undefined;

  for (const movement of movements) {
    try {
      const amount = parseDecimal(movement.amount || '0');
      if (amount.isZero()) {
        continue;
      }

      if (largestAmount === undefined || amount.greaterThan(largestAmount)) {
        largestMovement = movement;
        largestAmount = amount;
      }
    } catch (error) {
      logger.warn(
        { error, movement },
        'Failed to parse amount while selecting primary EVM movement, excluding movement'
      );
    }
  }

  // Fallback to native currency with zero amount if no non-zero movements found
  return largestMovement ?? { asset: nativeCurrency, amount: '0' };
}

/**
 * Determines transaction operation classification based purely on fund flow structure.
 *
 * Pure function that applies pattern matching rules to classify transactions.
 * Only classifies patterns we're confident about - complex cases receive informational diagnostics.
 *
 * Pattern matching rules:
 * 0. Beacon withdrawal (Ethereum consensus layer withdrawal with 32 ETH threshold)
 * 1. Contract interaction with zero value (approvals, staking, state changes)
 * 2. Fee-only transaction (zero value with no fund movements)
 * 3. Single asset swap (one asset out, different asset in)
 * 4. Simple deposit (only inflows, no outflows)
 * 5. Simple withdrawal (only outflows, no inflows)
 * 6. Self-transfer (same asset in and out)
 * 7. Complex multi-asset transaction (multiple inflows/outflows - uncertain)
 */
export function determineEvmOperationFromFundFlow(
  fundFlow: EvmFundFlow,
  txGroup: EvmTransaction[]
): OperationClassification {
  const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const beaconSemantics = getBeaconWithdrawalSemantics(txGroup, amount);
  if (beaconSemantics) {
    return {
      operation: {
        category: 'staking',
        type: beaconSemantics.isPrincipalReturn ? 'deposit' : 'reward',
      },
      diagnostics: beaconSemantics.diagnostics,
    };
  }

  const ledgerCueDiagnostics = detectEvmLedgerCueDiagnostics(txGroup, fundFlow);
  const classification = determineAccountBasedOperationFromFundFlow(fundFlow);
  if (ledgerCueDiagnostics.length === 0) {
    return classification;
  }

  return {
    ...classification,
    diagnostics: classification.diagnostics
      ? [...ledgerCueDiagnostics, ...classification.diagnostics]
      : [...ledgerCueDiagnostics],
  };
}

function detectEvmLedgerCueDiagnostics(
  txGroup: readonly EvmTransaction[],
  fundFlow: Pick<EvmFundFlow, 'inflows' | 'outflows'>
): TransactionDiagnostic[] {
  return [detectEvmApprovalDiagnostic(txGroup, fundFlow), detectEvmBridgeDiagnostic(txGroup, fundFlow)].filter(
    (diagnostic): diagnostic is TransactionDiagnostic => diagnostic !== undefined
  );
}

function detectEvmApprovalDiagnostic(
  txGroup: readonly EvmTransaction[],
  fundFlow: Pick<EvmFundFlow, 'inflows' | 'outflows'>
): TransactionDiagnostic | undefined {
  if (fundFlow.inflows.length > 0 || fundFlow.outflows.length > 0) {
    return undefined;
  }

  const approvalTx = txGroup.find(isEvmApprovalTransaction);
  if (!approvalTx) {
    return undefined;
  }

  return {
    code: 'token_approval',
    message: 'Token approval transaction. Ledger impact is network fee only.',
    metadata: {
      detectionSource: EVM_APPROVAL_METHOD_IDS.has(approvalTx.methodId?.toLowerCase() ?? '')
        ? 'method_id'
        : 'function_name',
      functionName: approvalTx.functionName,
      methodId: approvalTx.methodId,
    },
    severity: 'info',
  };
}

function isEvmApprovalTransaction(tx: EvmTransaction): boolean {
  const methodId = tx.methodId?.toLowerCase();
  if (methodId && EVM_APPROVAL_METHOD_IDS.has(methodId)) {
    return true;
  }

  const functionName = normalizeEvmFunctionName(tx.functionName);
  return functionName !== undefined && EVM_APPROVAL_FUNCTION_NAMES.has(functionName);
}

function detectEvmBridgeDiagnostic(
  txGroup: readonly EvmTransaction[],
  fundFlow: Pick<EvmFundFlow, 'inflows' | 'outflows'>
): TransactionDiagnostic | undefined {
  const hasOneSidedValueFlow =
    (fundFlow.outflows.length > 0 && fundFlow.inflows.length === 0) ||
    (fundFlow.inflows.length > 0 && fundFlow.outflows.length === 0);
  if (!hasOneSidedValueFlow) {
    return undefined;
  }

  for (const tx of txGroup) {
    const normalizedFunctionName = normalizeEvmFunctionName(tx.functionName);
    if (!normalizedFunctionName) {
      continue;
    }

    const bridgeHint = EVM_BRIDGE_FUNCTION_HINTS[normalizedFunctionName];
    if (!bridgeHint) {
      continue;
    }

    return {
      code: 'bridge_transfer',
      message: bridgeHint.message,
      metadata: {
        bridgeFamily: bridgeHint.bridgeFamily,
        detectionSource: 'function_name',
        functionName: tx.functionName,
      },
      severity: 'info',
    };
  }

  return undefined;
}

function normalizeEvmFunctionName(functionName: string | undefined): string | undefined {
  const normalized = functionName?.toLowerCase().replace(/\(.*\)/, '');
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function determineAccountBasedOperationFromFundFlow(fundFlow: EvmFundFlow): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const isZero = amount.isZero();

  // Pattern 1: Contract interaction with zero value
  // Approvals, staking operations, state changes - classified as transfer with note
  if (isZero && (fundFlow.hasContractInteraction || fundFlow.hasTokenTransfers)) {
    return {
      diagnostics: [
        {
          message: `Contract interaction with zero value. May be approval, staking, or other state change.`,
          metadata: {
            hasContractInteraction: fundFlow.hasContractInteraction,
            hasTokenTransfers: fundFlow.hasTokenTransfers,
          },
          severity: 'info',
          code: 'contract_interaction',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 2: Fee-only transaction
  // Zero value with NO fund movements at all
  if (isZero && inflows.length === 0 && outflows.length === 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 3: Single asset swap
  // One asset out, different asset in
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

  // Pattern 4: Simple deposit
  // Only inflows, no outflows (can be multiple assets)
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 5: Simple withdrawal
  // Only outflows, no inflows (can be multiple assets)
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 6: Self-transfer
  // Same asset in and out
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

  // Pattern 7: Complex multi-asset transaction (UNCERTAIN - add diagnostic)
  // Multiple inflows or outflows - could be LP, batch, multi-swap
  if (fundFlow.classificationUncertainty) {
    return {
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
    };
  }

  // Ultimate fallback: Couldn't match any confident pattern
  return {
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
  };
}

/**
 * Groups EVM transactions by their hash.
 *
 * Pure function that organizes transactions into groups based on their transaction ID.
 * Multiple events (token transfers, internal transactions) from the same on-chain transaction
 * share the same hash and are grouped together for correlation.
 *
 * Returns a Map where keys are transaction hashes and values are arrays of correlated transactions.
 * Transactions without an ID are skipped.
 */
export function groupEvmTransactionsByHash(transactions: EvmTransaction[]): Map<string, EvmTransaction[]> {
  const groups = new Map<string, EvmTransaction[]>();

  for (const tx of transactions) {
    if (!tx?.id) {
      continue;
    }

    if (!groups.has(tx.id)) {
      groups.set(tx.id, []);
    }

    groups.get(tx.id)!.push(tx);
  }

  return groups;
}

/**
 * Analyzes fund flow from a normalized transaction group.
 *
 * Pure function that examines all transactions in a correlated group and determines:
 * - All inflows (assets received by the user)
 * - All outflows (assets sent by the user)
 * - Primary asset (largest movement for simplified display)
 * - Transaction complexity (token transfers, internal transactions, contract interactions)
 * - Network fees
 *
 * This is the core business logic for EVM transaction processing - 214 lines of complex analysis
 * that transforms raw blockchain events into structured fund flow data.
 */
export function analyzeEvmFundFlow(
  txGroup: EvmTransaction[],
  context: AddressContext,
  chainConfig: AccountBasedNativeCurrencyConfig
): Result<EvmFundFlow, Error> {
  if (txGroup.length === 0) {
    return err(new Error('Empty transaction group'));
  }

  // Address is already normalized by blockchain-specific schemas
  const userAddress = context.primaryAddress;

  // Analyze transaction group complexity - essential for proper EVM classification
  const hasTokenTransfers = txGroup.some((tx) => tx.type === 'token_transfer');
  const hasInternalTransactions = txGroup.some((tx) => tx.type === 'internal');
  const hasContractInteraction = txGroup.some(
    (tx) =>
      tx.type === 'contract_call' ||
      Boolean(tx.methodId) || // Has function selector (0x12345678)
      Boolean(tx.functionName) // Function name decoded by provider
  );

  // Collect ALL assets that flow in/out (not just pick one as primary)
  const inflows: EvmMovement[] = [];
  const outflows: EvmMovement[] = [];

  const addressState = { fromAddress: '', toAddress: undefined as string | undefined };

  // Process all token transfers involving the user
  for (const tx of txGroup) {
    if (tx.type === 'token_transfer' && isEvmUserParticipant(tx, userAddress)) {
      const tokenSymbol = (tx.tokenSymbol || tx.currency || 'UNKNOWN') as Currency;
      const rawAmount = tx.amount ?? '0';

      // Normalize token amount using decimals metadata
      // All providers return amounts in smallest units; normalization ensures consistency and safety
      const amountResult = fromBaseUnitsToDecimalString(rawAmount, tx.tokenDecimals);
      if (amountResult.isErr()) {
        return err(
          `Failed to normalize EVM token amount for transaction ${tx.id}: ${amountResult.error.message}. ` +
            `Raw amount: ${rawAmount}, decimals: ${tx.tokenDecimals}, token: ${tokenSymbol}`
        );
      }
      const amount = amountResult.value;

      if (isZeroDecimal(amount)) {
        continue;
      }

      const fromMatches = matchesEvmAddress(tx.from, userAddress);
      const toMatches = matchesEvmAddress(tx.to, userAddress);
      const movement: EvmMovement = {
        amount,
        asset: tokenSymbol,
        tokenAddress: tx.tokenAddress,
        tokenDecimals: tx.tokenDecimals,
      };

      // For self-transfers (user -> user), track both inflow and outflow
      if (fromMatches && toMatches) {
        inflows.push(movement);
        outflows.push({ ...movement });
      } else {
        if (toMatches) inflows.push(movement);
        if (fromMatches) outflows.push(movement);
      }

      updateAddressTracking(tx, fromMatches, toMatches, addressState);
    }
  }

  // Process all native currency movements involving the user
  for (const tx of txGroup) {
    if (isEvmNativeMovement(tx, chainConfig) && isEvmUserParticipant(tx, userAddress)) {
      const normalizedAmountResult = fromBaseUnitsToDecimalString(tx.amount, chainConfig.nativeDecimals);
      if (normalizedAmountResult.isErr()) {
        return err(
          `Failed to normalize EVM native amount for transaction ${tx.id}: ${normalizedAmountResult.error.message}. ` +
            `Raw amount: ${tx.amount}, decimals: ${chainConfig.nativeDecimals}, currency: ${chainConfig.nativeCurrency}`
        );
      }
      const normalizedAmount = normalizedAmountResult.value;

      if (isZeroDecimal(normalizedAmount)) {
        continue;
      }

      const fromMatches = matchesEvmAddress(tx.from, userAddress);
      const toMatches = matchesEvmAddress(tx.to, userAddress);
      const movement: EvmMovement = { amount: normalizedAmount, asset: chainConfig.nativeCurrency };

      // For self-transfers (user -> user), track both inflow and outflow
      if (fromMatches && toMatches) {
        inflows.push(movement);
        outflows.push({ ...movement });
      } else {
        if (toMatches) inflows.push(movement);
        if (fromMatches) outflows.push(movement);
      }

      updateAddressTracking(tx, fromMatches, toMatches, addressState);
    }
  }

  // Final fallback: use first transaction to populate addresses
  const primaryTx = txGroup[0];
  if (primaryTx) {
    if (!addressState.fromAddress) addressState.fromAddress = primaryTx.from;
    if (!addressState.toAddress) addressState.toAddress = primaryTx.to;
  }

  const { fromAddress, toAddress } = addressState;

  // Consolidate duplicate assets (sum amounts for same asset)
  const consolidatedMovements = collapseReturnedInputAssetSwapRefund({
    enabled: hasInternalTransactions && hasTokenTransfers,
    inflows: consolidateEvmMovementsByAsset(inflows),
    outflows: consolidateEvmMovementsByAsset(outflows),
  });
  const consolidatedInflows = consolidatedMovements.inflows;
  const consolidatedOutflows = consolidatedMovements.outflows;

  const beaconAmount =
    consolidatedInflows.length === 1 && consolidatedOutflows.length === 0
      ? parseDecimal(consolidatedInflows[0]!.amount).abs()
      : undefined;
  const beaconSemantics = beaconAmount !== undefined ? getBeaconWithdrawalSemantics(txGroup, beaconAmount) : undefined;

  if (beaconSemantics?.movementRole) {
    for (const movement of consolidatedInflows) {
      movement.movementRole = beaconSemantics.movementRole;
    }
  }

  // Select primary asset for simplified consumption and single-asset display
  // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
  const primaryFromInflows = selectPrimaryEvmMovement(consolidatedInflows, chainConfig.nativeCurrency);

  const primary: EvmMovement =
    primaryFromInflows && !isZeroDecimal(primaryFromInflows.amount)
      ? primaryFromInflows
      : selectPrimaryEvmMovement(consolidatedOutflows, chainConfig.nativeCurrency) || {
          asset: chainConfig.nativeCurrency,
          amount: '0',
        };

  // Get fee from the parent transaction (NOT from token_transfer events)
  // A single on-chain transaction has only ONE fee, but providers may duplicate it across
  // the parent transaction and child events (token transfers, internal calls).
  // CRITICAL: Prioritize transactions with a NON-ZERO feeAmount. Some providers
  // (like Routescan) may include internal transactions without fee fields, and others
  // (like Moralis) explicitly set internal feeAmount to "0". Array ordering isn't
  // guaranteed, so we must pick the fee-bearing event first.
  const feeSourceTx =
    txGroup.find((tx) => tx.type !== 'token_transfer' && tx.feeAmount && !isZeroDecimal(tx.feeAmount)) || // Parent tx WITH non-zero fee
    txGroup.find((tx) => tx.type !== 'token_transfer' && tx.feeAmount) || // Parent tx WITH fee field (possibly zero)
    txGroup.find((tx) => tx.type !== 'token_transfer') || // Any parent transaction
    txGroup[0]; // Fallback
  const feeWei = feeSourceTx?.feeAmount ? parseDecimal(feeSourceTx.feeAmount) : parseDecimal('0');
  const feeAmount = feeWei.dividedBy(parseDecimal('10').pow(chainConfig.nativeDecimals)).toFixed();

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be liquidity provision, batch operation, or multi-asset swap.`;
  }

  return ok({
    classificationUncertainty,
    feeAmount,
    feeCurrency: chainConfig.nativeCurrency,
    feePayerAddress: feeSourceTx?.from,
    fromAddress,
    hasContractInteraction,
    hasInternalTransactions,
    hasTokenTransfers,
    inflows: consolidatedInflows,
    outflows: consolidatedOutflows,
    primary,
    toAddress,
    transactionCount: txGroup.length,
  });
}

function getBeaconWithdrawalSemantics(
  txGroup: EvmTransaction[],
  amount: Decimal
): BeaconWithdrawalSemantics | undefined {
  const beaconTx = txGroup.find((tx) => tx.type === 'beacon_withdrawal');
  if (!beaconTx) {
    return undefined;
  }

  const isPrincipalReturn = amount.gte(BEACON_WITHDRAWAL_PRINCIPAL_THRESHOLD);
  const withdrawalMetadata: Record<string, unknown> = {
    amount: amount.toFixed(),
    needsReview: isPrincipalReturn,
    taxClassification: isPrincipalReturn ? 'non-taxable (principal return)' : 'taxable (income)',
  };

  if (beaconTx.withdrawalIndex !== undefined) {
    withdrawalMetadata['withdrawalIndex'] = beaconTx.withdrawalIndex;
  }
  if (beaconTx.validatorIndex !== undefined) {
    withdrawalMetadata['validatorIndex'] = beaconTx.validatorIndex;
  }
  if (beaconTx.blockHeight !== undefined) {
    withdrawalMetadata['blockHeight'] = beaconTx.blockHeight;
  }

  return {
    diagnostics: [
      {
        code: 'consensus_withdrawal',
        message: isPrincipalReturn
          ? 'Full withdrawal (≥32 ETH) - likely principal return. Verify if rewards are included.'
          : 'Partial withdrawal (<32 ETH) - staking reward',
        severity: isPrincipalReturn ? 'warning' : 'info',
        metadata: withdrawalMetadata,
      },
    ],
    isPrincipalReturn,
    movementRole: isPrincipalReturn ? undefined : 'staking_reward',
  };
}

/**
 * Selects the primary transaction from a correlated group.
 *
 * Pure function that chooses the most representative transaction for event_id and metadata.
 * Prioritizes token transfers when present, then follows a preferred order of transaction types.
 */
export function selectPrimaryEvmTransaction(
  txGroup: EvmTransaction[],
  fundFlow: EvmFundFlow
): EvmTransaction | undefined {
  if (fundFlow.hasTokenTransfers) {
    const tokenTx = txGroup.find((tx) => tx.type === 'token_transfer');
    if (tokenTx) {
      return tokenTx;
    }
  }

  const preferredOrder: EvmTransaction['type'][] = ['transfer', 'contract_call', 'internal'];

  for (const type of preferredOrder) {
    const match = txGroup.find((tx) => tx.type === type);
    if (match) {
      return match;
    }
  }

  return txGroup[0];
}

/**
 * Checks if an address matches the target address.
 *
 * Pure function for case-sensitive address comparison.
 * Addresses should already be normalized to lowercase via EvmAddressSchema.
 */
function matchesEvmAddress(address: string | undefined, target: string): boolean {
  return address ? address === target : false;
}

/**
 * Checks if the user is a participant in the transaction.
 *
 * Pure function that returns true if the user is either the sender or receiver.
 */
function isEvmUserParticipant(tx: EvmTransaction, userAddress: string): boolean {
  return matchesEvmAddress(tx.from, userAddress) || matchesEvmAddress(tx.to, userAddress);
}

/**
 * Checks if a transaction represents a native currency movement.
 *
 * Pure function that determines if the transaction involves the chain's native currency
 * (ETH, MATIC, etc.) rather than a token.
 */
function isEvmNativeMovement(tx: EvmTransaction, chainConfig: AccountBasedNativeCurrencyConfig): boolean {
  const native = chainConfig.nativeCurrency.toLowerCase();
  return tx.currency.toLowerCase() === native || tx.tokenSymbol?.toLowerCase() === native;
}

/**
 * Updates address tracking variables based on transaction participants.
 * Prefers setting fromAddress/toAddress when the user is the matching party.
 */
function updateAddressTracking(
  tx: { from: string; to?: string | undefined },
  fromMatches: boolean,
  toMatches: boolean,
  state: { fromAddress: string; toAddress: string | undefined }
): void {
  if (!state.fromAddress && fromMatches) state.fromAddress = tx.from;
  if (!state.toAddress && toMatches) state.toAddress = tx.to;
  if (!state.fromAddress) state.fromAddress = tx.from;
  if (!state.toAddress) state.toAddress = tx.to;
}
