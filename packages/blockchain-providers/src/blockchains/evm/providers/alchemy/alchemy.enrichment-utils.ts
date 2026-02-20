/**
 * Alchemy transfer enrichment utilities.
 * Handles receipt-based gas fee enrichment and raw transfer deduplication.
 */

import { getErrorMessage } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import type { Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import { deduplicateTransactionHashes } from '../../receipt-utils.js';

import type { AlchemyAssetTransfer, AlchemyTransactionReceipt } from './alchemy.schemas.js';
import { AlchemyTransactionReceiptResponseSchema } from './alchemy.schemas.js';

export interface EnrichmentDeps {
  httpClient: HttpClient;
  apiKey: string;
  nativeCurrency: string;
  logger: Logger;
}

/**
 * Enriches asset transfers with gas fee data from transaction receipts.
 * Fetches receipts in parallel and adds _gasUsed, _effectiveGasPrice, and _nativeCurrency to each transfer.
 *
 * Note: This mutates the input array for performance. If any receipt is missing,
 * we fail the batch to trigger provider failover rather than silently dropping fees.
 */
export async function enrichTransfersWithGasFees(
  transfers: AlchemyAssetTransfer[],
  deps: EnrichmentDeps
): Promise<Result<void, Error>> {
  if (transfers.length === 0) {
    return ok(undefined);
  }

  const uniqueHashes = deduplicateTransactionHashes(transfers.map((t) => t.hash));

  if (uniqueHashes.length === 0) {
    return ok(undefined);
  }

  deps.logger.debug(`Fetching ${uniqueHashes.length} transaction receipts for gas fee enrichment`);

  const receiptPromises = uniqueHashes.map(async (hash) => {
    const result = await deps.httpClient.post(
      `/${deps.apiKey}`,
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [hash],
      },
      { schema: AlchemyTransactionReceiptResponseSchema }
    );

    if (result.isErr()) {
      return { hash, error: result.error, receipt: undefined };
    }

    if (result.value.error) {
      const error = result.value.error;
      return {
        hash,
        error: new Error(`JSON-RPC error: ${error.message}`),
        receipt: undefined,
      };
    }

    const receipt = result.value.result;
    if (!receipt) {
      return { hash, error: new Error(`No receipt found`), receipt: undefined };
    }

    return { hash, receipt, error: undefined };
  });

  const results = await Promise.all(receiptPromises);

  const receiptMap = new Map<string, AlchemyTransactionReceipt>();
  const failures: string[] = [];

  for (const result of results) {
    if (result.error) {
      failures.push(`${result.hash}: ${getErrorMessage(result.error)}`);
    } else if (result.receipt) {
      receiptMap.set(result.hash, result.receipt);
    }
  }

  if (failures.length > 0) {
    const message = `Missing ${failures.length}/${uniqueHashes.length} receipts. Errors: ${failures.join('; ')}`;
    deps.logger.warn(message);
    return err(new Error(message));
  }

  deps.logger.debug(`Successfully fetched all ${receiptMap.size} receipts`);

  for (const transfer of transfers) {
    const receipt = receiptMap.get(transfer.hash);
    if (receipt) {
      transfer._gasUsed = receipt.gasUsed;
      transfer._effectiveGasPrice = receipt.effectiveGasPrice ?? undefined;
      transfer._nativeCurrency = deps.nativeCurrency;
    } else {
      return err(new Error(`Receipt missing for transaction ${transfer.hash}`));
    }
  }

  return ok(undefined);
}

/**
 * Deduplicates asset transfers by hash, uniqueId, and category.
 * Important for dual pagination (FROM/TO) where the same transfer may appear in both result sets.
 *
 * When uniqueId is present, it uniquely identifies the transfer (contains log index).
 * When uniqueId is missing (can happen for external/internal transfers), we include additional
 * discriminators (from/to/value/contract/tokenId) to prevent collapsing distinct transfers
 * from the same transaction into one record (which would be silent data loss).
 */
export function deduplicateRawTransfers(transfers: AlchemyAssetTransfer[], logger: Logger): AlchemyAssetTransfer[] {
  const seen = new Set<string>();
  const deduplicated: AlchemyAssetTransfer[] = [];

  for (const transfer of transfers) {
    let key: string;

    if (transfer.uniqueId) {
      key = `${transfer.hash}:${transfer.uniqueId}:${transfer.category}`;
    } else {
      const contractAddr = transfer.rawContract?.address ?? '';
      const contractValue = transfer.rawContract?.value ?? '';
      const tokenId = transfer.tokenId ?? '';
      key = `${transfer.hash}:${transfer.category}:${transfer.from ?? ''}:${transfer.to ?? ''}:${contractValue}:${contractAddr}:${tokenId}`;

      logger.debug(
        `Using extended dedup key for transfer without uniqueId - Hash: ${transfer.hash}, Category: ${transfer.category}`
      );
    }

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(transfer);
    }
  }

  const duplicateCount = transfers.length - deduplicated.length;
  if (duplicateCount > 0) {
    logger.debug(`Deduplicated ${duplicateCount} raw transfers from dual pagination`);
  }

  return deduplicated;
}
