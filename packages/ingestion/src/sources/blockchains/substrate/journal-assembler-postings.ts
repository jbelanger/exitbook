import { type SubstrateChainConfig, type SubstrateTransaction } from '@exitbook/blockchain-providers/substrate';
import {
  buildBlockchainNativeAssetId,
  ok,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Result,
} from '@exitbook/foundation';
import type { AccountingPostingDraft, AccountingPostingRole, SourceComponentQuantityRef } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { buildSourceComponentQuantityRef } from '../shared/ledger-assembler-utils.js';

import {
  buildSubstrateNativeAssetRef,
  normalizeSubstrateFeeQuantity,
  normalizeSubstrateTransactionQuantity,
} from './journal-assembler-amounts.js';
import type { SubstrateProcessorV2ValidatedContext } from './journal-assembler-types.js';

type StakingAction = 'bond' | 'reward' | 'staking_control' | 'unbond' | 'withdraw_unbonded' | undefined;

function hasUserAddress(address: string | undefined, context: SubstrateProcessorV2ValidatedContext): boolean {
  return address !== undefined && context.userAddresses.includes(address);
}

function callName(transaction: SubstrateTransaction): string {
  return transaction.call?.toLowerCase() ?? '';
}

function moduleName(transaction: SubstrateTransaction): string {
  return transaction.module?.toLowerCase() ?? '';
}

function resolveStakingAction(transaction: SubstrateTransaction): StakingAction {
  const call = callName(transaction);

  if (call.includes('withdraw')) {
    return 'withdraw_unbonded';
  }

  if (call.includes('unbond')) {
    return 'unbond';
  }

  if (call.includes('bond')) {
    return 'bond';
  }

  if (call.includes('payout') || call.includes('reward')) {
    return 'reward';
  }

  if (call.includes('nominate') || call.includes('chill')) {
    return 'staking_control';
  }

  if (moduleName(transaction) === 'staking') {
    return 'staking_control';
  }

  return undefined;
}

function isStakingTransaction(transaction: SubstrateTransaction): boolean {
  return resolveStakingAction(transaction) !== undefined;
}

function isSuccessfulValueTransaction(transaction: SubstrateTransaction): boolean {
  return transaction.status === 'success';
}

function isUserInitiatedSubstrateOperation(
  transaction: SubstrateTransaction,
  context: SubstrateProcessorV2ValidatedContext
): boolean {
  if (hasUserAddress(transaction.from, context)) {
    return true;
  }

  const stakingAction = resolveStakingAction(transaction);
  return (
    hasUserAddress(transaction.to, context) && (stakingAction === 'unbond' || stakingAction === 'withdraw_unbonded')
  );
}

function buildPostingComponentRef(params: {
  assetId: string;
  componentId: string;
  componentKind: SourceComponentQuantityRef['component']['componentKind'];
  occurrence?: number | undefined;
  quantity: Decimal;
  sourceActivityFingerprint: string;
}): SourceComponentQuantityRef {
  return buildSourceComponentQuantityRef({
    assetId: params.assetId,
    componentId: params.componentId,
    componentKind: params.componentKind,
    occurrence: params.occurrence,
    quantity: params.quantity,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
  });
}

function buildValuePosting(params: {
  assetId: string;
  assetSymbol: AccountingPostingDraft['assetSymbol'];
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
        occurrence: params.occurrence,
        quantity: params.quantity.abs(),
        sourceActivityFingerprint: params.sourceActivityFingerprint,
      }),
    ],
  };
}

function buildTransferPostings(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: SubstrateTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (!isSuccessfulValueTransaction(params.transaction) || isStakingTransaction(params.transaction)) {
    return ok([]);
  }

  return resultDo(function* () {
    const amount = yield* normalizeSubstrateTransactionQuantity(params.transaction, params.chainConfig);
    if (amount.isZero()) {
      return [];
    }

    const assetRef = yield* buildSubstrateNativeAssetRef({
      asset: params.transaction.currency,
      chainConfig: params.chainConfig,
      transactionId: params.transaction.id,
    });
    const postings: AccountingPostingDraft[] = [];

    if (hasUserAddress(params.transaction.from, params.context)) {
      postings.push(
        buildValuePosting({
          assetId: assetRef.assetId,
          assetSymbol: assetRef.assetSymbol,
          balanceCategory: 'liquid',
          componentId: params.transaction.eventId,
          componentKind: 'account_delta',
          occurrence: params.occurrenceStart,
          postingKeyPrefix: 'principal:out',
          quantity: amount.negated(),
          role: 'principal',
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    if (hasUserAddress(params.transaction.to, params.context)) {
      postings.push(
        buildValuePosting({
          assetId: assetRef.assetId,
          assetSymbol: assetRef.assetSymbol,
          balanceCategory: 'liquid',
          componentId: params.transaction.eventId,
          componentKind: 'account_delta',
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

function buildStakingRewardPosting(params: {
  amount: Decimal;
  chainConfig: SubstrateChainConfig;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: SubstrateTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (params.amount.isZero()) {
    return ok([]);
  }

  return resultDo(function* () {
    const assetRef = yield* buildSubstrateNativeAssetRef({
      asset: params.transaction.currency,
      chainConfig: params.chainConfig,
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
        quantity: params.amount,
        role: 'staking_reward',
        sourceActivityFingerprint: params.sourceActivityFingerprint,
      }),
    ];
  });
}

function buildStakingPrincipalPostings(params: {
  action: StakingAction;
  amount: Decimal;
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: SubstrateTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (params.amount.isZero() || !isUserInitiatedSubstrateOperation(params.transaction, params.context)) {
    return ok([]);
  }

  return resultDo(function* () {
    const assetRef = yield* buildSubstrateNativeAssetRef({
      asset: params.transaction.currency,
      chainConfig: params.chainConfig,
      transactionId: params.transaction.id,
    });
    const componentId = `${params.transaction.eventId}:staking_principal`;

    switch (params.action) {
      case 'bond':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'liquid',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'protocol_deposit:liquid_to_staked:out',
            quantity: params.amount.negated(),
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
            quantity: params.amount,
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      case 'unbond':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'staked',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'principal:staked_to_unbonding:out',
            quantity: params.amount.negated(),
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
            quantity: params.amount,
            role: 'protocol_refund',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      case 'withdraw_unbonded':
        return [
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'unbonding',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart,
            postingKeyPrefix: 'principal:unbonding_to_liquid:out',
            quantity: params.amount.negated(),
            role: 'principal',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
          buildValuePosting({
            assetId: assetRef.assetId,
            assetSymbol: assetRef.assetSymbol,
            balanceCategory: 'liquid',
            componentId,
            componentKind: 'message',
            occurrence: params.occurrenceStart + 1,
            postingKeyPrefix: 'protocol_refund:unbonding_to_liquid:in',
            quantity: params.amount,
            role: 'protocol_refund',
            sourceActivityFingerprint: params.sourceActivityFingerprint,
          }),
        ];
      default:
        return [];
    }
  });
}

function buildStakingPostings(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2ValidatedContext;
  occurrenceStart: number;
  sourceActivityFingerprint: string;
  transaction: SubstrateTransaction;
}): Result<AccountingPostingDraft[], Error> {
  if (!isSuccessfulValueTransaction(params.transaction)) {
    return ok([]);
  }

  const action = resolveStakingAction(params.transaction);
  if (!action) {
    return ok([]);
  }

  return resultDo(function* () {
    const amount = yield* normalizeSubstrateTransactionQuantity(params.transaction, params.chainConfig);
    if (
      action === 'reward' ||
      (moduleName(params.transaction) === 'staking' &&
        hasUserAddress(params.transaction.to, params.context) &&
        !isUserInitiatedSubstrateOperation(params.transaction, params.context) &&
        amount.gt(0))
    ) {
      return yield* buildStakingRewardPosting({
        amount,
        chainConfig: params.chainConfig,
        occurrenceStart: params.occurrenceStart,
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        transaction: params.transaction,
      });
    }

    return yield* buildStakingPrincipalPostings({
      action,
      amount,
      chainConfig: params.chainConfig,
      context: params.context,
      occurrenceStart: params.occurrenceStart,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      transaction: params.transaction,
    });
  });
}

export function buildSubstrateValuePostings(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2ValidatedContext;
  sourceActivityFingerprint: string;
  transactions: readonly SubstrateTransaction[];
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (const transaction of params.transactions) {
      const stakingPostings = yield* buildStakingPostings({
        chainConfig: params.chainConfig,
        context: params.context,
        occurrenceStart: postings.length + 1,
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        transaction,
      });
      postings.push(...stakingPostings);

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
  transactions: readonly SubstrateTransaction[],
  context: SubstrateProcessorV2ValidatedContext
): SubstrateTransaction | undefined {
  return (
    transactions.find(
      (transaction) =>
        isUserInitiatedSubstrateOperation(transaction, context) &&
        transaction.feeAmount !== undefined &&
        !parseDecimal(transaction.feeAmount).isZero()
    ) ??
    transactions.find(
      (transaction) => isUserInitiatedSubstrateOperation(transaction, context) && transaction.feeAmount !== undefined
    ) ??
    transactions.find((transaction) => isUserInitiatedSubstrateOperation(transaction, context)) ??
    transactions[0]
  );
}

export function buildOptionalSubstrateNetworkFeePosting(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2ValidatedContext;
  sourceActivityFingerprint: string;
  transactions: readonly SubstrateTransaction[];
}): Result<AccountingPostingDraft | undefined, Error> {
  const feeSourceTransaction = findFeeSourceTransaction(params.transactions, params.context);
  if (!feeSourceTransaction || !isUserInitiatedSubstrateOperation(feeSourceTransaction, params.context)) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeAmount = yield* normalizeSubstrateFeeQuantity(feeSourceTransaction, params.chainConfig);
    if (feeAmount.isZero()) {
      return undefined;
    }

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

export function hasSubstrateProtocolEvent(transactions: readonly SubstrateTransaction[]): boolean {
  return transactions.some((transaction) => isStakingTransaction(transaction));
}
