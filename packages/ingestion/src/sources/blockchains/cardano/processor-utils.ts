import { type CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import { isZeroDecimal, parseDecimal, type Currency } from '@exitbook/foundation';
import { type Result, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { CardanoFundFlow, CardanoMovement } from './types.js';

const logger = getLogger('cardano-processor-utils');

interface AssetAccumulator {
  amount: Decimal;
  assetName?: string | undefined;
  decimals?: number | undefined;
  movementRole?: CardanoMovement['movementRole'];
  policyId?: string | undefined;
  symbol?: Currency | undefined;
}

type ConsolidationRole = NonNullable<CardanoMovement['movementRole']>;

function sumPrimaryOwnedAdaInputs(tx: CardanoTransaction, primaryAddress: string): Decimal {
  let total = parseDecimal('0');

  for (const input of tx.inputs) {
    if (input.address !== primaryAddress) {
      continue;
    }

    for (const assetAmount of input.amounts) {
      if (assetAmount.unit !== 'lovelace') {
        continue;
      }

      total = total.plus(parseDecimal(normalizeCardanoAmount(assetAmount.quantity, 6)));
    }
  }

  return total;
}

function sumUserOwnedAdaInputsAcrossProfile(
  tx: CardanoTransaction,
  userAddresses: string[]
): {
  userOwnedInputAddressCount: number;
  userOwnedTotalAdaInputAmount: Decimal;
} {
  const userAddressSet = new Set(userAddresses);
  const ownedInputAddresses = new Set<string>();
  let total = parseDecimal('0');

  for (const input of tx.inputs) {
    if (!userAddressSet.has(input.address)) {
      continue;
    }

    ownedInputAddresses.add(input.address);

    for (const assetAmount of input.amounts) {
      if (assetAmount.unit !== 'lovelace') {
        continue;
      }

      total = total.plus(parseDecimal(normalizeCardanoAmount(assetAmount.quantity, 6)));
    }
  }

  return {
    userOwnedInputAddressCount: ownedInputAddresses.size,
    userOwnedTotalAdaInputAmount: total,
  };
}

function sumWithdrawalAmount(tx: CardanoTransaction): Decimal {
  return (tx.withdrawals ?? []).reduce(
    (sum, withdrawal) => sum.plus(parseDecimal(withdrawal.amount)),
    parseDecimal('0')
  );
}

/**
 * Convert lovelace (smallest unit) to ADA
 * 1 ADA = 1,000,000 lovelace
 */
export function convertLovelaceToAda(lovelace: string): string {
  const lovelaceDecimal = parseDecimal(lovelace);
  return lovelaceDecimal.dividedBy(1_000_000).toFixed();
}

/**
 * Parse Cardano asset unit identifier
 * - ADA: 'lovelace'
 * - Native tokens: 'policyId' + 'assetName' (concatenated hex strings)
 */
export function parseCardanoAssetUnit(unit: string): {
  assetName?: string | undefined;
  isAda: boolean;
  policyId?: string | undefined;
} {
  if (unit === 'lovelace') {
    return { isAda: true };
  }

  // Native token format: policyId (56 hex chars) + optional assetName (hex)
  // Policy ID is always 56 characters (28 bytes in hex)
  if (unit.length >= 56) {
    const policyId = unit.slice(0, 56);
    const assetName = unit.length > 56 ? unit.slice(56) : undefined;

    return {
      assetName,
      isAda: false,
      policyId,
    };
  }

  // Fallback: treat as unknown token
  return {
    isAda: false,
    policyId: unit,
  };
}

/**
 * Consolidate duplicate assets by summing amounts
 */

export function consolidateCardanoMovements(movements: CardanoMovement[]): CardanoMovement[] {
  const assetMap = new Map<string, Map<ConsolidationRole, AssetAccumulator>>();

  for (const movement of movements) {
    const movementRole: ConsolidationRole = movement.movementRole ?? 'principal';
    const roleMap = assetMap.get(movement.unit) ?? new Map<ConsolidationRole, AssetAccumulator>();
    const existing = roleMap.get(movementRole);
    if (existing) {
      existing.amount = existing.amount.plus(parseDecimal(movement.amount));
    } else {
      roleMap.set(movementRole, {
        amount: parseDecimal(movement.amount),
        decimals: movement.decimals,
        policyId: movement.policyId,
        assetName: movement.assetName,
        movementRole: movement.movementRole,
        symbol: movement.asset,
      });
    }

    if (!assetMap.has(movement.unit)) {
      assetMap.set(movement.unit, roleMap);
    }
  }

  return Array.from(assetMap.entries()).flatMap(([unit, roleMap]) =>
    Array.from(roleMap.values()).map((data) => ({
      amount: data.amount.toFixed(),
      asset: (data.symbol || unit) as Currency,
      assetName: data.assetName,
      decimals: data.decimals,
      movementRole: data.movementRole,
      policyId: data.policyId,
      unit,
    }))
  );
}

/**
 * Normalize asset amount using decimals
 * For ADA (lovelace), decimals = 6 (1 ADA = 1,000,000 lovelace)
 * For native tokens, use provided decimals or default to 0 (no decimals)
 */
export function normalizeCardanoAmount(quantity: string, decimals: number | undefined): string {
  const quantityDecimal = parseDecimal(quantity);

  if (decimals === undefined || decimals === 0) {
    return quantityDecimal.toFixed();
  }

  const divisor = parseDecimal('10').pow(decimals);
  return quantityDecimal.dividedBy(divisor).toFixed();
}

/**
 * Analyze fund flow from normalized Cardano transaction data
 * Handles multi-asset UTXO model
 * Per-address UTXO model: only considers the single address being processed.
 */
export function analyzeCardanoFundFlow(
  tx: CardanoTransaction,
  context: AddressContext
): Result<CardanoFundFlow, Error> {
  const userAddress = context.primaryAddress;

  const inflows: CardanoMovement[] = [];
  const outflows: CardanoMovement[] = [];

  // Track wallet involvement in inputs/outputs
  let userOwnsInput = false;
  let userReceivesOutput = false;

  // Analyze inputs (assets being spent)
  for (const input of tx.inputs) {
    if (input.address !== userAddress) {
      continue;
    }

    userOwnsInput = true;

    for (const assetAmount of input.amounts) {
      const { isAda, policyId, assetName } = parseCardanoAssetUnit(assetAmount.unit);
      const decimals = isAda ? 6 : assetAmount.decimals;
      const normalizedAmount = normalizeCardanoAmount(assetAmount.quantity, decimals);

      if (isZeroDecimal(normalizedAmount)) {
        continue;
      }

      outflows.push({
        amount: normalizedAmount,
        asset: (isAda ? 'ADA' : assetAmount.symbol || assetAmount.unit) as Currency,
        assetName,
        decimals,
        policyId,
        unit: assetAmount.unit,
      });
    }
  }

  // Analyze outputs (assets being received)
  for (const output of tx.outputs) {
    if (output.address !== userAddress) {
      continue;
    }

    userReceivesOutput = true;

    for (const assetAmount of output.amounts) {
      const { isAda, policyId, assetName } = parseCardanoAssetUnit(assetAmount.unit);
      const decimals = isAda ? 6 : assetAmount.decimals;
      const normalizedAmount = normalizeCardanoAmount(assetAmount.quantity, decimals);

      if (isZeroDecimal(normalizedAmount)) {
        continue;
      }

      inflows.push({
        amount: normalizedAmount,
        asset: (isAda ? 'ADA' : assetAmount.symbol || assetAmount.unit) as Currency,
        assetName,
        decimals,
        policyId,
        unit: assetAmount.unit,
      });
    }
  }

  // Determine fee information
  // Fee is always paid in ADA and deducted from user's balance
  // feeAmount is already in ADA (converted from lovelace in the mapper)
  const chainFeeAmount = tx.feeAmount || '0';
  const feePaidByUser = userOwnsInput && !isZeroDecimal(chainFeeAmount);
  const primaryOwnedAdaInputAmount = sumPrimaryOwnedAdaInputs(tx, userAddress);
  const { userOwnedInputAddressCount, userOwnedTotalAdaInputAmount } = sumUserOwnedAdaInputsAcrossProfile(
    tx,
    context.userAddresses
  );
  let feeAmount = chainFeeAmount;

  if (feePaidByUser && userOwnedInputAddressCount > 1 && !userOwnedTotalAdaInputAmount.isZero()) {
    feeAmount = parseDecimal(chainFeeAmount)
      .times(primaryOwnedAdaInputAmount)
      .dividedBy(userOwnedTotalAdaInputAmount)
      .toFixed();
  }

  const withdrawalAmount = sumWithdrawalAmount(tx);
  let attributedWithdrawalAmount: string | undefined;
  let unattributedWithdrawalAmount: string | undefined;
  if (!withdrawalAmount.isZero() && userOwnsInput && userOwnedInputAddressCount <= 1) {
    inflows.push({
      amount: withdrawalAmount.toFixed(),
      asset: 'ADA' as Currency,
      decimals: 6,
      movementRole: 'staking_reward',
      unit: 'lovelace',
    });
    attributedWithdrawalAmount = withdrawalAmount.toFixed();
  } else if (!withdrawalAmount.isZero() && userOwnsInput && userOwnedInputAddressCount > 1) {
    unattributedWithdrawalAmount = withdrawalAmount.toFixed();
  }

  // Consolidate movements by asset after adding any withdrawal-derived inflows.
  const consolidatedInflows = consolidateCardanoMovements(inflows);
  const consolidatedOutflows = consolidateCardanoMovements(outflows);

  // ADR-005: For UTXO chains, preserve gross amounts (includes fee) in outflows.
  // The fee is recorded separately with settlement='on-chain', and the processor
  // will set netAmount = grossAmount - fee for ADA outflows.
  // Balance calculation subtracts grossAmount and ignores on-chain fees (already in gross).

  // Determine flow direction
  const isIncoming = userReceivesOutput && !userOwnsInput;
  const isOutgoing = userOwnsInput && !userReceivesOutput;

  // Determine primary addresses
  const fromAddress = isOutgoing
    ? tx.inputs.find((input) => input.address === userAddress)?.address
    : tx.inputs[0]?.address;

  const toAddress = isIncoming
    ? tx.outputs.find((output) => output.address === userAddress)?.address
    : tx.outputs[0]?.address;

  // Select primary asset (largest movement by amount, prioritizing inflows)
  const compareByAmountDescending = (a: CardanoMovement, b: CardanoMovement): number => {
    try {
      return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
    } catch (error) {
      logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
      return 0;
    }
  };

  const largestInflow = consolidatedInflows
    .sort(compareByAmountDescending)
    .find((inflow) => !isZeroDecimal(inflow.amount));

  const largestOutflow = consolidatedOutflows
    .sort(compareByAmountDescending)
    .find((outflow) => !isZeroDecimal(outflow.amount));

  const primaryMovement = largestInflow ?? largestOutflow;
  const primary: CardanoMovement = primaryMovement
    ? { ...primaryMovement }
    : { amount: '0', asset: 'ADA' as Currency, unit: 'lovelace' };

  // Track uncertainty for complex transactions
  const classificationNotes: string[] = [];
  if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
    classificationNotes.push(
      `Complex multi-asset transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be a token swap or batch operation.`
    );
  }

  if (!withdrawalAmount.isZero() && userOwnsInput && userOwnedInputAddressCount > 1) {
    classificationNotes.push(
      `Cardano transaction includes wallet-scoped staking withdrawal of ${withdrawalAmount.toFixed()} ADA that cannot be attributed to a single derived address in the current per-address projection.`
    );
  }

  const fundFlow: CardanoFundFlow = {
    attributedWithdrawalAmount,
    unattributedWithdrawalAmount,
    classificationUncertainty: classificationNotes.length > 0 ? classificationNotes.join(' ') : undefined,
    feeAmount,
    feeCurrency: 'ADA' as Currency,
    feePaidByUser,
    fromAddress,
    inflows: consolidatedInflows,
    inputCount: tx.inputs.length,
    isIncoming,
    isOutgoing,
    outflows: consolidatedOutflows,
    outputCount: tx.outputs.length,
    primary,
    toAddress,
  };

  return ok(fundFlow);
}

/**
 * Determine transaction type from fund flow analysis
 * Per-address UTXO model: returns generic 'transfer' type.
 *
 * Without derivedAddresses, we can't reliably distinguish:
 * - External deposit vs internal change receipt
 * - External withdrawal vs internal send to sibling address
 *
 * Solution: Use generic 'transfer' type for all UTXO movements.
 * Transaction linking can later provide semantic classification if needed.
 *
 * Note: operation_type is display metadata only - doesn't affect balance/cost basis calculations.
 */
export function determineCardanoTransactionType(_fundFlow: CardanoFundFlow): 'transfer' {
  return 'transfer';
}
