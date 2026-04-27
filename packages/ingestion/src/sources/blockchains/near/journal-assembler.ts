import { err, resultDo, type Result } from '@exitbook/foundation';
import { computeSourceActivityFingerprint, type SourceActivityDraft } from '@exitbook/ledger';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import { buildNearJournals } from './journal-assembler-journals.js';
import {
  buildNearFeePostings,
  buildNearLedgerMovements,
  buildNearValuePostings,
} from './journal-assembler-postings.js';
import type {
  NearLedgerDraft,
  NearProcessorV2Context,
  NearProcessorV2CorrelatedTransaction,
  NearProcessorV2ValidatedContext,
} from './journal-assembler-types.js';

export type {
  NearLedgerDraft,
  NearProcessorV2AccountContext,
  NearProcessorV2Context,
} from './journal-assembler-types.js';

function validateNearProcessorV2Context(
  context: NearProcessorV2Context
): Result<NearProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'NEAR v2');

    const primaryAddress = context.primaryAddress.trim().toLowerCase();
    if (primaryAddress.length === 0) {
      return yield* err(new Error('NEAR v2 primary address must not be empty'));
    }

    const userAddresses = [
      ...new Set(context.userAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean)),
    ];
    if (!userAddresses.includes(primaryAddress)) {
      userAddresses.push(primaryAddress);
    }
    if (userAddresses.length === 0) {
      return yield* err(new Error('NEAR v2 user address scope must contain at least one address'));
    }

    return {
      primaryAddress,
      userAddresses,
    };
  });
}

function computeNearSourceActivityFingerprint(params: {
  context: NearProcessorV2Context;
  transactionHash: string;
}): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: params.context.account.fingerprint,
    platformKey: 'near',
    platformKind: 'blockchain',
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: params.transactionHash,
  });
}

function buildNearSourceActivityDraft(params: {
  context: NearProcessorV2Context;
  correlated: NearProcessorV2CorrelatedTransaction;
  hasInflows: boolean;
  hasOutflows: boolean;
  sourceActivityFingerprint: string;
}): SourceActivityDraft {
  const transaction = params.correlated.transaction;
  const status = transaction.status === false ? 'failed' : 'success';

  return {
    ownerAccountId: params.context.account.id,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: transaction.transactionHash,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: 'near',
    platformKind: 'blockchain',
    activityStatus: status,
    activityDatetime: new Date(transaction.timestamp).toISOString(),
    activityTimestampMs: transaction.timestamp,
    ...(params.hasOutflows ? { fromAddress: transaction.signerAccountId } : {}),
    ...(params.hasInflows ? { toAddress: transaction.receiverAccountId } : {}),
    blockchainName: 'near',
    ...(transaction.blockHeight === undefined ? {} : { blockchainBlockHeight: transaction.blockHeight }),
    blockchainTransactionHash: transaction.transactionHash,
    blockchainIsConfirmed: status === 'success',
  };
}

export function assembleNearLedgerDraft(
  correlated: NearProcessorV2CorrelatedTransaction,
  context: NearProcessorV2Context
): Result<NearLedgerDraft, Error> {
  return resultDo(function* () {
    const validatedContext = yield* validateNearProcessorV2Context(context);
    const sourceActivityFingerprint = yield* computeNearSourceActivityFingerprint({
      context,
      transactionHash: correlated.transaction.transactionHash,
    });
    const movements = yield* buildNearLedgerMovements(correlated, validatedContext);
    const valuePostings = yield* buildNearValuePostings({
      movements: movements.valueMovements,
      sourceActivityFingerprint,
      transactionHash: correlated.transaction.transactionHash,
    });
    const feePostings = yield* buildNearFeePostings({
      movements: movements.feeMovements,
      sourceActivityFingerprint,
      transactionHash: correlated.transaction.transactionHash,
    });
    const journals = buildNearJournals({
      feePostings,
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildNearSourceActivityDraft({
      correlated,
      context,
      hasInflows: movements.valueMovements.some((movement) => movement.direction === 'in'),
      hasOutflows:
        movements.valueMovements.some((movement) => movement.direction === 'out') || movements.feeMovements.length > 0,
      sourceActivityFingerprint,
    });

    return {
      sourceActivity,
      journals,
    };
  });
}
