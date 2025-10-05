import { z } from 'zod';

/**
 * Kraken API credentials schema
 */
export const KrakenCredentialsSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  secret: z.string().min(1, 'Secret is required'),
});

export type KrakenCredentials = z.infer<typeof KrakenCredentialsSchema>;

/**
 * Kraken trade info schema (raw API response from ccxt 'info' property)
 */
export const KrakenTradeInfoSchema = z.object({
  ordertxid: z.string(),
  postxid: z.string().optional(),
  pair: z.string(),
  time: z.number(),
  type: z.enum(['buy', 'sell']),
  ordertype: z.string(),
  price: z.string(),
  cost: z.string(),
  fee: z.string(),
  vol: z.string(),
  margin: z.string().optional(),
  misc: z.string().optional(),
  ledgers: z.array(z.string()).optional(),
});

export type KrakenTradeInfo = z.infer<typeof KrakenTradeInfoSchema>;

/**
 * Kraken deposit info schema
 */
export const KrakenDepositInfoSchema = z.object({
  method: z.string(),
  aclass: z.string(),
  asset: z.string(),
  refid: z.string(),
  txid: z.string(),
  info: z.string(),
  amount: z.string(),
  fee: z.string().optional(),
  time: z.number(),
  status: z.string(),
});

export type KrakenDepositInfo = z.infer<typeof KrakenDepositInfoSchema>;

/**
 * Kraken withdrawal info schema
 */
export const KrakenWithdrawalInfoSchema = z.object({
  method: z.string(),
  aclass: z.string(),
  asset: z.string(),
  refid: z.string(),
  txid: z.string(),
  info: z.string(),
  amount: z.string(),
  fee: z.string().optional(),
  time: z.number(),
  status: z.string(),
});

export type KrakenWithdrawalInfo = z.infer<typeof KrakenWithdrawalInfoSchema>;

/**
 * Kraken order info schema
 */
export const KrakenOrderInfoSchema = z.object({
  refid: z.string().nullable().optional(),
  userref: z.number().nullable().optional(),
  status: z.string(),
  opentm: z.number(),
  starttm: z.number().optional(),
  expiretm: z.number().optional(),
  descr: z.object({
    pair: z.string(),
    type: z.enum(['buy', 'sell']),
    ordertype: z.string(),
    price: z.string(),
    price2: z.string().optional(),
    leverage: z.string().optional(),
    order: z.string(),
    close: z.string().optional(),
  }),
  vol: z.string(),
  vol_exec: z.string(),
  cost: z.string(),
  fee: z.string(),
  price: z.string(),
  stopprice: z.string().optional(),
  limitprice: z.string().optional(),
  misc: z.string().optional(),
  oflags: z.string().optional(),
  trades: z.array(z.string()).optional(),
});

export type KrakenOrderInfo = z.infer<typeof KrakenOrderInfoSchema>;
