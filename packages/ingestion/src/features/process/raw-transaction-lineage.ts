import { NearStreamEventSchema, type NearStreamEvent } from '@exitbook/blockchain-providers/near';
import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountingLedgerWrite } from '../../ports/accounting-ledger-sink.js';
import type { ProcessedTransactionWrite } from '../../ports/processed-transaction-sink.js';
import type { AccountingLedgerDraft } from '../../shared/types/processors.js';

interface BuildProcessedTransactionWritesParams {
  platformKey: string;
  platformKind: string;
  rawTransactions: RawTransaction[];
  transactions: TransactionDraft[];
}

export function buildProcessedTransactionWrites(
  params: BuildProcessedTransactionWritesParams
): Result<ProcessedTransactionWrite[], Error> {
  if (params.transactions.length === 0) {
    return ok([]);
  }

  if (params.platformKind === 'exchange-api' || params.platformKind === 'exchange-csv') {
    return buildExchangeTransactionWrites(params.transactions, params.rawTransactions);
  }

  if (params.platformKey.toLowerCase() === 'near') {
    return buildNearTransactionWrites(params.transactions, params.rawTransactions);
  }

  return buildBlockchainTransactionWrites(params.transactions, params.rawTransactions);
}

export function buildAccountingLedgerWrites(params: {
  ledgerDrafts: readonly AccountingLedgerDraft[];
  platformKind: string;
  rawTransactions: readonly RawTransaction[];
}): Result<AccountingLedgerWrite[], Error> {
  if (params.ledgerDrafts.length === 0) {
    return ok([]);
  }

  if (params.platformKind === 'exchange-api' || params.platformKind === 'exchange-csv') {
    return buildExchangeAccountingLedgerWrites(params.ledgerDrafts, params.rawTransactions);
  }

  if (params.platformKind !== 'blockchain') {
    return err(new Error(`Accounting ledger shadow writes are not supported for ${params.platformKind} sources yet`));
  }

  const rawTransactionIdsByHash = buildRawTransactionIdsByBlockchainHash(params.rawTransactions);
  const writes: AccountingLedgerWrite[] = [];

  for (const draft of params.ledgerDrafts) {
    const transactionHash = draft.sourceActivity.blockchainTransactionHash?.trim();
    if (!transactionHash) {
      return err(
        new Error(
          `Ledger source activity ${draft.sourceActivity.sourceActivityFingerprint} is missing blockchainTransactionHash`
        )
      );
    }

    const rawTransactionIds = rawTransactionIdsByHash.get(transactionHash);
    if (!rawTransactionIds || rawTransactionIds.length === 0) {
      return err(
        new Error(`Could not resolve raw transaction binding for ledger source activity hash ${transactionHash}`)
      );
    }

    writes.push({
      journals: draft.journals,
      rawTransactionIds: dedupeRawTransactionIds(rawTransactionIds),
      sourceActivity: draft.sourceActivity,
    });
  }

  return ok(writes);
}

function buildExchangeAccountingLedgerWrites(
  ledgerDrafts: readonly AccountingLedgerDraft[],
  rawTransactions: readonly RawTransaction[]
): Result<AccountingLedgerWrite[], Error> {
  const rawIdByEventId = new Map<string, number>();
  for (const rawTransaction of rawTransactions) {
    rawIdByEventId.set(rawTransaction.eventId, rawTransaction.id);
  }

  const writes: AccountingLedgerWrite[] = [];
  for (const draft of ledgerDrafts) {
    const eventIdsResult = collectExchangeLedgerEventIds(draft);
    if (eventIdsResult.isErr()) {
      return err(eventIdsResult.error);
    }

    const rawTransactionIds: number[] = [];
    for (const eventId of eventIdsResult.value) {
      const rawTransactionId = rawIdByEventId.get(eventId);
      if (rawTransactionId === undefined) {
        return err(new Error(`Could not resolve raw transaction binding for exchange ledger eventId ${eventId}`));
      }

      rawTransactionIds.push(rawTransactionId);
    }

    writes.push({
      journals: draft.journals,
      rawTransactionIds: dedupeRawTransactionIds(rawTransactionIds),
      sourceActivity: draft.sourceActivity,
    });
  }

  return ok(writes);
}

function collectExchangeLedgerEventIds(draft: AccountingLedgerDraft): Result<string[], Error> {
  const sourceComponentOwnershipValidation = validateExchangeLedgerSourceComponentOwnership(draft);
  if (sourceComponentOwnershipValidation.isErr()) {
    return err(sourceComponentOwnershipValidation.error);
  }

  const explicitEventIdsResult = normalizeExplicitExchangeLedgerEventIds(draft);
  if (explicitEventIdsResult.isErr()) {
    return err(explicitEventIdsResult.error);
  }

  if (explicitEventIdsResult.value !== undefined) {
    return ok(explicitEventIdsResult.value);
  }

  const eventIds = new Set<string>();

  for (const journal of draft.journals) {
    for (const posting of journal.postings) {
      for (const sourceComponentRef of posting.sourceComponentRefs) {
        const { component } = sourceComponentRef;
        if (
          component.componentKind === 'raw_event' ||
          component.componentKind === 'exchange_fill' ||
          component.componentKind === 'exchange_fee'
        ) {
          eventIds.add(component.componentId);
        }
      }
    }
  }

  if (eventIds.size === 0) {
    return err(
      new Error(
        `Exchange ledger source activity ${draft.sourceActivity.sourceActivityFingerprint} has no raw provider event source components`
      )
    );
  }

  return ok([...eventIds].sort());
}

function validateExchangeLedgerSourceComponentOwnership(draft: AccountingLedgerDraft): Result<void, Error> {
  const expectedSourceActivityFingerprint = draft.sourceActivity.sourceActivityFingerprint;

  for (const journal of draft.journals) {
    for (const posting of journal.postings) {
      for (const sourceComponentRef of posting.sourceComponentRefs) {
        const { component } = sourceComponentRef;
        if (component.sourceActivityFingerprint !== expectedSourceActivityFingerprint) {
          return err(
            new Error(
              `Ledger posting ${posting.postingStableKey} source component belongs to ${component.sourceActivityFingerprint}, expected ${expectedSourceActivityFingerprint}`
            )
          );
        }
      }
    }
  }

  return ok(undefined);
}

function normalizeExplicitExchangeLedgerEventIds(draft: AccountingLedgerDraft): Result<string[] | undefined, Error> {
  if (draft.sourceEventIds === undefined) {
    return ok(undefined);
  }

  const eventIds = new Set<string>();
  for (const eventId of draft.sourceEventIds) {
    const normalizedEventId = eventId.trim();
    if (normalizedEventId.length === 0) {
      return err(
        new Error(
          `Exchange ledger source activity ${draft.sourceActivity.sourceActivityFingerprint} has a blank event id`
        )
      );
    }

    eventIds.add(normalizedEventId);
  }

  if (eventIds.size === 0) {
    return err(
      new Error(
        `Exchange ledger source activity ${draft.sourceActivity.sourceActivityFingerprint} has no source event ids`
      )
    );
  }

  return ok([...eventIds].sort());
}

function buildExchangeTransactionWrites(
  transactions: TransactionDraft[],
  rawTransactions: RawTransaction[]
): Result<ProcessedTransactionWrite[], Error> {
  const rawIdByEventId = new Map<string, number>();
  for (const rawTransaction of rawTransactions) {
    rawIdByEventId.set(rawTransaction.eventId, rawTransaction.id);
  }

  const writes: ProcessedTransactionWrite[] = [];
  for (const transaction of transactions) {
    const componentEventIds = transaction.identityMaterial?.componentEventIds;
    if (!componentEventIds || componentEventIds.length === 0) {
      return err(
        new Error(
          `Exchange transaction ${transaction.platformKey} at ${transaction.datetime} is missing identityMaterial.componentEventIds`
        )
      );
    }

    const rawTransactionIds: number[] = [];
    for (const eventId of componentEventIds) {
      const rawTransactionId = rawIdByEventId.get(eventId);
      if (rawTransactionId === undefined) {
        return err(new Error(`Could not resolve raw transaction binding for exchange eventId ${eventId}`));
      }

      rawTransactionIds.push(rawTransactionId);
    }

    writes.push({
      rawTransactionIds: dedupeRawTransactionIds(rawTransactionIds),
      transaction,
    });
  }

  return ok(writes);
}

function buildBlockchainTransactionWrites(
  transactions: TransactionDraft[],
  rawTransactions: RawTransaction[]
): Result<ProcessedTransactionWrite[], Error> {
  const rawTransactionIdsByHash = buildRawTransactionIdsByBlockchainHash(rawTransactions);

  const writes: ProcessedTransactionWrite[] = [];
  for (const transaction of transactions) {
    const transactionHash = transaction.blockchain?.transaction_hash?.trim();
    if (!transactionHash) {
      return err(
        new Error(
          `Blockchain transaction ${transaction.platformKey} at ${transaction.datetime} is missing transaction hash`
        )
      );
    }

    const rawTransactionIds = rawTransactionIdsByHash.get(transactionHash);
    if (!rawTransactionIds || rawTransactionIds.length === 0) {
      return err(new Error(`Could not resolve raw transaction binding for blockchain hash ${transactionHash}`));
    }

    writes.push({
      rawTransactionIds: dedupeRawTransactionIds(rawTransactionIds),
      transaction,
    });
  }

  return ok(writes);
}

function buildRawTransactionIdsByBlockchainHash(rawTransactions: readonly RawTransaction[]): Map<string, number[]> {
  const rawTransactionIdsByHash = new Map<string, number[]>();
  for (const rawTransaction of rawTransactions) {
    const hash = rawTransaction.blockchainTransactionHash?.trim();
    if (!hash) {
      continue;
    }

    const ids = rawTransactionIdsByHash.get(hash) ?? [];
    ids.push(rawTransaction.id);
    rawTransactionIdsByHash.set(hash, ids);
  }

  return rawTransactionIdsByHash;
}

function buildNearTransactionWrites(
  transactions: TransactionDraft[],
  rawTransactions: RawTransaction[]
): Result<ProcessedTransactionWrite[], Error> {
  const rawTransactionIdsByHashResult = buildNearRawTransactionIdsByHash(rawTransactions);
  if (rawTransactionIdsByHashResult.isErr()) {
    return err(rawTransactionIdsByHashResult.error);
  }

  const writes: ProcessedTransactionWrite[] = [];
  for (const transaction of transactions) {
    const transactionHash = transaction.blockchain?.transaction_hash?.trim();
    if (!transactionHash) {
      return err(new Error(`NEAR transaction ${transaction.datetime} is missing blockchain.transaction_hash`));
    }

    const rawTransactionIds = rawTransactionIdsByHashResult.value.get(transactionHash);
    if (!rawTransactionIds || rawTransactionIds.length === 0) {
      return err(new Error(`Could not resolve raw transaction binding for NEAR hash ${transactionHash}`));
    }

    writes.push({
      rawTransactionIds: dedupeRawTransactionIds(rawTransactionIds),
      transaction,
    });
  }

  return ok(writes);
}

function buildNearRawTransactionIdsByHash(rawTransactions: RawTransaction[]): Result<Map<string, number[]>, Error> {
  const parsedEvents: { event: NearStreamEvent; rawTransactionId: number }[] = [];
  const receiptIdToTransactionHash = new Map<string, string>();

  for (const rawTransaction of rawTransactions) {
    const eventResult = NearStreamEventSchema.safeParse(rawTransaction.normalizedData);
    if (!eventResult.success) {
      return err(
        new Error(
          `Failed to parse NEAR normalized_data for raw transaction ${rawTransaction.id}: ${eventResult.error.message}`
        )
      );
    }

    parsedEvents.push({ event: eventResult.data, rawTransactionId: rawTransaction.id });

    if (eventResult.data.streamType === 'receipts') {
      receiptIdToTransactionHash.set(eventResult.data.receiptId, eventResult.data.transactionHash);
    }
  }

  const rawTransactionIdsByHash = new Map<string, number[]>();
  for (const parsedEvent of parsedEvents) {
    const transactionHash = resolveNearTransactionHash(parsedEvent.event, receiptIdToTransactionHash);
    if (!transactionHash) {
      continue;
    }

    const rawTransactionIds = rawTransactionIdsByHash.get(transactionHash) ?? [];
    rawTransactionIds.push(parsedEvent.rawTransactionId);
    rawTransactionIdsByHash.set(transactionHash, rawTransactionIds);
  }

  return ok(rawTransactionIdsByHash);
}

function resolveNearTransactionHash(
  event: NearStreamEvent,
  receiptIdToTransactionHash: ReadonlyMap<string, string>
): string | undefined {
  switch (event.streamType) {
    case 'transactions':
    case 'receipts':
    case 'token-transfers':
      return event.transactionHash;
    case 'balance-changes':
      return event.transactionHash ?? (event.receiptId ? receiptIdToTransactionHash.get(event.receiptId) : undefined);
    default:
      return undefined;
  }
}

function dedupeRawTransactionIds(rawTransactionIds: readonly number[]): number[] {
  return [...new Set(rawTransactionIds)];
}
