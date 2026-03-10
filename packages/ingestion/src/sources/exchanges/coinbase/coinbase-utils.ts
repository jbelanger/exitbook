import type { TransactionStatus } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('coinbase-utils');

interface TypeSpecificIds {
  id?: string;
  order_id?: string;
  trade_id?: string;
  transfer_id?: string;
}

export type CoinbaseCorrelationSource = 'event_id' | 'id' | 'order_id' | 'trade_id' | 'transfer_id';

export interface CoinbaseCorrelationEvidence {
  correlationKey: string;
  correlationSource: CoinbaseCorrelationSource;
}

/**
 * Map Coinbase status to universal status format
 */
export function mapCoinbaseStatus(status: string | undefined): Result<TransactionStatus, Error> {
  if (!status) {
    logger.warn('Coinbase transaction missing status, defaulting to success');
    return ok('success');
  }

  switch (status.toLowerCase()) {
    case 'pending':
      return ok('pending');
    case 'ok':
    case 'completed':
    case 'success':
      return ok('success');
    case 'canceled':
    case 'cancelled':
      return ok('canceled');
    case 'failed':
      return ok('failed');
    default:
      return err(new Error(`Unknown Coinbase status "${status}"`));
  }
}

/**
 * Extract correlation ID from a raw Coinbase API v2 transaction.
 *
 * Different transaction types store correlation IDs in different locations
 * within their type-specific nested objects.
 */
export function extractCorrelationEvidence(rawInfo: RawCoinbaseLedgerEntry): CoinbaseCorrelationEvidence {
  const typeSpecificData: TypeSpecificIds | undefined =
    (rawInfo.advanced_trade_fill as TypeSpecificIds | undefined) ??
    (rawInfo.buy as TypeSpecificIds | undefined) ??
    (rawInfo.sell as TypeSpecificIds | undefined) ??
    (rawInfo.send as TypeSpecificIds | undefined) ??
    (rawInfo.trade as TypeSpecificIds | undefined);

  if (typeSpecificData) {
    if (typeSpecificData.id) {
      return { correlationKey: typeSpecificData.id, correlationSource: 'id' };
    }

    if (typeSpecificData.order_id) {
      return { correlationKey: typeSpecificData.order_id, correlationSource: 'order_id' };
    }

    if (typeSpecificData.trade_id) {
      return { correlationKey: typeSpecificData.trade_id, correlationSource: 'trade_id' };
    }

    if (typeSpecificData.transfer_id) {
      return { correlationKey: typeSpecificData.transfer_id, correlationSource: 'transfer_id' };
    }
  }

  // Fall back to transaction id for non-correlated entries
  return { correlationKey: rawInfo.id, correlationSource: 'event_id' };
}

export function extractCorrelationId(rawInfo: RawCoinbaseLedgerEntry): string {
  return extractCorrelationEvidence(rawInfo).correlationKey;
}
