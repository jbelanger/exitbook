import { normalizeEvmAddress, type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import {
  buildBlockchainNativeAssetId,
  err,
  ok,
  parseCurrency,
  parseDecimal,
  resultDo,
  type Result,
} from '@exitbook/foundation';
import type { AccountingPostingDraft, AccountingPostingRole, SourceComponentQuantityRef } from '@exitbook/ledger';

import { buildSourceComponentQuantityRef } from '../shared/ledger-assembler-utils.js';

import {
  buildEvmAssetRefFromMovement,
  isEvmNativeMovementTransaction,
  normalizeEvmTransactionQuantity,
} from './journal-assembler-amounts.js';
import type {
  AccountBasedLedgerChainConfig,
  EvmMovementDirection,
  EvmMovementPostingInput,
} from './journal-assembler-types.js';
import type { EvmFundFlow, EvmMovement } from './types.js';

function matchesEvmAddress(address: string | undefined, target: string): boolean {
  return address !== undefined && normalizeEvmAddress(address) === target;
}

function movementMatchesTransaction(
  movement: EvmMovement,
  transaction: EvmTransaction,
  chainConfig: AccountBasedLedgerChainConfig
): boolean {
  if (movement.tokenAddress !== undefined) {
    return normalizeEvmAddress(transaction.tokenAddress) === normalizeEvmAddress(movement.tokenAddress);
  }

  const transactionAssetSymbol = transaction.tokenSymbol ?? transaction.currency;
  return (
    transaction.tokenAddress === undefined &&
    (isEvmNativeMovementTransaction(transaction, chainConfig) || transaction.tokenType === 'native') &&
    transactionAssetSymbol.toLowerCase() === movement.asset.toLowerCase()
  );
}

function transactionMatchesDirection(
  transaction: EvmTransaction,
  direction: EvmMovementDirection,
  primaryAddress: string
): boolean {
  return direction === 'in'
    ? matchesEvmAddress(transaction.to, primaryAddress)
    : matchesEvmAddress(transaction.from, primaryAddress);
}

function resolveMovementRole(movement: EvmMovement, direction: EvmMovementDirection): AccountingPostingRole {
  if (direction === 'in' && movement.movementRole === 'staking_reward') {
    return 'staking_reward';
  }

  return 'principal';
}

function resolveMovementComponentKind(
  movement: EvmMovement,
  direction: EvmMovementDirection
): 'account_delta' | 'staking_reward' {
  return resolveMovementRole(movement, direction) === 'staking_reward' ? 'staking_reward' : 'account_delta';
}

function buildMovementComponentRefs(params: {
  assetId: string;
  chainConfig: AccountBasedLedgerChainConfig;
  direction: EvmMovementDirection;
  movement: EvmMovement;
  primaryAddress: string;
  sourceActivityFingerprint: string;
  transactionHash: string;
  transactions: readonly EvmTransaction[];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];

    for (const transaction of params.transactions) {
      if (
        !transactionMatchesDirection(transaction, params.direction, params.primaryAddress) ||
        !movementMatchesTransaction(params.movement, transaction, params.chainConfig)
      ) {
        continue;
      }

      const quantity = yield* normalizeEvmTransactionQuantity(transaction, params.chainConfig);
      if (quantity.isZero()) {
        continue;
      }

      refs.push(
        buildSourceComponentQuantityRef({
          assetId: params.assetId,
          componentId: transaction.eventId,
          componentKind: resolveMovementComponentKind(params.movement, params.direction),
          quantity,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
        })
      );
    }

    if (refs.length === 0) {
      return yield* err(
        new Error(
          `EVM v2 ${params.direction} posting for transaction ${params.transactionHash} asset ${params.movement.asset} has no source component refs`
        )
      );
    }

    return refs;
  });
}

function buildMovementPosting(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  input: EvmMovementPostingInput;
  occurrence: number;
  primaryAddress: string;
  sourceActivityFingerprint: string;
  transactionHash: string;
  transactions: readonly EvmTransaction[];
}): Result<AccountingPostingDraft | undefined, Error> {
  const movementAmount = parseDecimal(params.input.movement.amount);
  if (movementAmount.isZero()) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const assetRef = yield* buildEvmAssetRefFromMovement(
      params.input.movement,
      params.chainConfig,
      params.transactionHash
    );
    const role = resolveMovementRole(params.input.movement, params.input.direction);
    const sourceComponentRefs = yield* buildMovementComponentRefs({
      assetId: assetRef.assetId,
      chainConfig: params.chainConfig,
      direction: params.input.direction,
      movement: params.input.movement,
      primaryAddress: params.primaryAddress,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      transactionHash: params.transactionHash,
      transactions: params.transactions,
    });

    return {
      postingStableKey: `${role}:${params.input.direction}:${assetRef.assetId}:${params.occurrence}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: params.input.direction === 'in' ? movementAmount : movementAmount.negated(),
      role,
      sourceComponentRefs,
    };
  });
}

export function buildEvmValuePostings(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  fundFlow: EvmFundFlow;
  primaryAddress: string;
  sourceActivityFingerprint: string;
  transactionHash: string;
  transactions: readonly EvmTransaction[];
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];
    const movementInputs: EvmMovementPostingInput[] = [
      ...params.fundFlow.outflows.map((movement) => ({ direction: 'out' as const, movement })),
      ...params.fundFlow.inflows.map((movement) => ({ direction: 'in' as const, movement })),
    ];

    for (let index = 0; index < movementInputs.length; index++) {
      const input = movementInputs[index];
      if (!input) {
        continue;
      }

      const posting = yield* buildMovementPosting({
        chainConfig: params.chainConfig,
        input,
        occurrence: index + 1,
        primaryAddress: params.primaryAddress,
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        transactionHash: params.transactionHash,
        transactions: params.transactions,
      });

      if (posting) {
        postings.push(posting);
      }
    }

    return postings;
  });
}

function findFeeSourceTransaction(transactions: readonly EvmTransaction[]): EvmTransaction | undefined {
  return (
    transactions.find(
      (transaction) =>
        transaction.type !== 'token_transfer' &&
        transaction.feeAmount !== undefined &&
        !parseDecimal(transaction.feeAmount).isZero()
    ) ??
    transactions.find((transaction) => transaction.type !== 'token_transfer' && transaction.feeAmount !== undefined) ??
    transactions.find((transaction) => transaction.type !== 'token_transfer') ??
    transactions[0]
  );
}

function shouldRecordNetworkFee(fundFlow: EvmFundFlow, primaryAddress: string): boolean {
  if (fundFlow.feePayerAddress !== undefined) {
    return matchesEvmAddress(fundFlow.feePayerAddress, primaryAddress);
  }

  return fundFlow.outflows.length > 0 || matchesEvmAddress(fundFlow.fromAddress, primaryAddress);
}

export function buildOptionalEvmNetworkFeePosting(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  fundFlow: EvmFundFlow;
  primaryAddress: string;
  sourceActivityFingerprint: string;
  transactions: readonly EvmTransaction[];
}): Result<AccountingPostingDraft | undefined, Error> {
  const feeAmount = parseDecimal(params.fundFlow.feeAmount);
  if (feeAmount.isZero() || !shouldRecordNetworkFee(params.fundFlow, params.primaryAddress)) {
    return ok(undefined);
  }

  return resultDo(function* () {
    const feeAssetId = yield* buildBlockchainNativeAssetId(params.chainConfig.chainName);
    const feeCurrency = yield* parseCurrency(params.fundFlow.feeCurrency);
    const feeSourceTransaction = findFeeSourceTransaction(params.transactions);
    if (!feeSourceTransaction) {
      return yield* err(new Error('EVM v2 fee posting is missing a source transaction'));
    }

    return {
      postingStableKey: 'network_fee:native',
      assetId: feeAssetId,
      assetSymbol: feeCurrency,
      quantity: feeAmount.negated(),
      role: 'fee',
      settlement: 'on-chain',
      sourceComponentRefs: [
        buildSourceComponentQuantityRef({
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
