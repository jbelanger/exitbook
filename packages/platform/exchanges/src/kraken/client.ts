import * as ccxt from 'ccxt';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { FetchParams, IExchangeClient, RawExchangeData } from '../core/types.ts';
import type { ExchangeCredentials } from '../types/credentials.ts';

import {
  KrakenCredentialsSchema,
  KrakenTradeInfoSchema,
  KrakenDepositInfoSchema,
  KrakenWithdrawalInfoSchema,
  KrakenOrderInfoSchema,
} from './schemas.ts';

export class KrakenClient implements IExchangeClient {
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

  async fetchTransactionData(params?: FetchParams): Promise<Result<RawExchangeData[], Error>> {
    try {
      const allRawData: RawExchangeData[] = [];

      // Fetch trades
      const trades = await this.exchange.fetchMyTrades(undefined, params?.since, params?.limit);
      for (const trade of trades) {
        const validation = KrakenTradeInfoSchema.safeParse(trade.info);
        if (!validation.success) {
          return err(new Error(`Invalid trade data: ${validation.error.message}`));
        }
        allRawData.push({ data: validation.data });
      }

      // Fetch deposits
      const deposits = await this.exchange.fetchDeposits(undefined, params?.since, params?.limit);
      for (const deposit of deposits) {
        const validation = KrakenDepositInfoSchema.safeParse(deposit.info);
        if (!validation.success) {
          return err(new Error(`Invalid deposit data: ${validation.error.message}`));
        }
        allRawData.push({ data: validation.data });
      }

      // Fetch withdrawals
      const withdrawals = await this.exchange.fetchWithdrawals(undefined, params?.since, params?.limit);
      for (const withdrawal of withdrawals) {
        const validation = KrakenWithdrawalInfoSchema.safeParse(withdrawal.info);
        if (!validation.success) {
          return err(new Error(`Invalid withdrawal data: ${validation.error.message}`));
        }
        allRawData.push({ data: validation.data });
      }

      // Fetch orders
      const orders = await this.exchange.fetchClosedOrders(undefined, params?.since, params?.limit);
      for (const order of orders) {
        const validation = KrakenOrderInfoSchema.safeParse(order.info);
        if (!validation.success) {
          return err(new Error(`Invalid order data: ${validation.error.message}`));
        }
        allRawData.push({ data: validation.data });
      }

      return ok(allRawData);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
