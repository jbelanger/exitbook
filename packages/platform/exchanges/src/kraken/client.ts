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

      // Fetch and validate trades
      const tradeSince = cursor.trade || params?.since;
      const trades = await this.exchange.fetchMyTrades(undefined, tradeSince, params?.limit);
      const tradesResult = this.processItems(trades, 'trade', transactions, cursor);
      if (tradesResult.isErr()) return err(tradesResult.error);

      // Fetch and validate deposits
      const depositSince = cursor.deposit || params?.since;
      const deposits = await this.exchange.fetchDeposits(undefined, depositSince, params?.limit);
      const depositsResult = this.processItems(deposits, 'deposit', transactions, cursor);
      if (depositsResult.isErr()) return err(depositsResult.error);

      // Fetch and validate withdrawals
      const withdrawalSince = cursor.withdrawal || params?.since;
      const withdrawals = await this.exchange.fetchWithdrawals(undefined, withdrawalSince, params?.limit);
      const withdrawalsResult = this.processItems(withdrawals, 'withdrawal', transactions, cursor);
      if (withdrawalsResult.isErr()) return err(withdrawalsResult.error);

      // Fetch and validate orders
      const orderSince = cursor.order || params?.since;
      const orders = await this.exchange.fetchClosedOrders(undefined, orderSince, params?.limit);
      const ordersResult = this.processItems(orders, 'order', transactions, cursor);
      if (ordersResult.isErr()) return err(ordersResult.error);

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

  private processItems(
    items: ccxt.Trade[] | ccxt.Transaction[] | ccxt.Order[],
    type: 'trade' | 'deposit' | 'withdrawal' | 'order',
    transactions: RawTransactionWithMetadata[],
    currentCursor: Record<string, number>
  ): Result<void, PartialImportError> {
    const lastSuccessfulCursor = { ...currentCursor };

    for (const item of items) {
      const rawItem = { __type: type, ...(item.info as Record<string, unknown>) };

      const validationResult = this.validate(rawItem);

      if (validationResult.isErr()) {
        return err(
          new PartialImportError(
            `Validation failed for ${type}: ${validationResult.error.message}`,
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
            `Failed to extract timestamp for ${type}: ${timestampResult.error.message}`,
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
            `Failed to extract external ID for ${type}: ${externalIdResult.error.message}`,
            transactions,
            parsedData,
            lastSuccessfulCursor
          )
        );
      }
      const externalId = externalIdResult.value;

      // Create cursor for this item (operation type + timestamp)
      const itemCursor = { [type]: timestampMs };

      transactions.push({
        cursor: itemCursor,
        externalId,
        metadata: {
          providerId: this.exchangeId,
          source: 'api',
        },
        rawData: parsedData,
      });

      // Update cursor - track latest timestamp for this operation type
      lastSuccessfulCursor[type] = timestampMs;
    }

    return ok();
  }

  private extractTimestamp(parsedData: ParsedKrakenData): Result<Date, Error> {
    switch (parsedData.__type) {
      case 'trade':
      case 'deposit':
      case 'withdrawal':
        return ok(new Date(parsedData.time * 1000));
      case 'order':
        return ok(new Date(parsedData.opentm * 1000));
      default:
        return err(new Error('Unknown transaction type'));
    }
  }

  private extractExternalId(parsedData: ParsedKrakenData): Result<string, Error> {
    switch (parsedData.__type) {
      case 'trade':
        return ok(parsedData.ordertxid);
      case 'deposit':
      case 'withdrawal':
        return ok(parsedData.refid);
      case 'order':
        return ok(parsedData.id);
      default:
        return err(new Error('Unknown transaction type'));
    }
  }
}
