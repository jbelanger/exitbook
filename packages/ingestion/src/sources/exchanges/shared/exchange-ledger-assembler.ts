import type { TransactionDiagnostic } from '@exitbook/core';
import {
  buildExchangeAssetId,
  err,
  ok,
  parseDecimal,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import {
  computeSourceActivityFingerprint,
  type AccountingDiagnosticDraft,
  type AccountingJournalDraft,
  type AccountingJournalKind,
  type AccountingPostingDraft,
  type AccountingPostingRole,
  type AccountingSourceComponentKind,
  type SourceActivityDraft,
  type SourceComponentQuantityRef,
  validateAccountingJournalDraft,
} from '@exitbook/ledger';

import type { AccountingLedgerDraft } from '../../../shared/types/processors.js';

import type { ExchangeCorrelationGroup } from './exchange-correlation-group.js';
import type {
  ConfirmedExchangeTransactionDraft,
  ExchangeFeeDraft,
  ExchangeMovementDraft,
} from './exchange-interpretation.js';
import type { ExchangeProviderMetadata } from './exchange-provider-event.js';

export interface ExchangeLedgerOwnerAccount {
  fingerprint: string;
  id: number;
}

interface ExchangeLedgerAssemblyParams<TProviderMetadata extends ExchangeProviderMetadata = ExchangeProviderMetadata> {
  draft: ConfirmedExchangeTransactionDraft;
  group: ExchangeCorrelationGroup<TProviderMetadata>;
  ownerAccount: ExchangeLedgerOwnerAccount;
}

interface MovementPostingInput {
  direction: 'in' | 'out';
  movement: ExchangeMovementDraft;
  occurrence: number;
  operationCategory: ConfirmedExchangeTransactionDraft['operation']['category'];
  providerName: string;
  sourceActivityFingerprint: string;
  sourceEvents: readonly ExchangeCorrelationGroup['events'][number][];
}

interface FeePostingInput {
  fee: ExchangeFeeDraft;
  occurrence: number;
  sourceActivityFingerprint: string;
  sourceEvents: readonly ExchangeCorrelationGroup['events'][number][];
}

export function assembleExchangeLedgerDraft<TProviderMetadata extends ExchangeProviderMetadata>(
  params: ExchangeLedgerAssemblyParams<TProviderMetadata>
): Result<AccountingLedgerDraft, Error> {
  return resultDo(function* () {
    const sourceActivityStableKey = buildExchangeSourceActivityStableKey(params.group);
    const sourceActivityFingerprint = yield* computeSourceActivityFingerprint({
      accountFingerprint: params.ownerAccount.fingerprint,
      platformKey: params.draft.source,
      platformKind: 'exchange',
      sourceActivityOrigin: 'provider_event',
      sourceActivityStableKey,
    });

    const sourceActivity = buildExchangeSourceActivityDraft({
      draft: params.draft,
      ownerAccount: params.ownerAccount,
      sourceActivityFingerprint,
      sourceActivityStableKey,
    });

    const postings = yield* buildExchangePostings({
      draft: params.draft,
      group: params.group,
      sourceActivityFingerprint,
    });
    if (postings.length === 0) {
      return yield* err(
        new Error(`Exchange source activity ${sourceActivityStableKey} has no accounting postings to materialize`)
      );
    }

    const journal: AccountingJournalDraft = {
      sourceActivityFingerprint,
      journalStableKey: 'primary',
      journalKind: resolveExchangeJournalKind(params.draft, postings),
      postings,
      ...buildOptionalJournalDiagnostics(params.draft.diagnostics),
    };
    const journalValidation = validateAccountingJournalDraft(journal);
    if (journalValidation.isErr()) {
      return yield* err(journalValidation.error);
    }

    return {
      sourceActivity,
      journals: [journal],
      sourceEventIds: params.group.events.map((event) => event.providerEventId),
    };
  });
}

function buildExchangeSourceActivityStableKey(group: ExchangeCorrelationGroup): string {
  return `provider-event-group:${group.correlationKey}`;
}

function buildExchangeSourceActivityDraft(params: {
  draft: ConfirmedExchangeTransactionDraft;
  ownerAccount: ExchangeLedgerOwnerAccount;
  sourceActivityFingerprint: string;
  sourceActivityStableKey: string;
}): SourceActivityDraft {
  return {
    ownerAccountId: params.ownerAccount.id,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: params.sourceActivityStableKey,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: params.draft.source,
    platformKind: 'exchange',
    activityStatus: params.draft.status,
    activityDatetime: new Date(params.draft.timestamp).toISOString(),
    activityTimestampMs: params.draft.timestamp,
    ...(params.draft.from ? { fromAddress: params.draft.from } : {}),
    ...(params.draft.to ? { toAddress: params.draft.to } : {}),
    ...(params.draft.blockchain
      ? {
          blockchainName: params.draft.blockchain.name,
          ...(params.draft.blockchain.blockHeight !== undefined
            ? { blockchainBlockHeight: params.draft.blockchain.blockHeight }
            : {}),
          blockchainTransactionHash: params.draft.blockchain.transactionHash,
          blockchainIsConfirmed: params.draft.blockchain.isConfirmed,
        }
      : {}),
  };
}

function buildOptionalJournalDiagnostics(
  diagnostics: readonly TransactionDiagnostic[] | undefined
): { diagnostics: AccountingDiagnosticDraft[] } | Record<string, never> {
  if (diagnostics === undefined || diagnostics.length === 0) {
    return {};
  }

  return {
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.severity !== undefined ? { severity: diagnostic.severity } : {}),
      ...(diagnostic.metadata !== undefined ? { metadata: diagnostic.metadata } : {}),
    })),
  };
}

function resolveExchangeJournalKind(
  draft: ConfirmedExchangeTransactionDraft,
  postings: readonly AccountingPostingDraft[]
): AccountingJournalKind {
  const nonFeePostings = postings.filter((posting) => posting.role !== 'fee');

  if (nonFeePostings.length === 0) {
    return 'expense_only';
  }

  if (nonFeePostings.every((posting) => posting.role === 'refund_rebate')) {
    return 'refund_rebate';
  }

  if (nonFeePostings.every((posting) => posting.role === 'staking_reward')) {
    return 'staking_reward';
  }

  if (
    nonFeePostings.some(
      (posting) =>
        posting.role === 'protocol_deposit' ||
        posting.role === 'protocol_refund' ||
        posting.role === 'protocol_overhead'
    )
  ) {
    return 'protocol_event';
  }

  if (draft.operation.category === 'trade') {
    return 'trade';
  }

  if (draft.operation.category === 'fee') {
    return 'expense_only';
  }

  return 'transfer';
}

function buildExchangePostings<TProviderMetadata extends ExchangeProviderMetadata>(params: {
  draft: ConfirmedExchangeTransactionDraft;
  group: ExchangeCorrelationGroup<TProviderMetadata>;
  sourceActivityFingerprint: string;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const postings: AccountingPostingDraft[] = [];

    for (let index = 0; index < params.draft.movements.inflows.length; index++) {
      const movement = params.draft.movements.inflows[index];
      if (movement === undefined) {
        continue;
      }

      postings.push(
        yield* buildMovementPosting({
          direction: 'in',
          movement,
          occurrence: index + 1,
          operationCategory: params.draft.operation.category,
          providerName: params.group.providerName,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          sourceEvents: params.group.events,
        })
      );
    }

    for (let index = 0; index < params.draft.movements.outflows.length; index++) {
      const movement = params.draft.movements.outflows[index];
      if (movement === undefined) {
        continue;
      }

      postings.push(
        yield* buildMovementPosting({
          direction: 'out',
          movement,
          occurrence: index + 1,
          operationCategory: params.draft.operation.category,
          providerName: params.group.providerName,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          sourceEvents: params.group.events,
        })
      );
    }

    for (let index = 0; index < params.draft.fees.length; index++) {
      const fee = params.draft.fees[index];
      if (fee === undefined) {
        continue;
      }

      postings.push(
        yield* buildFeePosting({
          fee,
          occurrence: index + 1,
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          sourceEvents: params.group.events,
        })
      );
    }

    return postings;
  });
}

function buildMovementPosting(params: MovementPostingInput): Result<AccountingPostingDraft, Error> {
  return resultDo(function* () {
    const absoluteQuantity = parseDecimal(params.movement.grossAmount);
    if (!absoluteQuantity.gt(0)) {
      return yield* err(
        new Error(
          `Exchange movement posting ${params.movement.assetId} must have a positive gross amount, received ${params.movement.grossAmount}`
        )
      );
    }

    const quantity = params.direction === 'in' ? absoluteQuantity : absoluteQuantity.negated();
    const role = yield* resolveMovementPostingRole(params.movement, quantity.toFixed());
    const sourceComponentRefs = yield* buildMovementSourceComponentRefs({
      assetId: params.movement.assetId,
      direction: params.direction,
      operationCategory: params.operationCategory,
      providerName: params.providerName,
      quantity: absoluteQuantity,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      sourceEvents: params.sourceEvents,
    });

    return {
      postingStableKey: `movement:${params.direction}:${params.movement.assetId}:${params.occurrence}`,
      assetId: params.movement.assetId,
      assetSymbol: params.movement.assetSymbol,
      quantity,
      role,
      balanceCategory: 'liquid',
      sourceComponentRefs,
    };
  });
}

function buildFeePosting(params: FeePostingInput): Result<AccountingPostingDraft, Error> {
  return resultDo(function* () {
    const feeQuantity = parseDecimal(params.fee.amount);
    if (!feeQuantity.gt(0)) {
      return yield* err(
        new Error(
          `Exchange fee posting ${params.fee.assetId} must have a positive amount, received ${params.fee.amount}`
        )
      );
    }

    const sourceComponentRefs = yield* buildFeeSourceComponentRefs({
      assetId: params.fee.assetId,
      assetSymbol: params.fee.assetSymbol,
      feeQuantity,
      sourceActivityFingerprint: params.sourceActivityFingerprint,
      sourceEvents: params.sourceEvents,
    });

    return {
      postingStableKey: `fee:${params.fee.assetId}:${params.occurrence}`,
      assetId: params.fee.assetId,
      assetSymbol: params.fee.assetSymbol,
      quantity: feeQuantity.negated(),
      role: 'fee',
      balanceCategory: 'liquid',
      settlement: params.fee.settlement,
      sourceComponentRefs,
    };
  });
}

function resolveMovementPostingRole(
  movement: ExchangeMovementDraft,
  signedQuantity: string
): Result<AccountingPostingRole, Error> {
  const quantity = parseDecimal(signedQuantity);
  switch (movement.movementRole) {
    case undefined:
      return ok('principal');
    case 'staking_reward':
      return ok('staking_reward');
    case 'protocol_overhead':
      return ok('protocol_overhead');
    case 'refund_rebate':
      if (quantity.gt(0)) {
        return ok('refund_rebate');
      }

      return err(
        new Error(
          `Exchange movement ${movement.assetId} is marked refund_rebate but has negative quantity ${quantity.toFixed()}; ledger refund/rebate postings must be positive`
        )
      );
  }

  return err(new Error(`Unsupported exchange movement role ${String(movement.movementRole)}`));
}

function buildMovementSourceComponentRefs(params: {
  assetId: string;
  direction: 'in' | 'out';
  operationCategory: ConfirmedExchangeTransactionDraft['operation']['category'];
  providerName: string;
  quantity: ReturnType<typeof parseDecimal>;
  sourceActivityFingerprint: string;
  sourceEvents: readonly ExchangeCorrelationGroup['events'][number][];
}): Result<SourceComponentQuantityRef[], Error> {
  return resultDo(function* () {
    const refs: SourceComponentQuantityRef[] = [];
    for (const event of params.sourceEvents) {
      const eventAssetId = yield* buildExchangeAssetId(params.providerName, event.assetSymbol);
      if (eventAssetId !== params.assetId) {
        continue;
      }

      const eventAmount = parseDecimal(event.rawAmount);
      if (params.direction === 'in' && !eventAmount.gt(0)) {
        continue;
      }

      if (params.direction === 'out' && !eventAmount.lt(0)) {
        continue;
      }

      refs.push({
        component: {
          sourceActivityFingerprint: params.sourceActivityFingerprint,
          componentKind: resolveMovementComponentKind(params.operationCategory),
          componentId: event.providerEventId,
          assetId: params.assetId,
        },
        quantity: eventAmount.abs(),
      });
    }

    return yield* validateSourceComponentQuantityTotal({
      assetId: params.assetId,
      expectedQuantity: params.quantity,
      refs,
      source: 'movement',
    });
  });
}

function buildFeeSourceComponentRefs(params: {
  assetId: string;
  assetSymbol: Currency;
  feeQuantity: ReturnType<typeof parseDecimal>;
  sourceActivityFingerprint: string;
  sourceEvents: readonly ExchangeCorrelationGroup['events'][number][];
}): Result<SourceComponentQuantityRef[], Error> {
  const refs: SourceComponentQuantityRef[] = [];

  for (const event of params.sourceEvents) {
    const feeAmount = parseDecimal(event.rawFee ?? '0');
    if (!feeAmount.gt(0)) {
      continue;
    }

    if (event.rawFeeCurrency !== params.assetSymbol) {
      continue;
    }

    refs.push({
      component: {
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        componentKind: 'exchange_fee',
        componentId: event.providerEventId,
        assetId: params.assetId,
      },
      quantity: feeAmount,
    });
  }

  return validateSourceComponentQuantityTotal({
    assetId: params.assetId,
    expectedQuantity: params.feeQuantity,
    refs,
    source: 'fee',
  });
}

function resolveMovementComponentKind(
  operationCategory: ConfirmedExchangeTransactionDraft['operation']['category']
): AccountingSourceComponentKind {
  return operationCategory === 'trade' ? 'exchange_fill' : 'raw_event';
}

function validateSourceComponentQuantityTotal(params: {
  assetId: string;
  expectedQuantity: ReturnType<typeof parseDecimal>;
  refs: SourceComponentQuantityRef[];
  source: 'fee' | 'movement';
}): Result<SourceComponentQuantityRef[], Error> {
  if (params.refs.length === 0) {
    return err(new Error(`Exchange ${params.source} posting for ${params.assetId} has no source component refs`));
  }

  const actualQuantity = params.refs.reduce((total, ref) => total.plus(ref.quantity), parseDecimal('0'));
  if (!actualQuantity.eq(params.expectedQuantity)) {
    return err(
      new Error(
        `Exchange ${params.source} posting for ${params.assetId} source component total ${actualQuantity.toFixed()} does not match posting quantity ${params.expectedQuantity.toFixed()}`
      )
    );
  }

  return ok(params.refs);
}
