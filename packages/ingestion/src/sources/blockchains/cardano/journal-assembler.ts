import type {
  CardanoAssetAmount,
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  ok,
  parseCurrency,
  parseDecimal,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import type {
  AccountingJournalDraft,
  AccountingPostingDraft,
  SourceActivityDraft,
  SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { computeSourceActivityFingerprint } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { analyzeCardanoFundFlow, normalizeCardanoAmount, parseCardanoAssetUnit } from './processor-utils.js';
import type { CardanoMovement } from './types.js';

export interface CardanoProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface CardanoProcessorV2Context {
  account: CardanoProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: string[];
}

export interface CardanoLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

interface CardanoAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

type CardanoWithdrawal = NonNullable<CardanoTransaction['withdrawals']>[number];

function buildCardanoAssetRefFromUnit(unit: string, symbol?: string): Result<CardanoAssetRef, Error> {
  if (unit === 'lovelace') {
    const assetIdResult = buildBlockchainNativeAssetId('cardano');
    if (assetIdResult.isErr()) {
      return err(assetIdResult.error);
    }

    const currencyResult = parseCurrency(symbol ?? 'ADA');
    if (currencyResult.isErr()) {
      return err(currencyResult.error);
    }

    return ok({
      assetId: assetIdResult.value,
      assetSymbol: currencyResult.value,
    });
  }

  const assetIdResult = buildBlockchainTokenAssetId('cardano', unit);
  if (assetIdResult.isErr()) {
    return err(assetIdResult.error);
  }

  const currencyResult = parseCurrency(symbol ?? unit);
  if (currencyResult.isErr()) {
    return err(currencyResult.error);
  }

  return ok({
    assetId: assetIdResult.value,
    assetSymbol: currencyResult.value,
  });
}

function buildCardanoAssetRef(movement: CardanoMovement): Result<CardanoAssetRef, Error> {
  return buildCardanoAssetRefFromUnit(movement.unit, movement.asset);
}

function buildPostingComponentRef(
  sourceActivityFingerprint: string,
  componentKind: 'network_fee' | 'staking_reward' | 'utxo_input' | 'utxo_output',
  componentId: string,
  assetId: string,
  quantity: Decimal,
  occurrence?: number
): SourceComponentQuantityRef {
  return {
    component: {
      sourceActivityFingerprint,
      componentKind,
      componentId,
      occurrence,
      assetId,
    },
    quantity: quantity.abs(),
  };
}

function normalizeCardanoAssetQuantity(assetAmount: CardanoAssetAmount): Decimal {
  const { isAda } = parseCardanoAssetUnit(assetAmount.unit);
  const decimals = isAda ? 6 : assetAmount.decimals;
  return parseDecimal(normalizeCardanoAmount(assetAmount.quantity, decimals));
}

function buildUtxoInputComponentId(input: CardanoTransactionInput): string {
  return `utxo:${input.txHash}:${input.outputIndex}`;
}

function buildUtxoOutputComponentId(transactionId: string, output: CardanoTransactionOutput): string {
  return `utxo:${transactionId}:${output.outputIndex}`;
}

function buildPrincipalInputComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  unit: string
): Result<SourceComponentQuantityRef[], Error> {
  const assetRefResult = buildCardanoAssetRefFromUnit(unit);
  if (assetRefResult.isErr()) {
    return err(assetRefResult.error);
  }

  const refs: SourceComponentQuantityRef[] = [];

  for (const input of transaction.inputs) {
    if (input.address !== primaryAddress) {
      continue;
    }

    for (const assetAmount of input.amounts) {
      if (assetAmount.unit !== unit) {
        continue;
      }

      const quantity = normalizeCardanoAssetQuantity(assetAmount);
      if (quantity.isZero()) {
        continue;
      }

      refs.push(
        buildPostingComponentRef(
          sourceActivityFingerprint,
          'utxo_input',
          buildUtxoInputComponentId(input),
          assetRefResult.value.assetId,
          quantity
        )
      );
    }
  }

  return ok(refs);
}

function buildPrincipalOutputComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  unit: string
): Result<SourceComponentQuantityRef[], Error> {
  const assetRefResult = buildCardanoAssetRefFromUnit(unit);
  if (assetRefResult.isErr()) {
    return err(assetRefResult.error);
  }

  const refs: SourceComponentQuantityRef[] = [];

  for (const output of transaction.outputs) {
    if (output.address !== primaryAddress) {
      continue;
    }

    for (const assetAmount of output.amounts) {
      if (assetAmount.unit !== unit) {
        continue;
      }

      const quantity = normalizeCardanoAssetQuantity(assetAmount);
      if (quantity.isZero()) {
        continue;
      }

      refs.push(
        buildPostingComponentRef(
          sourceActivityFingerprint,
          'utxo_output',
          buildUtxoOutputComponentId(transaction.id, output),
          assetRefResult.value.assetId,
          quantity
        )
      );
    }
  }

  return ok(refs);
}

function buildPrincipalComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  unit: string,
  principalInflowAmount: Decimal,
  principalOutflowAmount: Decimal
): Result<SourceComponentQuantityRef[], Error> {
  const refs: SourceComponentQuantityRef[] = [];

  if (principalOutflowAmount.gt(0)) {
    const inputRefsResult = buildPrincipalInputComponentRefs(
      transaction,
      sourceActivityFingerprint,
      primaryAddress,
      unit
    );
    if (inputRefsResult.isErr()) {
      return err(inputRefsResult.error);
    }

    refs.push(...inputRefsResult.value);
  }

  if (principalInflowAmount.gt(0)) {
    const outputRefsResult = buildPrincipalOutputComponentRefs(
      transaction,
      sourceActivityFingerprint,
      primaryAddress,
      unit
    );
    if (outputRefsResult.isErr()) {
      return err(outputRefsResult.error);
    }

    refs.push(...outputRefsResult.value);
  }

  if (refs.length === 0) {
    return err(
      new Error(
        `Cardano v2 principal posting for transaction ${transaction.id} unit ${unit} has no source component refs`
      )
    );
  }

  return ok(refs);
}

function buildStakingRewardComponentRef(
  sourceActivityFingerprint: string,
  withdrawal: CardanoWithdrawal,
  withdrawalIndex: number,
  assetId: string
): SourceComponentQuantityRef {
  return buildPostingComponentRef(
    sourceActivityFingerprint,
    'staking_reward',
    `withdrawal:${withdrawal.address}`,
    assetId,
    parseDecimal(withdrawal.amount),
    withdrawalIndex + 1
  );
}

function buildStakingRewardComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  assetId: string
): SourceComponentQuantityRef[] {
  return (transaction.withdrawals ?? [])
    .map((withdrawal, index) => buildStakingRewardComponentRef(sourceActivityFingerprint, withdrawal, index, assetId))
    .filter((ref) => !ref.quantity.isZero());
}

function buildTransferPosting(
  movement: CardanoMovement,
  quantity: Decimal,
  sourceActivityFingerprint: string,
  transaction: CardanoTransaction,
  primaryAddress: string,
  principalInflowAmount: Decimal,
  principalOutflowAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (quantity.isZero()) {
    return ok(undefined);
  }

  const assetRefResult = buildCardanoAssetRef(movement);
  if (assetRefResult.isErr()) {
    return err(assetRefResult.error);
  }

  const sourceComponentRefsResult = buildPrincipalComponentRefs(
    transaction,
    sourceActivityFingerprint,
    primaryAddress,
    movement.unit,
    principalInflowAmount,
    principalOutflowAmount
  );
  if (sourceComponentRefsResult.isErr()) {
    return err(sourceComponentRefsResult.error);
  }

  return ok({
    postingStableKey: `principal:${movement.unit}`,
    assetId: assetRefResult.value.assetId,
    assetSymbol: assetRefResult.value.assetSymbol,
    quantity,
    role: 'principal',
    sourceComponentRefs: sourceComponentRefsResult.value,
  });
}

function groupMovementsByUnit(
  movements: CardanoMovement[],
  role: 'principal' | 'staking_reward'
): Map<string, CardanoMovement> {
  const grouped = new Map<string, CardanoMovement>();

  for (const movement of movements) {
    const movementRole = movement.movementRole ?? 'principal';
    if (movementRole !== role) {
      continue;
    }

    grouped.set(movement.unit, movement);
  }

  return grouped;
}

export function assembleCardanoLedgerDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  if (!Number.isInteger(context.account.id) || context.account.id <= 0) {
    return err(new Error(`Cardano v2 account id must be a positive integer, got ${context.account.id}`));
  }

  if (context.account.fingerprint.trim() === '') {
    return err(new Error('Cardano v2 account fingerprint must not be empty'));
  }

  const fundFlowResult = analyzeCardanoFundFlow(transaction, {
    primaryAddress: context.primaryAddress,
    userAddresses: context.userAddresses,
  });
  if (fundFlowResult.isErr()) {
    return err(fundFlowResult.error);
  }

  const sourceActivityFingerprintResult = computeSourceActivityFingerprint({
    accountFingerprint: context.account.fingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    blockchainTransactionHash: transaction.id,
  });
  if (sourceActivityFingerprintResult.isErr()) {
    return err(sourceActivityFingerprintResult.error);
  }

  const sourceActivityFingerprint = sourceActivityFingerprintResult.value;
  const fundFlow = fundFlowResult.value;
  const journals: AccountingJournalDraft[] = [];

  const principalInflows = groupMovementsByUnit(fundFlow.inflows, 'principal');
  const principalOutflows = groupMovementsByUnit(fundFlow.outflows, 'principal');
  const allPrincipalUnits = new Set([...principalInflows.keys(), ...principalOutflows.keys()]);
  const feeAmount = parseDecimal(fundFlow.feeAmount);
  const transferPostings: AccountingPostingDraft[] = [];

  for (const unit of allPrincipalUnits) {
    const inflow = principalInflows.get(unit);
    const outflow = principalOutflows.get(unit);
    const referenceMovement = inflow ?? outflow;
    if (!referenceMovement) {
      continue;
    }

    const principalInflowAmount = inflow ? parseDecimal(inflow.amount) : new Decimal(0);
    const principalOutflowAmount = outflow ? parseDecimal(outflow.amount) : new Decimal(0);
    const feeAdjustment = fundFlow.feePaidByUser && referenceMovement.unit === 'lovelace' ? feeAmount : new Decimal(0);
    const transferQuantity = principalInflowAmount.minus(principalOutflowAmount).plus(feeAdjustment);

    const postingResult = buildTransferPosting(
      referenceMovement,
      transferQuantity,
      sourceActivityFingerprint,
      transaction,
      context.primaryAddress,
      principalInflowAmount,
      principalOutflowAmount
    );
    if (postingResult.isErr()) {
      return err(postingResult.error);
    }

    if (postingResult.value) {
      transferPostings.push(postingResult.value);
    }
  }

  if (transferPostings.length > 0) {
    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'transfer',
      journalKind: 'transfer',
      postings: transferPostings,
    });
  }

  const stakingRewardInflows = fundFlow.inflows.filter((movement) => movement.movementRole === 'staking_reward');
  if (stakingRewardInflows.length > 0) {
    const rewardPostings: AccountingPostingDraft[] = [];

    for (const movement of stakingRewardInflows) {
      const assetRefResult = buildCardanoAssetRef(movement);
      if (assetRefResult.isErr()) {
        return err(assetRefResult.error);
      }

      const quantity = parseDecimal(movement.amount);
      const sourceComponentRefs = buildStakingRewardComponentRefs(
        transaction,
        sourceActivityFingerprint,
        assetRefResult.value.assetId
      );
      if (sourceComponentRefs.length === 0) {
        return err(
          new Error(`Cardano v2 staking reward posting for transaction ${transaction.id} has no withdrawal refs`)
        );
      }

      rewardPostings.push({
        postingStableKey: `staking_reward:${movement.unit}`,
        assetId: assetRefResult.value.assetId,
        assetSymbol: assetRefResult.value.assetSymbol,
        quantity,
        role: 'staking_reward',
        sourceComponentRefs,
      });
    }

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'staking_reward',
      journalKind: 'staking_reward',
      postings: rewardPostings,
    });
  }

  if (fundFlow.feePaidByUser && !feeAmount.isZero()) {
    const feeAssetIdResult = buildBlockchainNativeAssetId('cardano');
    if (feeAssetIdResult.isErr()) {
      return err(feeAssetIdResult.error);
    }

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'network_fee',
      journalKind: 'expense_only',
      postings: [
        {
          postingStableKey: 'network_fee:lovelace',
          assetId: feeAssetIdResult.value,
          assetSymbol: fundFlow.feeCurrency,
          quantity: feeAmount.negated(),
          role: 'fee',
          settlement: 'on-chain',
          sourceComponentRefs: [
            buildPostingComponentRef(
              sourceActivityFingerprint,
              'network_fee',
              `${transaction.id}:network_fee:lovelace`,
              feeAssetIdResult.value,
              feeAmount
            ),
          ],
        },
      ],
    });
  }

  return ok({
    sourceActivity: {
      accountId: context.account.id,
      sourceActivityFingerprint,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      activityStatus: transaction.status,
      activityDatetime: new Date(transaction.timestamp).toISOString(),
      activityTimestampMs: transaction.timestamp,
      fromAddress: fundFlow.fromAddress,
      toAddress: fundFlow.toAddress,
      blockchainName: 'cardano',
      blockchainBlockHeight: transaction.blockHeight,
      blockchainTransactionHash: transaction.id,
      blockchainIsConfirmed: transaction.status === 'success',
    },
    journals,
  });
}
