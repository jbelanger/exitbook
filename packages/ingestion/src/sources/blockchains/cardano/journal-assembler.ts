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
  resultDo,
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
import type { CardanoFundFlow, CardanoMovement as LegacyCardanoMovement } from './types.js';

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

interface CardanoAssetDelta extends Omit<LegacyCardanoMovement, 'movementRole'> {
  postingRole?: LegacyCardanoMovement['movementRole'] | undefined;
}

type CardanoWithdrawal = NonNullable<CardanoTransaction['withdrawals']>[number];

function toCardanoAssetDelta(legacyMovement: LegacyCardanoMovement): CardanoAssetDelta {
  const { movementRole, ...assetDelta } = legacyMovement;

  if (movementRole === undefined) {
    return assetDelta;
  }

  return {
    ...assetDelta,
    postingRole: movementRole,
  };
}

function buildCardanoAssetRefFromUnit(unit: string, symbol?: string): Result<CardanoAssetRef, Error> {
  return resultDo(function* () {
    const isNativeAda = unit === 'lovelace';
    const assetId = isNativeAda
      ? yield* buildBlockchainNativeAssetId('cardano')
      : yield* buildBlockchainTokenAssetId('cardano', unit);
    const defaultSymbol = isNativeAda ? 'ADA' : unit;
    const assetSymbol = yield* parseCurrency(symbol ?? defaultSymbol);

    return {
      assetId,
      assetSymbol,
    };
  });
}

function buildCardanoAssetRefFromDelta(assetDelta: CardanoAssetDelta): Result<CardanoAssetRef, Error> {
  return buildCardanoAssetRefFromUnit(assetDelta.unit, assetDelta.asset);
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
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(unit);
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
            assetRef.assetId,
            quantity
          )
        );
      }
    }

    return refs;
  });
}

function buildPrincipalOutputComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  unit: string
): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromUnit(unit);
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
            assetRef.assetId,
            quantity
          )
        );
      }
    }

    return refs;
  });
}

function buildPrincipalComponentRefs(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  unit: string,
  principalInflowAmount: Decimal,
  principalOutflowAmount: Decimal
): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    if (principalOutflowAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalInputComponentRefs(transaction, sourceActivityFingerprint, primaryAddress, unit))
      );
    }

    if (principalInflowAmount.gt(0)) {
      refs.push(
        ...(yield* buildPrincipalOutputComponentRefs(transaction, sourceActivityFingerprint, primaryAddress, unit))
      );
    }

    if (refs.length === 0) {
      yield* err(
        new Error(
          `Cardano v2 principal posting for transaction ${transaction.id} unit ${unit} has no source component refs`
        )
      );
    }

    return refs;
  });
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

function buildPrincipalPosting(
  assetDelta: CardanoAssetDelta,
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

  return resultDo(function* () {
    const assetRef = yield* buildCardanoAssetRefFromDelta(assetDelta);
    const sourceComponentRefs = yield* buildPrincipalComponentRefs(
      transaction,
      sourceActivityFingerprint,
      primaryAddress,
      assetDelta.unit,
      principalInflowAmount,
      principalOutflowAmount
    );

    return {
      postingStableKey: `principal:${assetDelta.unit}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity,
      role: 'principal',
      sourceComponentRefs,
    };
  });
}

function buildNetworkFeePosting(
  sourceActivityFingerprint: string,
  transactionId: string,
  feeAmount: Decimal,
  feeCurrency: Currency
): Result<AccountingPostingDraft, Error> {
  return resultDo(function* () {
    const feeAssetId = yield* buildBlockchainNativeAssetId('cardano');

    return {
      postingStableKey: 'network_fee:lovelace',
      assetId: feeAssetId,
      assetSymbol: feeCurrency,
      quantity: feeAmount.negated(),
      role: 'fee',
      settlement: 'on-chain',
      sourceComponentRefs: [
        buildPostingComponentRef(
          sourceActivityFingerprint,
          'network_fee',
          `${transactionId}:network_fee:lovelace`,
          feeAssetId,
          feeAmount
        ),
      ],
    };
  });
}

function groupAssetDeltasByUnit(
  assetDeltas: CardanoAssetDelta[],
  role: 'principal' | 'staking_reward'
): Map<string, CardanoAssetDelta> {
  const grouped = new Map<string, CardanoAssetDelta>();

  for (const assetDelta of assetDeltas) {
    const assetDeltaRole = assetDelta.postingRole ?? 'principal';
    if (assetDeltaRole !== role) {
      continue;
    }

    grouped.set(assetDelta.unit, assetDelta);
  }

  return grouped;
}

function validateCardanoProcessorV2Context(context: CardanoProcessorV2Context): Result<void, Error> {
  if (!Number.isInteger(context.account.id) || context.account.id <= 0) {
    return err(new Error(`Cardano v2 account id must be a positive integer, got ${context.account.id}`));
  }

  if (context.account.fingerprint.trim() === '') {
    return err(new Error('Cardano v2 account fingerprint must not be empty'));
  }

  return ok(undefined);
}

function computeCardanoSourceActivityFingerprint(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: context.account.fingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    blockchainTransactionHash: transaction.id,
  });
}

function buildOptionalNetworkFeePosting(
  sourceActivityFingerprint: string,
  transaction: CardanoTransaction,
  fundFlow: CardanoFundFlow,
  feeAmount: Decimal
): Result<AccountingPostingDraft | undefined, Error> {
  if (!fundFlow.feePaidByUser || feeAmount.isZero()) {
    return ok(undefined);
  }

  return buildNetworkFeePosting(sourceActivityFingerprint, transaction.id, feeAmount, fundFlow.feeCurrency);
}

function buildPrincipalPostings(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  primaryAddress: string,
  fundFlow: CardanoFundFlow,
  inflowDeltas: CardanoAssetDelta[],
  outflowDeltas: CardanoAssetDelta[],
  feeAmount: Decimal
): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const principalInflowDeltas = groupAssetDeltasByUnit(inflowDeltas, 'principal');
    const principalOutflowDeltas = groupAssetDeltasByUnit(outflowDeltas, 'principal');
    const principalDeltasByUnit = new Map<string, CardanoAssetDelta>([
      ...principalOutflowDeltas,
      ...principalInflowDeltas,
    ]);
    const principalPostings: AccountingPostingDraft[] = [];

    for (const [unit, referenceAssetDelta] of principalDeltasByUnit) {
      const inflowDelta = principalInflowDeltas.get(unit);
      const outflowDelta = principalOutflowDeltas.get(unit);
      const principalInflowAmount = inflowDelta ? parseDecimal(inflowDelta.amount) : new Decimal(0);
      const principalOutflowAmount = outflowDelta ? parseDecimal(outflowDelta.amount) : new Decimal(0);
      const feeAdjustment =
        fundFlow.feePaidByUser && referenceAssetDelta.unit === 'lovelace' ? feeAmount : new Decimal(0);
      const transferQuantity = principalInflowAmount.minus(principalOutflowAmount).plus(feeAdjustment);
      const posting = yield* buildPrincipalPosting(
        referenceAssetDelta,
        transferQuantity,
        sourceActivityFingerprint,
        transaction,
        primaryAddress,
        principalInflowAmount,
        principalOutflowAmount
      );

      if (posting) {
        principalPostings.push(posting);
      }
    }

    return principalPostings;
  });
}

function buildStakingRewardPostings(
  transaction: CardanoTransaction,
  sourceActivityFingerprint: string,
  stakingRewardDeltas: CardanoAssetDelta[]
): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const rewardPostings: AccountingPostingDraft[] = [];

    for (const assetDelta of stakingRewardDeltas) {
      const assetRef = yield* buildCardanoAssetRefFromDelta(assetDelta);
      const quantity = parseDecimal(assetDelta.amount);
      const sourceComponentRefs = buildStakingRewardComponentRefs(
        transaction,
        sourceActivityFingerprint,
        assetRef.assetId
      );

      if (sourceComponentRefs.length === 0) {
        yield* err(
          new Error(`Cardano v2 staking reward posting for transaction ${transaction.id} has no withdrawal refs`)
        );
      }

      rewardPostings.push({
        postingStableKey: `staking_reward:${assetDelta.unit}`,
        assetId: assetRef.assetId,
        assetSymbol: assetRef.assetSymbol,
        quantity,
        role: 'staking_reward',
        sourceComponentRefs,
      });
    }

    return rewardPostings;
  });
}

function buildCardanoJournals(
  sourceActivityFingerprint: string,
  principalPostings: AccountingPostingDraft[],
  rewardPostings: AccountingPostingDraft[],
  feePosting: AccountingPostingDraft | undefined
): AccountingJournalDraft[] {
  const journals: AccountingJournalDraft[] = [];
  let pendingFeePosting = feePosting;

  if (principalPostings.length > 0) {
    const postings = pendingFeePosting ? [...principalPostings, pendingFeePosting] : principalPostings;
    pendingFeePosting = undefined;

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'transfer',
      journalKind: 'transfer',
      postings,
    });
  }

  if (rewardPostings.length > 0) {
    const postings = pendingFeePosting ? [...rewardPostings, pendingFeePosting] : rewardPostings;
    pendingFeePosting = undefined;

    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'staking_reward',
      journalKind: 'staking_reward',
      postings,
    });
  }

  if (pendingFeePosting) {
    journals.push({
      sourceActivityFingerprint,
      journalStableKey: 'network_fee',
      journalKind: 'expense_only',
      postings: [pendingFeePosting],
    });
  }

  return journals;
}

function buildCardanoSourceActivityDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context,
  sourceActivityFingerprint: string,
  fundFlow: CardanoFundFlow
): SourceActivityDraft {
  return {
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
  };
}

export function assembleCardanoLedgerDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  return resultDo(function* () {
    yield* validateCardanoProcessorV2Context(context);

    const fundFlow = yield* analyzeCardanoFundFlow(transaction, {
      primaryAddress: context.primaryAddress,
      userAddresses: context.userAddresses,
    });
    const sourceActivityFingerprint = yield* computeCardanoSourceActivityFingerprint(transaction, context);
    const inflowDeltas = fundFlow.inflows.map(toCardanoAssetDelta);
    const outflowDeltas = fundFlow.outflows.map(toCardanoAssetDelta);
    const stakingRewardDeltas = inflowDeltas.filter((assetDelta) => assetDelta.postingRole === 'staking_reward');
    const feeAmount = parseDecimal(fundFlow.feeAmount);

    const feePosting = yield* buildOptionalNetworkFeePosting(
      sourceActivityFingerprint,
      transaction,
      fundFlow,
      feeAmount
    );
    const principalPostings = yield* buildPrincipalPostings(
      transaction,
      sourceActivityFingerprint,
      context.primaryAddress,
      fundFlow,
      inflowDeltas,
      outflowDeltas,
      feeAmount
    );
    const rewardPostings = yield* buildStakingRewardPostings(
      transaction,
      sourceActivityFingerprint,
      stakingRewardDeltas
    );
    const journals = buildCardanoJournals(sourceActivityFingerprint, principalPostings, rewardPostings, feePosting);
    const sourceActivity = buildCardanoSourceActivityDraft(transaction, context, sourceActivityFingerprint, fundFlow);

    return {
      sourceActivity,
      journals,
    };
  });
}
