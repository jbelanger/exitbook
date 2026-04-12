import { type NearBalanceChangeCause, type NearTokenTransfer } from '@exitbook/blockchain-providers/near';
import type { MovementRole } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type { NearReceipt } from './types.js';

const logger = getLogger('near-fund-flow-extraction');

const NEAR_DECIMALS = 24;
const FEE_MISMATCH_THRESHOLD_PERCENT = 1;
const FEE_CAUSES = new Set<NearBalanceChangeCause>(['FEE', 'GAS', 'GAS_REFUND']);

function normalizeNearAmount(yoctoAmount: Decimal | string): Decimal {
  return new Decimal(yoctoAmount).dividedBy(new Decimal(10).pow(NEAR_DECIMALS));
}

function normalizeNearTokenAmount(rawAmount: Decimal | string, decimals: number): Decimal {
  return new Decimal(rawAmount).dividedBy(new Decimal(10).pow(decimals));
}

export interface NearFlowMovement {
  asset: Currency;
  amount: Decimal;
  contractAddress?: string | undefined;
  direction: 'in' | 'out';
  flowType: 'native' | 'token_transfer' | 'fee' | 'unknown';
  movementRole?: MovementRole | undefined;
}

interface NearFlowAccumulator {
  amount: Decimal;
  contractAddress?: string | undefined;
  direction: 'in' | 'out';
  flowType: 'native' | 'token_transfer' | 'fee' | 'unknown';
  movementRole?: MovementRole | undefined;
  asset: Currency;
}

interface FeeExtractionResult {
  movements: NearFlowMovement[];
  warning?: string | undefined;
  source?: 'receipt' | 'balance-change' | undefined;
}

export function extractReceiptFees(receipt: NearReceipt, primaryAddress: string): FeeExtractionResult {
  let receiptFee: Decimal | undefined;
  let balanceChangeFee: Decimal | undefined;
  const isPrimaryPayer = receipt.predecessorAccountId === primaryAddress;

  if (receipt.gasBurnt && receipt.tokensBurntYocto) {
    const tokensBurnt = new Decimal(receipt.tokensBurntYocto);
    if (!tokensBurnt.isZero()) {
      receiptFee = normalizeNearAmount(tokensBurnt);
    }
  }

  const feeActivities = (receipt.balanceChanges ?? []).filter(
    (balanceChange) => FEE_CAUSES.has(balanceChange.cause) && balanceChange.affectedAccountId === primaryAddress
  );

  if (feeActivities.length > 0) {
    let totalFee = parseDecimal('0');
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

  let warning: string | undefined;
  if (receiptFee && balanceChangeFee && isPrimaryPayer) {
    const diff = receiptFee.minus(balanceChangeFee).abs();
    const percentDiff = diff.dividedBy(receiptFee).times(100);

    if (percentDiff.greaterThan(FEE_MISMATCH_THRESHOLD_PERCENT)) {
      warning =
        `Fee mismatch for receipt ${receipt.receiptId}: ` +
        `receipt tokensBurnt=${receiptFee.toFixed()} NEAR vs ` +
        `balance changes=${balanceChangeFee.toFixed()} NEAR ` +
        `(${percentDiff.toFixed(2)}% difference). Using receipt value as authoritative.`;
    }
  }

  if (receiptFee && isPrimaryPayer) {
    return {
      movements: [
        {
          asset: 'NEAR' as Currency,
          amount: receiptFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'receipt',
    };
  }

  if (balanceChangeFee) {
    return {
      movements: [
        {
          asset: 'NEAR' as Currency,
          amount: balanceChangeFee,
          direction: 'out',
          flowType: 'fee',
        },
      ],
      warning,
      source: 'balance-change',
    };
  }

  return { movements: [] };
}

export function extractFlows(receipt: NearReceipt, primaryAddress: string): NearFlowMovement[] {
  const movements: NearFlowMovement[] = [];

  for (const activity of receipt.balanceChanges ?? []) {
    if (activity.affectedAccountId !== primaryAddress) {
      continue;
    }
    if (FEE_CAUSES.has(activity.cause)) {
      continue;
    }
    if (!activity.deltaAmountYocto) {
      continue;
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
      asset: 'NEAR' as Currency,
      amount: normalizedAmount,
      direction,
      flowType: 'native',
      movementRole: deriveNearNativeMovementRole(receipt, activity.cause, direction),
    });
  }

  return movements;
}

export function extractTokenTransferFlows(
  tokenTransfers: NearTokenTransfer[],
  primaryAddress: string
): NearFlowMovement[] {
  const movements: NearFlowMovement[] = [];

  for (const transfer of tokenTransfers) {
    if (!transfer.deltaAmountYocto) {
      continue;
    }

    const delta = new Decimal(transfer.deltaAmountYocto);
    if (delta.isZero()) {
      continue;
    }

    const direction = transfer.affectedAccountId === primaryAddress ? 'in' : 'out';
    const normalizedAmount = normalizeNearTokenAmount(delta.abs(), transfer.decimals);

    movements.push({
      asset: (transfer.symbol || 'UNKNOWN') as Currency,
      amount: normalizedAmount,
      contractAddress: transfer.contractAddress,
      direction,
      flowType: 'token_transfer',
    });
  }

  return movements;
}

export function consolidateByAsset(movements: NearFlowMovement[]): Map<string, NearFlowMovement> {
  const consolidated = new Map<string, Map<MovementRole, NearFlowAccumulator>>();

  for (const movement of movements) {
    const assetKey = movement.contractAddress || movement.asset;
    const movementRole = movement.movementRole ?? 'principal';
    const roleMap = consolidated.get(assetKey) ?? new Map<MovementRole, NearFlowAccumulator>();
    const existing = roleMap.get(movementRole);
    if (existing) {
      existing.amount = existing.amount.plus(movement.amount);
    } else {
      roleMap.set(movementRole, { ...movement });
    }

    if (!consolidated.has(assetKey)) {
      consolidated.set(assetKey, roleMap);
    }
  }

  return new Map(
    Array.from(consolidated.entries()).flatMap(([assetKey, roleMap]) =>
      Array.from(roleMap.values()).map((movement) => [
        buildConsolidatedNearMovementKey(assetKey, movement.movementRole),
        movement,
      ])
    )
  );
}

function buildConsolidatedNearMovementKey(assetKey: string, movementRole?: MovementRole  ): string {
  const normalizedRole = movementRole ?? 'principal';
  return normalizedRole === 'principal' ? assetKey : `${assetKey}::${normalizedRole}`;
}

function deriveNearNativeMovementRole(
  receipt: NearReceipt,
  cause: NearBalanceChangeCause,
  direction: 'in' | 'out'
): MovementRole | undefined {
  if (receipt.isSynthetic) {
    return undefined;
  }

  if (direction === 'in' && cause === 'CONTRACT_REWARD') {
    return 'staking_reward';
  }

  return undefined;
}

export function isFeeOnlyFromOutflows(
  consolidatedInflows: NearFlowMovement[],
  consolidatedOutflows: NearFlowMovement[],
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

function isFeeOnlyFromFees(
  consolidatedInflows: NearFlowMovement[],
  consolidatedOutflows: NearFlowMovement[],
  consolidatedFees: NearFlowMovement[],
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

export function isFeeOnlyTransaction(
  consolidatedInflows: NearFlowMovement[],
  consolidatedOutflows: NearFlowMovement[],
  consolidatedFees: NearFlowMovement[],
  hasTokenTransfers: boolean,
  hasActionDeposits: boolean
): boolean {
  return (
    isFeeOnlyFromOutflows(consolidatedInflows, consolidatedOutflows, hasTokenTransfers, hasActionDeposits) ||
    isFeeOnlyFromFees(consolidatedInflows, consolidatedOutflows, consolidatedFees, hasTokenTransfers, hasActionDeposits)
  );
}
