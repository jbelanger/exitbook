import { type CosmosChainConfig, type CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import {
  buildBlockchainNativeAssetId,
  ok,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import type { AccountingPostingDraft, AccountingPostingRole, SourceComponentQuantityRef } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { buildSourceComponentQuantityRef } from '../shared/ledger-assembler-utils.js';

import { buildCosmosAssetRef } from './journal-assembler-amounts.js';
import type { CosmosProcessorV2ValidatedContext } from './journal-assembler-types.js';

const USER_INITIATED_STAKING_TX_TYPES = new Set([
  'staking_delegate',
  'staking_redelegate',
  'staking_reward',
  'staking_undelegate',
]);

function isSuccessfulValueTransaction(transaction: CosmosTransaction): boolean {
  return transaction.status === 'success';
}

function isUserInitiatedCosmosOperation(
  transaction: CosmosTransaction,
  context: CosmosProcessorV2ValidatedContext
): boolean {
  if (transaction.from === context.primaryAddress) {
    return true;
  }

  return transaction.to === context.primaryAddress && USER_INITIATED_STAKING_TX_TYPES.has(transaction.txType ?? '');
}

function buildPostingComponentRef(params: {
  assetId: string;
  componentId: string;
  componentKind: SourceComponentQuantityRef['component']['componentKind'];
  quantity: Decimal;
  sourceActivityFingerprint: string;
}): SourceComponentQuantityRef {
  return buildSourceComponentQuantityRef({
    assetId: params.assetId,
    componentId: params.componentId,
    componentKind: params.componentKind,
    quantity: params.quantity,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
  });
}

function buildValuePosting(params: {
  assetId: string;
  assetSymbol: Currency;
  balanceCategory: AccountingPostingDraft['balanceCategory'];
  componentId: string;
  componentKind: SourceComponentQuantityRef['component']['componentKind'];
  occurrence: number;
  postingKeyPrefix: string;
  quantity: Decimal;
  role: AccountingPostingRole;
  sourceActivityFingerprint: string;
}): AccountingPostingDraft {
  return {
    postingStableKey: `${params.postingKeyPrefix}:${params.assetId}:${params.occurrence}`,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    quantity: params.quantity,
    role: params.role,
    balanceCategory: params.balanceCategory,
    sourceComponentRefs: [
      buildPostingComponentRef({
        assetId: params.assetId,
        componentId: params.componentId,
        componentKind: params.componentKind,
        quantity: params.quantity.abs(),
        sourceActivityFingerprint: params.sourceActivityFingerprint,
      }),
    ],
  };
}

function buildTransferPostings(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: CosmosTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (!isSuccessfulValueTransaction(params.transaction)) {
    return ok([]);
  }

  const amount = parseDecimal(params.transaction.amount);
  if (amount.isZero()) {
    return ok([]);
  }

  if (params.transaction.txType?.startsWith('staking_')) {
    return buildStakingRewardPostings(params);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCosmosAssetRef({
      asset: params.transaction.currency,
      chainConfig: params.chainConfig,
      denom: params.transaction.tokenAddress,
      transactionId: params.transaction.id,
    });
    const postings: AccountingPostingDraft[] = [];
    const isIncoming = params.transaction.to === params.context.primaryAddress;
    const isOutgoing = params.transaction.from === params.context.primaryAddress;

    if (isOutgoing) {
      postings.push(
        buildValuePosting({
          assetId: assetRef.assetId,
          assetSymbol: assetRef.assetSymbol,
          balanceCategory: 'liquid',
          componentId: `${params.transaction.eventId}:message`,
          componentKind: 'message',
          occurrence: params.occurrenceStart,
          postingKeyPrefix: 'principal:out',
          quantity: amount.negated(),
          role: 'principal',
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    if (isIncoming) {
      postings.push(
        buildValuePosting({
          assetId: assetRef.assetId,
          assetSymbol: assetRef.assetSymbol,
          balanceCategory: 'liquid',
          componentId: `${params.transaction.eventId}:message`,
          componentKind: 'message',
          occurrence: params.occurrenceStart + postings.length,
          postingKeyPrefix: 'principal:in',
          quantity: amount,
          role: 'principal',
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    return postings;
  });
}

function buildStakingRewardPostings(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: CosmosTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (!isSuccessfulValueTransaction(params.transaction) || params.transaction.to !== params.context.primaryAddress) {
    return ok([]);
  }

  const rewardAmount = parseDecimal(params.transaction.amount);
  if (rewardAmount.isZero()) {
    return ok([]);
  }

  return resultDo(function* () {
    const assetRef = yield* buildCosmosAssetRef({
      asset: params.transaction.currency,
      chainConfig: params.chainConfig,
      denom: params.transaction.tokenAddress,
      transactionId: params.transaction.id,
    });

    return [
      buildValuePosting({
        assetId: assetRef.assetId,
        assetSymbol: assetRef.assetSymbol,
        balanceCategory: 'liquid',
        componentId: `${params.transaction.eventId}:staking_reward`,
        componentKind: 'staking_reward',
        occurrence: params.occurrenceStart,
        postingKeyPrefix: 'staking_reward:in',
        quantity: rewardAmount,
        role: 'staking_reward',
        sourceActivityFingerprint: params.sourceActivityFingerprint,
      }),
    ];
  });
}

function stakingPrincipalAssetRef(params: {
  chainConfig: CosmosChainConfig;
  transaction: CosmosTransaction;
}): Result<{ assetId: string; assetSymbol: Currency }, Error> {
  return buildCosmosAssetRef({
    asset: params.transaction.stakingPrincipalCurrency ?? params.chainConfig.nativeCurrency,
    chainConfig: params.chainConfig,
    denom: params.transaction.stakingPrincipalDenom ?? params.chainConfig.nativeDenom,
    transactionId: params.transaction.id,
  });
}

function buildStakingPrincipalPostings(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: CosmosTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (!isSuccessfulValueTransaction(params.transaction)) {
    return ok([]);
  }

  if (!isUserInitiatedCosmosOperation(params.transaction, params.context)) {
    return ok([]);
  }

  const principalAmount = parseDecimal(params.transaction.stakingPrincipalAmount ?? '0');
  if (principalAmount.isZero()) {
    return ok([]);
  }

  return resultDo(function* () {
    const assetRef = yield* stakingPrincipalAssetRef({
      chainConfig: params.chainConfig,
      transaction: params.transaction,
    });
    const componentId = `${params.transaction.eventId}:staking_principal`;

    switch (params.transaction.txType) {
      case 'staking_delegate':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'liquid',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'protocol_deposit:liquid_to_staked:out',
            quantity: principalAmount.negated(),
            role: 'protocol_deposit',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'staked',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart + 1,
            postingKeyPrefix: 'principal:liquid_to_staked:in',
            quantity: principalAmount,
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      case 'staking_undelegate':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'staked',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'principal:staked_to_unbonding:out',
            quantity: principalAmount.negated(),
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'unbonding',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart + 1,
            postingKeyPrefix: 'protocol_refund:staked_to_unbonding:in',
            quantity: principalAmount,
            role: 'protocol_refund',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      case 'staking_redelegate':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'staked',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'principal:redelegate:out',
            quantity: principalAmount.negated(),
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'staked',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart + 1,
            postingKeyPrefix: 'principal:redelegate:in',
            quantity: principalAmount,
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      default:
        return [];
    }
  });
}

export function buildCosmosValuePostings(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2ValidatedContext;
  sourceActivityFingerprint: string;
  transactions: readonly CosmosTransaction[];
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (const transaction of params.transactions) {
      const principalPostings = yield* buildStakingPrincipalPostings({
        chainConfig: params.chainConfig,
        context: params.context,
        occurrenceStart: postings.length + 1,
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        transaction,
      });
      postings.push(...principalPostings);

      const transferPostings = yield* buildTransferPostings({
        chainConfig: params.chainConfig,
        context: params.context,
        occurrenceStart: postings.length + 1,
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        transaction,
      });
      postings.push(...transferPostings);
    }

    return postings;
  });
}

function findFeeSourceTransaction(
  transactions: readonly CosmosTransaction[],
  context: CosmosProcessorV2ValidatedContext
): CosmosTransaction | undefined {
  return (
    transactions.find(
      (transaction) =>
        isUserInitiatedCosmosOperation(transaction, context) &&
        transaction.feeAmount !== undefined &&
        !parseDecimal(transaction.feeAmount).isZero()
    ) ??
    transactions.find((transaction) => isUserInitiatedCosmosOperation(transaction, context)) ??
    transactions[0]
  );
}

export function buildOptionalCosmosNetworkFeePosting(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2ValidatedContext;
  sourceActivityFingerprint: string;
  transactions: readonly CosmosTransaction[];
}): Result<AccountingPostingDraft | undefined, Error> {
  const feeSourceTransaction = findFeeSourceTransaction(params.transactions, params.context);
  if (!feeSourceTransaction || !isUserInitiatedCosmosOperation(feeSourceTransaction, params.context)) {
    return ok(undefined);
  }

  const feeAmount = parseDecimal(feeSourceTransaction.feeAmount ?? '0');
  if (feeAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeAssetId = yield* buildBlockchainNativeAssetId(params.chainConfig.chainName);
    const feeCurrency = yield* parseCurrency(feeSourceTransaction.feeCurrency ?? params.chainConfig.nativeCurrency);

    return {
      postingStableKey: 'network_fee:native',
      assetId: feeAssetId,
      assetSymbol: feeCurrency,
      quantity: feeAmount.negated(),
      role: 'fee',
      balanceCategory: 'liquid',
      settlement: 'on-chain',
      sourceComponentRefs: [
        buildPostingComponentRef({
          assetId: feeAssetId,
          componentId: `${feeSourceTransaction.eventId}:network_fee`,
          componentKind: 'network_fee',
          quantity: feeAmount,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        }),
      ],
    };
  });
}
