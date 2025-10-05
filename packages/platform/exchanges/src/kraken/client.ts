import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { PartialImportError } from '../core/errors.ts';
import type { FetchParams, IExchangeClient, RawTransactionWithMetadata } from '../core/types.ts';
import type { ExchangeCredentials } from '../types/credentials.ts';

import { KrakenCredentialsSchema, KrakenTransactionSchema, type ParsedKrakenData } from './schemas.ts';

export class KrakenClient implements IExchangeClient<ParsedKrakenData> {
  readonly exchangeId = 'kraken';
  private exchange: ccxt.kraken;

  constructor(credentials: ExchangeCredentials) {
    // Validate credentials
    const validationResult = KrakenCredentialsSchema.safeParse(credentials);
    if (!validationResult.success) {
      throw new Error(`Invalid Kraken credentials: ${validationResult.error.message}`);
    }

    const { apiKey, secret } = validationResult.data;

    this.exchange = new ccxt.kraken({
      apiKey,
      secret,
    });
  }

  async fetchTransactionData(params?: FetchParams): Promise<Result<RawTransactionWithMetadata[], Error>> {
    try {
      const transactions: RawTransactionWithMetadata[] = [];
      const cursor = params?.cursor || {};

      // Fetch ledger entries - this includes ALL balance changes:
      // deposits, withdrawals, trades, conversions, fees, etc.
      // Kraken supports fetching all entries - use high limit or undefined to get everything
      const since = cursor.ledger || params?.since;

      // Fetch all ledger entries in a loop until no more results
      // Kraken uses 'ofs' parameter for offset - start with 0
      let allEntries: ccxt.LedgerEntry[] = [];
      let ofs = 0;
      const limit = 50; // Kraken's default/max per request

      while (true) {
        const ledgerEntries = await this.exchange.fetchLedger(undefined, since, limit, { ofs });

        if (ledgerEntries.length === 0) break;

        allEntries = allEntries.concat(ledgerEntries);

        // If we got less than the limit, we've reached the end
        if (ledgerEntries.length < limit) break;

        // Kraken expects ofs to be incremented by the number of entries received
        ofs += ledgerEntries.length;
      }

      const ledgerResult = this.processLedgerItems(allEntries, transactions, cursor);
      if (ledgerResult.isErr()) return err(ledgerResult.error);

      return ok(transactions);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  validate(rawData: unknown): Result<ParsedKrakenData, Error> {
    try {
      const parsed = KrakenTransactionSchema.parse(rawData);
      return ok(parsed);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(`Kraken validation failed: ${String(error)}`));
    }
  }

  private processLedgerItems(
    items: ccxt.LedgerEntry[],
    transactions: RawTransactionWithMetadata[],
    currentCursor: Record<string, number>
  ): Result<void, PartialImportError> {
    const lastSuccessfulCursor = { ...currentCursor };

    for (const item of items) {
      // Ledger entries come with type already in item.info
      const rawItem = { ...(item.info as Record<string, unknown>) };

      const validationResult = this.validate(rawItem);

      if (validationResult.isErr()) {
        return err(
          new PartialImportError(
            `Validation failed for ledger entry: ${validationResult.error.message}`,
            transactions,
            rawItem,
            lastSuccessfulCursor
          )
        );
      }

      const parsedData = validationResult.value;

      // Extract timestamp - required for resumption
      const timestampResult = this.extractTimestamp(parsedData);
      if (timestampResult.isErr()) {
        return err(
          new PartialImportError(
            `Failed to extract timestamp for ledger entry: ${timestampResult.error.message}`,
            transactions,
            parsedData,
            lastSuccessfulCursor
          )
        );
      }
      const timestamp = timestampResult.value;
      const timestampMs = timestamp.getTime();

      // Extract external ID - required for deduplication
      const externalIdResult = this.extractExternalId(parsedData);
      if (externalIdResult.isErr()) {
        return err(
          new PartialImportError(
            `Failed to extract external ID for ledger entry: ${externalIdResult.error.message}`,
            transactions,
            parsedData,
            lastSuccessfulCursor
          )
        );
      }
      const externalId = externalIdResult.value;

      // Create cursor for this item
      const itemCursor = { ledger: timestampMs };

      transactions.push({
        cursor: itemCursor,
        externalId,
        metadata: {
          providerId: this.exchangeId,
          source: 'api',
        },
        rawData: parsedData,
      });

      // Update cursor - track latest timestamp
      lastSuccessfulCursor.ledger = timestampMs;
    }

    return ok();
  }

  private extractTimestamp(parsedData: ParsedKrakenData): Result<Date, Error> {
    return ok(new Date(parsedData.time * 1000));
  }

  private extractExternalId(parsedData: ParsedKrakenData): Result<string, Error> {
    return ok(parsedData.id);
  }
}
