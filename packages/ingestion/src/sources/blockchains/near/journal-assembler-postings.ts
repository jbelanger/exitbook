import type { NearTokenTransfer } from '@exitbook/blockchain-providers/near';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import type { AccountingPostingDraft, SourceComponentQuantityRef } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { buildSourceComponentQuantityRef } from '../shared/ledger-assembler-utils.js';

import type {
  NearAssetRef,
  NearLedgerMovement,
  NearLedgerSourceComponentInput,
  NearProcessorV2CorrelatedTransaction,
  NearProcessorV2ValidatedContext,
} from './journal-assembler-types.js';
import type { NearReceipt } from './types.js';

const NEAR_DECIMALS = 24;
const NEAR = 'NEAR' as Currency;
const FEE_CAUSES = new Set(['FEE', 'GAS', 'GAS_REFUND']);

function normalizeNearAmount(yoctoAmount: Decimal | string): Decimal {
  return new Decimal(yoctoAmount).dividedBy(new Decimal(10).pow(NEAR_DECIMALS));
}

function normalizeNearTokenAmount(rawAmount: Decimal | string, decimals: number): Decimal {
  return new Decimal(rawAmount).dividedBy(new Decimal(10).pow(decimals));
}

function isPrimaryAccount(accountId: string, context: NearProcessorV2ValidatedContext): boolean {
  return context.userAddresses.includes(accountId.trim().toLowerCase());
}

function resolveNativeMovementRole(
  receipt: NearReceipt,
  cause: string,
  direction: 'in' | 'out'
): NearLedgerMovement['role'] {
  if (!receipt.isSynthetic && direction === 'in' && cause === 'CONTRACT_REWARD') {
    return 'staking_reward';
  }

  return 'principal';
}

function resolveNativeComponentKind(role: NearLedgerMovement['role']): 'account_delta' | 'staking_reward' {
  return role === 'staking_reward' ? 'staking_reward' : 'account_delta';
}

function buildNativeValueMovements(
  correlated: NearProcessorV2CorrelatedTransaction,
  context: NearProcessorV2ValidatedContext
): NearLedgerMovement[] {
  const movements: NearLedgerMovement[] = [];

  for (const receipt of correlated.receipts) {
    for (const balanceChange of receipt.balanceChanges ?? []) {
      if (!isPrimaryAccount(balanceChange.affectedAccountId, context) || FEE_CAUSES.has(balanceChange.cause)) {
        continue;
      }
      if (!balanceChange.deltaAmountYocto) {
        continue;
      }

      const delta = new Decimal(balanceChange.deltaAmountYocto);
      if (delta.isZero()) {
        continue;
      }

      const direction = delta.isNegative() ? 'out' : 'in';
      const amount = normalizeNearAmount(delta.abs());
      const role = resolveNativeMovementRole(receipt, balanceChange.cause, direction);

      movements.push({
        asset: NEAR,
        amount,
        components: [
          {
            componentId: balanceChange.eventId,
            componentKind: resolveNativeComponentKind(role),
            quantity: amount,
          },
        ],
        direction,
        role,
      });
    }
  }

  return movements;
}

function buildTokenTransferMovements(
  tokenTransfers: readonly NearTokenTransfer[],
  context: NearProcessorV2ValidatedContext
): Result<NearLedgerMovement[], Error> {
  return resultDo(function* () {
    const movements: NearLedgerMovement[] = [];

    for (const transfer of tokenTransfers) {
      if (!transfer.deltaAmountYocto) {
        continue;
      }

      const delta = new Decimal(transfer.deltaAmountYocto);
      if (delta.isZero()) {
        continue;
      }

      const asset = yield* parseCurrency(transfer.symbol ?? 'UNKNOWN');
      const amount = normalizeNearTokenAmount(delta.abs(), transfer.decimals);

      movements.push({
        asset,
        amount,
        components: [
          {
            componentId: transfer.eventId,
            componentKind: 'account_delta',
            quantity: amount,
          },
        ],
        contractAddress: transfer.contractAddress,
        direction: isPrimaryAccount(transfer.affectedAccountId, context) ? 'in' : 'out',
        role: 'principal',
      });
    }

    return movements;
  });
}

function buildReceiptFeeMovement(
  receipt: NearReceipt,
  context: NearProcessorV2ValidatedContext
): NearLedgerMovement | undefined {
  if (!isPrimaryAccount(receipt.predecessorAccountId, context) || !receipt.tokensBurntYocto) {
    return undefined;
  }

  const amount = normalizeNearAmount(receipt.tokensBurntYocto);
  if (amount.isZero()) {
    return undefined;
  }

  return {
    asset: NEAR,
    amount,
    components: [
      {
        componentId: `${receipt.eventId}:network_fee`,
        componentKind: 'network_fee',
        quantity: amount,
      },
    ],
    direction: 'out',
    feeSource: 'receipt',
    role: 'fee',
  };
}

function buildBalanceChangeFeeMovement(
  receipt: NearReceipt,
  context: NearProcessorV2ValidatedContext
): NearLedgerMovement | undefined {
  const components: NearLedgerSourceComponentInput[] = [];
  let amount = parseDecimal('0');

  for (const balanceChange of receipt.balanceChanges ?? []) {
    if (!isPrimaryAccount(balanceChange.affectedAccountId, context) || !FEE_CAUSES.has(balanceChange.cause)) {
      continue;
    }
    if (!balanceChange.deltaAmountYocto) {
      continue;
    }

    const componentAmount = normalizeNearAmount(new Decimal(balanceChange.deltaAmountYocto).abs());
    if (componentAmount.isZero()) {
      continue;
    }

    amount = amount.plus(componentAmount);
    components.push({
      componentId: balanceChange.eventId,
      componentKind: 'network_fee',
      quantity: componentAmount,
    });
  }

  if (amount.isZero()) {
    return undefined;
  }

  return {
    asset: NEAR,
    amount,
    components,
    direction: 'out',
    feeSource: 'balance-change',
    role: 'fee',
  };
}

function buildFeeMovements(
  correlated: NearProcessorV2CorrelatedTransaction,
  context: NearProcessorV2ValidatedContext
): NearLedgerMovement[] {
  const movements: NearLedgerMovement[] = [];

  for (const receipt of correlated.receipts) {
    const receiptFee = buildReceiptFeeMovement(receipt, context);
    if (receiptFee) {
      movements.push(receiptFee);
      continue;
    }

    const balanceChangeFee = buildBalanceChangeFeeMovement(receipt, context);
    if (balanceChangeFee) {
      movements.push(balanceChangeFee);
    }
  }

  return movements;
}

function buildMovementKey(movement: NearLedgerMovement): string {
  return [
    movement.direction,
    movement.role,
    movement.contractAddress ?? 'native',
    movement.contractAddress === undefined ? movement.asset : movement.contractAddress,
    movement.feeSource ?? 'value',
  ].join(':');
}

function consolidateMovements(movements: readonly NearLedgerMovement[]): NearLedgerMovement[] {
  const byKey = new Map<string, NearLedgerMovement>();

  for (const movement of movements) {
    const key = buildMovementKey(movement);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...movement, components: [...movement.components] });
      continue;
    }

    existing.amount = existing.amount.plus(movement.amount);
    existing.components.push(...movement.components);
  }

  return [...byKey.values()];
}

function withoutFeeSource(movement: NearLedgerMovement): NearLedgerMovement {
  return {
    asset: movement.asset,
    amount: movement.amount,
    components: movement.components,
    ...(movement.contractAddress === undefined ? {} : { contractAddress: movement.contractAddress }),
    direction: movement.direction,
    role: movement.role,
  };
}

function convertValueMovementToFee(movement: NearLedgerMovement): NearLedgerMovement {
  return {
    ...withoutFeeSource(movement),
    role: 'fee',
  };
}

function subtractFromComponents(
  components: readonly NearLedgerSourceComponentInput[],
  amount: Decimal
): NearLedgerSourceComponentInput[] {
  let remaining = amount;
  const next: NearLedgerSourceComponentInput[] = [];

  for (const component of components) {
    if (remaining.isZero()) {
      next.push(component);
      continue;
    }

    const reduction = Decimal.min(component.quantity, remaining);
    const quantity = component.quantity.minus(reduction);
    remaining = remaining.minus(reduction);
    if (!quantity.isZero()) {
      next.push({ ...component, quantity });
    }
  }

  return next;
}

function subtractReceiptFeesFromNativeOutflows(params: {
  feeMovements: readonly NearLedgerMovement[];
  valueMovements: readonly NearLedgerMovement[];
}): NearLedgerMovement[] {
  const receiptFeeTotal = params.feeMovements
    .filter((movement) => movement.feeSource === 'receipt')
    .reduce((total, movement) => total.plus(movement.amount), parseDecimal('0'));

  if (receiptFeeTotal.isZero()) {
    return [...params.valueMovements];
  }

  let remainingFee = receiptFeeTotal;
  return params.valueMovements
    .map((movement) => {
      if (
        remainingFee.isZero() ||
        movement.direction !== 'out' ||
        movement.contractAddress !== undefined ||
        movement.asset !== NEAR
      ) {
        return movement;
      }

      const reduction = Decimal.min(movement.amount, remainingFee);
      remainingFee = remainingFee.minus(reduction);
      const amount = movement.amount.minus(reduction);

      return {
        ...movement,
        amount,
        components: subtractFromComponents(movement.components, reduction),
      };
    })
    .filter((movement) => !movement.amount.isZero());
}

function isFeeOnlyFromOutflows(params: {
  feeMovements: readonly NearLedgerMovement[];
  hasActionDeposits: boolean;
  hasTokenTransfers: boolean;
  valueMovements: readonly NearLedgerMovement[];
}): boolean {
  const valueMovements = params.valueMovements;
  return (
    valueMovements.length > 0 &&
    valueMovements.every((movement) => movement.direction === 'out' && movement.asset === NEAR) &&
    !params.hasTokenTransfers &&
    !params.hasActionDeposits
  );
}

function hasActionDeposits(correlated: NearProcessorV2CorrelatedTransaction): boolean {
  return correlated.receipts.some((receipt) =>
    (receipt.actions ?? []).some((action) => {
      if (!action.deposit) {
        return false;
      }

      return new Decimal(action.deposit).gt(0);
    })
  );
}

export function buildNearLedgerMovements(
  correlated: NearProcessorV2CorrelatedTransaction,
  context: NearProcessorV2ValidatedContext
): Result<{ feeMovements: NearLedgerMovement[]; valueMovements: NearLedgerMovement[] }, Error> {
  return resultDo(function* () {
    const tokenMovements = yield* buildTokenTransferMovements(correlated.tokenTransfers, context);
    const nativeMovements = buildNativeValueMovements(correlated, context);
    const feeMovements = consolidateMovements(buildFeeMovements(correlated, context));
    let valueMovements = consolidateMovements([...nativeMovements, ...tokenMovements]);
    valueMovements = consolidateMovements(
      subtractReceiptFeesFromNativeOutflows({
        feeMovements,
        valueMovements,
      })
    );

    if (
      isFeeOnlyFromOutflows({
        feeMovements,
        hasActionDeposits: hasActionDeposits(correlated),
        hasTokenTransfers: correlated.tokenTransfers.length > 0 || tokenMovements.length > 0,
        valueMovements,
      })
    ) {
      return {
        valueMovements: [],
        feeMovements: consolidateMovements(
          valueMovements.map(convertValueMovementToFee).concat(feeMovements.map(withoutFeeSource))
        ),
      };
    }

    return {
      valueMovements,
      feeMovements,
    };
  });
}

function buildNearAssetRef(movement: NearLedgerMovement, transactionHash: string): Result<NearAssetRef, Error> {
  return resultDo(function* () {
    if (movement.contractAddress === undefined) {
      if (movement.asset !== NEAR) {
        return yield* err(
          new Error(`NEAR v2 movement for transaction ${transactionHash} has non-native symbol without contract`)
        );
      }

      return {
        assetId: yield* buildBlockchainNativeAssetId('near'),
        assetSymbol: NEAR,
      };
    }

    return {
      assetId: yield* buildBlockchainTokenAssetId('near', movement.contractAddress),
      assetSymbol: movement.asset,
    };
  });
}

function buildComponentRefs(params: {
  assetId: string;
  components: readonly NearLedgerSourceComponentInput[];
  sourceActivityFingerprint: string;
}): SourceComponentQuantityRef[] {
  return params.components.map((component, index) =>
    buildSourceComponentQuantityRef({
      assetId: params.assetId,
      componentId: component.componentId,
      componentKind: component.componentKind,
      occurrence: index + 1,
      quantity: component.quantity,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
    })
  );
}

export function buildNearValuePostings(params: {
  movements: readonly NearLedgerMovement[];
  sourceActivityFingerprint: string;
  transactionHash: string;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (let index = 0; index < params.movements.length; index++) {
      const movement = params.movements[index];
      if (!movement || movement.amount.isZero()) {
        continue;
      }

      const assetRef = yield* buildNearAssetRef(movement, params.transactionHash);
      postings.push({
        postingStableKey: `${movement.role}:${movement.direction}:${assetRef.assetId}:${index + 1}`,
        assetId: assetRef.assetId,
        assetSymbol: assetRef.assetSymbol,
        quantity: movement.direction === 'in' ? movement.amount : movement.amount.negated(),
        role: movement.role,
        balanceCategory: 'liquid',
        sourceComponentRefs: buildComponentRefs({
          assetId: assetRef.assetId,
          components: movement.components,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        }),
      });
    }

    return postings;
  });
}

export function buildNearFeePostings(params: {
  movements: readonly NearLedgerMovement[];
  sourceActivityFingerprint: string;
  transactionHash: string;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (let index = 0; index < params.movements.length; index++) {
      const movement = params.movements[index];
      if (!movement || movement.amount.isZero()) {
        continue;
      }

      const assetRef = yield* buildNearAssetRef(movement, params.transactionHash);
      postings.push({
        postingStableKey: `network_fee:${assetRef.assetId}:${index + 1}`,
        assetId: assetRef.assetId,
        assetSymbol: assetRef.assetSymbol,
        quantity: movement.amount.negated(),
        role: 'fee',
        balanceCategory: 'liquid',
        settlement: 'balance',
        sourceComponentRefs: buildComponentRefs({
          assetId: assetRef.assetId,
          components: movement.components,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        }),
      });
    }

    return postings;
  });
}
