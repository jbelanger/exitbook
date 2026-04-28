import { type SolanaChainConfig } from '@exitbook/blockchain-providers/solana';
import type { OperationClassification } from '@exitbook/core';
import {
  buildBlockchainNativeAssetId,
  buildBlockchainTokenAssetId,
  err,
  ok,
  parseCurrency,
  resultDo,
  type Result,
} from '@exitbook/foundation';
import type { AccountingPostingDraft, AccountingPostingRole, SourceComponentQuantityRef } from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import { buildSourceComponentQuantityRef, parseLedgerDecimalAmount } from '../shared/ledger-assembler-utils.js';

import type {
  SolanaAssetRef,
  SolanaMovementDirection,
  SolanaMovementPostingInput,
  SolanaPostingBuildContext,
  SolanaResolvedPostingRole,
} from './journal-assembler-types.js';
import type { SolanaMovement } from './types.js';

function isNativeSolanaMovement(movement: SolanaMovement, chainConfig: SolanaChainConfig): boolean {
  return movement.tokenAddress === undefined && movement.asset.toUpperCase() === chainConfig.nativeCurrency;
}

function buildSolanaAssetRefFromMovement(params: {
  chainConfig: SolanaChainConfig;
  movement: SolanaMovement;
  transactionId: string;
}): Result<SolanaAssetRef, Error> {
  return resultDo(function* () {
    const assetSymbol = yield* parseCurrency(params.movement.asset);

    if (isNativeSolanaMovement(params.movement, params.chainConfig)) {
      return {
        assetId: yield* buildBlockchainNativeAssetId(params.chainConfig.chainName),
        assetSymbol,
      };
    }

    if (params.movement.tokenAddress === undefined) {
      return yield* err(
        new Error(
          `Solana v2 movement for transaction ${params.transactionId} is missing tokenAddress for non-native asset ${params.movement.asset}`
        )
      );
    }

    return {
      assetId: yield* buildBlockchainTokenAssetId(params.chainConfig.chainName, params.movement.tokenAddress),
      assetSymbol,
    };
  });
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

function isSimpleStakingReward(params: {
  classification: OperationClassification;
  direction: SolanaMovementDirection;
  fundFlow: SolanaPostingBuildContext['fundFlow'];
}): boolean {
  return (
    params.direction === 'in' &&
    params.classification.operation.category === 'staking' &&
    params.classification.operation.type === 'reward' &&
    params.fundFlow.outflows.length === 0
  );
}

function resolveMovementRole(params: {
  classification: OperationClassification;
  direction: SolanaMovementDirection;
  fundFlow: SolanaPostingBuildContext['fundFlow'];
  movement: SolanaMovement;
}): Result<SolanaResolvedPostingRole, Error> {
  if (params.movement.movementRole === 'protocol_overhead') {
    return ok({ componentKind: 'account_delta', role: 'protocol_overhead' });
  }

  if (params.movement.movementRole === 'staking_reward') {
    if (params.direction !== 'in') {
      return err(new Error('Solana v2 cannot emit an outbound staking_reward posting'));
    }

    return ok({ componentKind: 'staking_reward', role: 'staking_reward' });
  }

  if (params.movement.movementRole === 'refund_rebate') {
    if (params.direction !== 'in') {
      return err(new Error('Solana v2 cannot emit an outbound refund_rebate posting'));
    }

    return ok({ componentKind: 'account_delta', role: 'refund_rebate' });
  }

  if (isSimpleStakingReward(params)) {
    return ok({ componentKind: 'staking_reward', role: 'staking_reward' });
  }

  if (
    params.classification.operation.category === 'staking' &&
    (params.movement.balanceCategory ?? 'liquid') === 'liquid'
  ) {
    return ok({
      componentKind: 'account_delta',
      role: params.direction === 'in' ? 'protocol_refund' : 'protocol_deposit',
    });
  }

  return ok({ componentKind: 'account_delta', role: 'principal' });
}

function buildMovementPosting(params: {
  chainConfig: SolanaChainConfig;
  classification: OperationClassification;
  context: SolanaPostingBuildContext;
  input: SolanaMovementPostingInput;
  occurrence: number;
}): Result<AccountingPostingDraft | undefined, Error> {
  return resultDo(function* () {
    const amount = yield* parseLedgerDecimalAmount({
      label: `${params.input.direction} movement`,
      processorLabel: 'Solana v2',
      transactionId: params.context.transaction.id,
      value: params.input.movement.amount,
    });
    if (amount.isZero()) {
      return undefined;
    }

    const assetRef = yield* buildSolanaAssetRefFromMovement({
      chainConfig: params.chainConfig,
      movement: params.input.movement,
      transactionId: params.context.transaction.id,
    });
    const resolvedRole = yield* resolveMovementRole({
      classification: params.classification,
      direction: params.input.direction,
      fundFlow: params.context.fundFlow,
      movement: params.input.movement,
    });
    const quantity = params.input.direction === 'in' ? amount : amount.negated();

    return {
      postingStableKey: `${resolvedRole.role}:${params.input.direction}:${assetRef.assetId}:${params.occurrence}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity,
      role: resolvedRole.role,
      balanceCategory: params.input.movement.balanceCategory ?? 'liquid',
      sourceComponentRefs: [
        buildPostingComponentRef({
          assetId: assetRef.assetId,
          componentId: `${params.context.transaction.eventId}:account_delta:${params.input.direction}:${params.occurrence}`,
          componentKind: resolvedRole.componentKind,
          occurrence: params.occurrence,
          quantity: amount,
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        }),
      ],
    };
  });
}

function isSimpleStakeOperation(classification: OperationClassification, context: SolanaPostingBuildContext): boolean {
  return (
    classification.operation.category === 'staking' &&
    classification.operation.type === 'stake' &&
    context.fundFlow.outflows.length > 0 &&
    context.fundFlow.inflows.length === 0
  );
}

function isSimpleUnstakeOperation(
  classification: OperationClassification,
  context: SolanaPostingBuildContext
): boolean {
  return (
    classification.operation.category === 'staking' &&
    classification.operation.type === 'unstake' &&
    context.fundFlow.inflows.length > 0 &&
    context.fundFlow.outflows.length === 0
  );
}

function buildValuePosting(params: {
  assetRef: SolanaAssetRef;
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
    postingStableKey: `${params.postingKeyPrefix}:${params.assetRef.assetId}:${params.occurrence}`,
    assetId: params.assetRef.assetId,
    assetSymbol: params.assetRef.assetSymbol,
    quantity: params.quantity,
    role: params.role,
    balanceCategory: params.balanceCategory,
    sourceComponentRefs: [
      buildPostingComponentRef({
        assetId: params.assetRef.assetId,
        componentId: params.componentId,
        componentKind: params.componentKind,
        occurrence: params.occurrence,
        quantity: params.quantity.abs(),
        sourceActivityFingerprint: params.sourceActivityFingerprint,
      }),
    ],
  };
}

function buildSimpleStakePostings(params: {
  chainConfig: SolanaChainConfig;
  context: SolanaPostingBuildContext;
  occurrenceStart: number;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (let index = 0; index < params.context.fundFlow.outflows.length; index++) {
      const movement = params.context.fundFlow.outflows[index]!;
      const amount = yield* parseLedgerDecimalAmount({
        label: 'stake movement',
        processorLabel: 'Solana v2',
        transactionId: params.context.transaction.id,
        value: movement.amount,
      });
      if (amount.isZero()) {
        continue;
      }

      const assetRef = yield* buildSolanaAssetRefFromMovement({
        chainConfig: params.chainConfig,
        movement,
        transactionId: params.context.transaction.id,
      });
      const occurrence = params.occurrenceStart + postings.length;
      const componentId = `${params.context.transaction.eventId}:staking_principal:${index + 1}`;

      postings.push(
        buildValuePosting({
          assetRef,
          balanceCategory: 'liquid',
          componentId,
          componentKind: 'message',
          occurrence,
          postingKeyPrefix: 'protocol_deposit:liquid_to_staked:out',
          quantity: amount.negated(),
          role: 'protocol_deposit',
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        }),
        buildValuePosting({
          assetRef,
          balanceCategory: 'staked',
          componentId,
          componentKind: 'message',
          occurrence: occurrence + 1,
          postingKeyPrefix: 'principal:liquid_to_staked:in',
          quantity: amount,
          role: 'principal',
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        })
      );
    }

    return postings;
  });
}

function buildSimpleUnstakePostings(params: {
  chainConfig: SolanaChainConfig;
  context: SolanaPostingBuildContext;
  occurrenceStart: number;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (let index = 0; index < params.context.fundFlow.inflows.length; index++) {
      const movement = params.context.fundFlow.inflows[index]!;
      const amount = yield* parseLedgerDecimalAmount({
        label: 'unstake movement',
        processorLabel: 'Solana v2',
        transactionId: params.context.transaction.id,
        value: movement.amount,
      });
      if (amount.isZero()) {
        continue;
      }

      const assetRef = yield* buildSolanaAssetRefFromMovement({
        chainConfig: params.chainConfig,
        movement,
        transactionId: params.context.transaction.id,
      });
      const occurrence = params.occurrenceStart + postings.length;
      const componentId = `${params.context.transaction.eventId}:staking_principal:${index + 1}`;

      postings.push(
        buildValuePosting({
          assetRef,
          balanceCategory: 'staked',
          componentId,
          componentKind: 'message',
          occurrence,
          postingKeyPrefix: 'principal:staked_to_liquid:out',
          quantity: amount.negated(),
          role: 'principal',
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        }),
        buildValuePosting({
          assetRef,
          balanceCategory: 'liquid',
          componentId,
          componentKind: 'message',
          occurrence: occurrence + 1,
          postingKeyPrefix: 'protocol_refund:staked_to_liquid:in',
          quantity: amount,
          role: 'protocol_refund',
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        })
      );
    }

    return postings;
  });
}

export function buildSolanaValuePostings(params: {
  chainConfig: SolanaChainConfig;
  classification: OperationClassification;
  context: SolanaPostingBuildContext;
}): Result<AccountingPostingDraft[], Error> {
  if (isSimpleStakeOperation(params.classification, params.context)) {
    return buildSimpleStakePostings({
      chainConfig: params.chainConfig,
      context: params.context,
      occurrenceStart: 1,
    });
  }

  if (isSimpleUnstakeOperation(params.classification, params.context)) {
    return buildSimpleUnstakePostings({
      chainConfig: params.chainConfig,
      context: params.context,
      occurrenceStart: 1,
    });
  }

  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];
    const movementInputs: SolanaMovementPostingInput[] = [
      ...params.context.fundFlow.outflows.map((movement) => ({ direction: 'out' as const, movement })),
      ...params.context.fundFlow.inflows.map((movement) => ({ direction: 'in' as const, movement })),
    ];

    for (let index = 0; index < movementInputs.length; index++) {
      const input = movementInputs[index];
      if (!input) {
        continue;
      }

      const posting = yield* buildMovementPosting({
        chainConfig: params.chainConfig,
        classification: params.classification,
        context: params.context,
        input,
        occurrence: index + 1,
      });

      if (posting) {
        postings.push(posting);
      }
    }

    return postings;
  });
}

export function buildOptionalSolanaNetworkFeePosting(params: {
  chainConfig: SolanaChainConfig;
  context: SolanaPostingBuildContext;
}): Result<AccountingPostingDraft | undefined, Error> {
  if (!params.context.fundFlow.feePaidByUser) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeAmount = yield* parseLedgerDecimalAmount({
      allowMissing: true,
      label: 'fee',
      processorLabel: 'Solana v2',
      transactionId: params.context.transaction.id,
      value: params.context.fundFlow.feeAmount,
    });
    if (feeAmount.isZero()) {
      return undefined;
    }

    const feeCurrency = yield* parseCurrency(params.context.fundFlow.feeCurrency);
    if (feeCurrency !== params.chainConfig.nativeCurrency) {
      return yield* err(
        new Error(`Solana v2 transaction ${params.context.transaction.id} has non-native fee currency ${feeCurrency}`)
      );
    }

    const feeAssetId = yield* buildBlockchainNativeAssetId(params.chainConfig.chainName);

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
          componentId: `${params.context.transaction.eventId}:network_fee`,
          componentKind: 'network_fee',
          quantity: feeAmount,
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        }),
      ],
    };
  });
}
