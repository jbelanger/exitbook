import type { TransactionStatus } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

const logger = getLogger('coinbase-utils');

interface TypeSpecificIds {
  id?: string;
  order_id?: string;
  trade_id?: string;
  transfer_id?: string;
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
export function extractCorrelationId(rawInfo: RawCoinbaseLedgerEntry): string {
  const typeSpecificData: TypeSpecificIds | undefined =
    (rawInfo.advanced_trade_fill as TypeSpecificIds | undefined) ??
    (rawInfo.buy as TypeSpecificIds | undefined) ??
    (rawInfo.sell as TypeSpecificIds | undefined) ??
    (rawInfo.send as TypeSpecificIds | undefined) ??
    (rawInfo.trade as TypeSpecificIds | undefined);

  if (typeSpecificData) {
    // Priority order for correlation IDs:
    // 1. id - Used by buy, sell, trade types to group related entries
    // 2. order_id - Used by advanced_trade_fill to group multiple fills
    // 3. trade_id - Groups entries from same trade execution
    // 4. transfer_id - Groups entries from same transfer
    return (
      typeSpecificData.id ??
      typeSpecificData.order_id ??
      typeSpecificData.trade_id ??
      typeSpecificData.transfer_id ??
      rawInfo.id
    );
  }

  // Fall back to transaction id for non-correlated entries
  return rawInfo.id;
}
