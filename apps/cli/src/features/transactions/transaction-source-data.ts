import type { RawTransaction } from '@exitbook/core';

import type { TransactionSourceDataItem, TransactionSourceLineageItem } from './transactions-view-model.js';

export function toTransactionSourceLineageItem(rawTransaction: RawTransaction): TransactionSourceLineageItem {
  return {
    rawTransactionId: rawTransaction.id,
    providerName: rawTransaction.providerName,
    eventId: rawTransaction.eventId,
    timestamp: new Date(rawTransaction.timestamp).toISOString(),
    processingStatus: rawTransaction.processingStatus,
    transactionTypeHint: rawTransaction.transactionTypeHint,
    blockchainTransactionHash: rawTransaction.blockchainTransactionHash,
    sourceAddress: rawTransaction.sourceAddress,
  };
}

export function toTransactionSourceDataItem(rawTransaction: RawTransaction): TransactionSourceDataItem {
  return {
    ...toTransactionSourceLineageItem(rawTransaction),
    providerPayload: rawTransaction.providerData,
    normalizedPayload: rawTransaction.normalizedData,
  };
}
