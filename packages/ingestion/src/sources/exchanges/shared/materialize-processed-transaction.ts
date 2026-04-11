import type { TransactionDraft } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';

import type { ConfirmedExchangeTransactionDraft } from './exchange-interpretation.js';

export function materializeProcessedTransaction(draft: ConfirmedExchangeTransactionDraft): TransactionDraft {
  const componentEventIds = draft.evidence.providerEventIds.map((eventId) => eventId.trim()).sort();

  return {
    datetime: new Date(draft.timestamp).toISOString(),
    timestamp: draft.timestamp,
    platformKey: draft.source,
    platformKind: 'exchange',
    status: draft.status,
    ...(draft.from ? { from: draft.from } : {}),
    ...(draft.to ? { to: draft.to } : {}),
    movements: {
      inflows: draft.movements.inflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        grossAmount: parseDecimal(movement.grossAmount),
        ...(movement.netAmount ? { netAmount: parseDecimal(movement.netAmount) } : {}),
      })),
      outflows: draft.movements.outflows.map((movement) => ({
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        grossAmount: parseDecimal(movement.grossAmount),
        ...(movement.netAmount ? { netAmount: parseDecimal(movement.netAmount) } : {}),
      })),
    },
    fees: draft.fees.map((fee) => ({
      assetId: fee.assetId,
      assetSymbol: fee.assetSymbol,
      amount: parseDecimal(fee.amount),
      scope: fee.scope,
      settlement: fee.settlement,
    })),
    operation: draft.operation,
    identityMaterial: {
      componentEventIds,
    },
    ...(draft.diagnostics && draft.diagnostics.length > 0 ? { diagnostics: draft.diagnostics } : {}),
    ...(draft.blockchain
      ? {
          blockchain: {
            name: draft.blockchain.name,
            ...(draft.blockchain.blockHeight ? { block_height: draft.blockchain.blockHeight } : {}),
            transaction_hash: draft.blockchain.transactionHash,
            is_confirmed: draft.blockchain.isConfirmed,
          },
        }
      : {}),
  };
}
