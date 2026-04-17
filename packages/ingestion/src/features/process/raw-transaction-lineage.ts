import { NearStreamEventSchema, type NearStreamEvent } from '@exitbook/blockchain-providers/near';
import type { RawTransaction, TransactionDraft } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { ProcessedTransactionWrite } from '../../ports/processed-transaction-sink.js';

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
