import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { PartialValidationError } from '../core/errors.ts';
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
      let lastSuccessfulTimestamp: Date | undefined;

      // Fetch and validate trades
      const trades = await this.exchange.fetchMyTrades(undefined, params?.since, params?.limit);
      const tradesResult = this.processItems(trades, 'trade', transactions, lastSuccessfulTimestamp);
      if (tradesResult.isErr()) return err(tradesResult.error);
      lastSuccessfulTimestamp = tradesResult.value;

      // Fetch and validate deposits
      const deposits = await this.exchange.fetchDeposits(undefined, params?.since, params?.limit);
      const depositsResult = this.processItems(deposits, 'deposit', transactions, lastSuccessfulTimestamp);
      if (depositsResult.isErr()) return err(depositsResult.error);
      lastSuccessfulTimestamp = depositsResult.value;

      // Fetch and validate withdrawals
      const withdrawals = await this.exchange.fetchWithdrawals(undefined, params?.since, params?.limit);
      const withdrawalsResult = this.processItems(withdrawals, 'withdrawal', transactions, lastSuccessfulTimestamp);
      if (withdrawalsResult.isErr()) return err(withdrawalsResult.error);
      lastSuccessfulTimestamp = withdrawalsResult.value;

      // Fetch and validate orders
      const orders = await this.exchange.fetchClosedOrders(undefined, params?.since, params?.limit);
      const ordersResult = this.processItems(orders, 'order', transactions, lastSuccessfulTimestamp);
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
    lastTimestamp: Date | undefined
  ): Result<Date | undefined, PartialValidationError> {
    let lastSuccessfulTimestamp = lastTimestamp;

    for (const item of items) {
      const rawItem = { __type: type, ...(item.info as Record<string, unknown>) };

      const validationResult = this.validate(rawItem);

      if (validationResult.isErr()) {
        return err(
          new PartialValidationError(
            `Validation failed for ${type}: ${validationResult.error.message}`,
            transactions,
            rawItem,
            lastSuccessfulTimestamp
          )
        );
      }

      const parsedData = validationResult.value;

      // Extract timestamp - required for resumption
      const timestampResult = this.extractTimestamp(parsedData);
      if (timestampResult.isErr()) {
        return err(
          new PartialValidationError(
            `Failed to extract timestamp for ${type}: ${timestampResult.error.message}`,
            transactions,
            parsedData,
            lastSuccessfulTimestamp
          )
        );
      }
      const timestamp = timestampResult.value;

      // Extract external ID - required for deduplication
      const externalIdResult = this.extractExternalId(parsedData);
      if (externalIdResult.isErr()) {
        return err(
          new PartialValidationError(
            `Failed to extract external ID for ${type}: ${externalIdResult.error.message}`,
            transactions,
            parsedData,
            lastSuccessfulTimestamp
          )
        );
      }
      const externalId = externalIdResult.value;

      transactions.push({
        externalId,
        metadata: {
          providerId: this.exchangeId,
          source: 'api',
        },
        rawData: parsedData,
        timestamp,
      });
      lastSuccessfulTimestamp = timestamp;
    }

    return ok(lastSuccessfulTimestamp);
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
