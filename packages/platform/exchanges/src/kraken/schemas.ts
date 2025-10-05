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
  __type: z.literal('trade'),
  id: z.string().optional(), // ccxt trade id
  ordertxid: z.string(),
  postxid: z.string().optional(),
  pair: z.string(),
  aclass: z.string().optional(),
  time: z.coerce.number(),
  type: z.enum(['buy', 'sell']),
  ordertype: z.string(),
  price: z.string(),
  cost: z.string(),
  fee: z.string(),
  vol: z.string(),
  margin: z.string().optional(),
  leverage: z.string().optional(),
  misc: z.string().optional(),
  trade_id: z.string().optional(),
  maker: z.boolean().optional(),
  ledgers: z.array(z.string()).optional(),
});

export type KrakenTradeInfo = z.infer<typeof KrakenTradeInfoSchema>;

/**
 * Kraken deposit info schema
 */
export const KrakenDepositInfoSchema = z.object({
  __type: z.literal('deposit'),
  type: z.string().optional(), // duplicate of __type from API
  method: z.string(),
  aclass: z.string(),
  asset: z.string(),
  refid: z.string(),
  txid: z.string().optional(),
  info: z.string().nullable(),
  amount: z.string(),
  fee: z.string().optional(),
  time: z.coerce.number(),
  status: z.string(),
});

export type KrakenDepositInfo = z.infer<typeof KrakenDepositInfoSchema>;

/**
 * Kraken withdrawal info schema
 */
export const KrakenWithdrawalInfoSchema = z.object({
  __type: z.literal('withdrawal'),
  type: z.string().optional(), // duplicate of __type from API
  method: z.string(),
  aclass: z.string(),
  asset: z.string(),
  refid: z.string(),
  txid: z.string().optional(),
  info: z.string().nullable(),
  amount: z.string(),
  fee: z.string().optional(),
  time: z.coerce.number(),
  status: z.string(),
  key: z.string().optional(), // wallet name
  network: z.string().optional(), // network name
});

export type KrakenWithdrawalInfo = z.infer<typeof KrakenWithdrawalInfoSchema>;

/**
 * Kraken order info schema
 */
export const KrakenOrderInfoSchema = z.object({
  __type: z.literal('order'),
  id: z.string(), // Order ID
  refid: z.string().nullable().optional(),
  userref: z.coerce.number().nullable().optional(),
  status: z.string(),
  opentm: z.coerce.number(),
  starttm: z.coerce.number().optional(),
  expiretm: z.coerce.number().optional(),
  closetm: z.coerce.number().optional(),
  descr: z.object({
    pair: z.string(),
    aclass: z.string().optional(),
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
  reason: z.string().nullable().optional(),
  trades: z.array(z.string()).optional(),
});

export type KrakenOrderInfo = z.infer<typeof KrakenOrderInfoSchema>;

/**
 * Discriminated union of all Kraken transaction types
 */
export const KrakenTransactionSchema = z.discriminatedUnion('__type', [
  KrakenTradeInfoSchema,
  KrakenDepositInfoSchema,
  KrakenWithdrawalInfoSchema,
  KrakenOrderInfoSchema,
]);

export type ParsedKrakenData = z.infer<typeof KrakenTransactionSchema>;
