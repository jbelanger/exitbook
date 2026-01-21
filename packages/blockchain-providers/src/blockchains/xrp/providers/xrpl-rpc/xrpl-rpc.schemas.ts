import { z } from 'zod';

import {
  XrpAddressSchema,
  XrpAmountSchema,
  XrpDropsAmountSchema,
  XrpIssuedCurrencyAmountSchema,
} from '../../schemas.js';

/**
 * Account flags in account_info response
 */
const AccountFlagsSchema = z.object({
  allowTrustLineClawback: z.boolean().optional(),
  defaultRipple: z.boolean().optional(),
  depositAuth: z.boolean().optional(),
  disableMasterKey: z.boolean().optional(),
  disallowIncomingCheck: z.boolean().optional(),
  disallowIncomingNFTokenOffer: z.boolean().optional(),
  disallowIncomingPayChan: z.boolean().optional(),
  disallowIncomingTrustline: z.boolean().optional(),
  disallowIncomingXRP: z.boolean().optional(),
  globalFreeze: z.boolean().optional(),
  noFreeze: z.boolean().optional(),
  passwordSpent: z.boolean().optional(),
  requireAuthorization: z.boolean().optional(),
  requireDestinationTag: z.boolean().optional(),
});

/**
 * Account data from account_info response
 */
const AccountDataSchema = z.object({
  Account: XrpAddressSchema,
  Balance: XrpDropsAmountSchema,
  Flags: z.number(),
  LedgerEntryType: z.literal('AccountRoot'),
  OwnerCount: z.number(),
  PreviousTxnID: z.string().optional(),
  PreviousTxnLgrSeq: z.number().optional(),
  Sequence: z.number(),
  index: z.string(),
});

/**
 * account_info result
 */
const AccountInfoResultSchema = z.object({
  account_data: AccountDataSchema,
  account_flags: AccountFlagsSchema.optional(),
  ledger_hash: z.string().optional(),
  ledger_index: z.number(),
  status: z.literal('success'),
  validated: z.boolean(),
});

/**
 * JSON-RPC response wrapper for account_info
 */
export const XrplAccountInfoResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal('2.0').optional(),
  result: AccountInfoResultSchema,
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  warnings: z
    .array(
      z.object({
        id: z.number(),
        message: z.string(),
      })
    )
    .optional(),
});

export type XrplAccountInfoResponse = z.infer<typeof XrplAccountInfoResponseSchema>;

/**
 * Modified node in transaction metadata (balance changes)
 */
const ModifiedNodeSchema = z.object({
  FinalFields: z
    .object({
      Account: XrpAddressSchema.optional(),
      Balance: z.union([XrpDropsAmountSchema, XrpIssuedCurrencyAmountSchema, z.string()]).optional(),
      Flags: z.number().optional(),
      OwnerCount: z.number().optional(),
      Sequence: z.number().optional(),
    })
    .passthrough(),
  LedgerEntryType: z.string(),
  LedgerIndex: z.string(),
  PreviousFields: z
    .object({
      Balance: z.union([XrpDropsAmountSchema, XrpIssuedCurrencyAmountSchema, z.string()]).optional(),
      Sequence: z.number().optional(),
    })
    .passthrough()
    .optional(),
  PreviousTxnID: z.string().optional(),
  PreviousTxnLgrSeq: z.number().optional(),
});

/**
 * Created node in transaction metadata
 */
const CreatedNodeSchema = z.object({
  LedgerEntryType: z.string(),
  LedgerIndex: z.string(),
  NewFields: z.record(z.string(), z.unknown()),
});

/**
 * Deleted node in transaction metadata
 */
const DeletedNodeSchema = z.object({
  FinalFields: z.record(z.string(), z.unknown()).optional(),
  LedgerEntryType: z.string(),
  LedgerIndex: z.string(),
  PreviousFields: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Affected nodes in transaction metadata
 * Using passthrough to allow additional fields we haven't explicitly defined
 * Also allow unknown node types that we haven't modeled yet
 */
const AffectedNodeSchema = z.union([
  z.object({ ModifiedNode: ModifiedNodeSchema }).passthrough(),
  z.object({ CreatedNode: CreatedNodeSchema }).passthrough(),
  z.object({ DeletedNode: DeletedNodeSchema }).passthrough(),
  z.record(z.string(), z.unknown()), // Catch-all for any other node types
]);

/**
 * Transaction metadata (effects of the transaction)
 */
const TransactionMetaSchema = z.object({
  AffectedNodes: z.array(AffectedNodeSchema),
  TransactionIndex: z.number(),
  TransactionResult: z.string(),
  delivered_amount: z.union([XrpDropsAmountSchema, XrpAmountSchema, z.literal('unavailable')]).optional(),
});

/**
 * Signer entry for multisigned transactions
 */
const SignerSchema = z.object({
  Signer: z.object({
    Account: XrpAddressSchema,
    SigningPubKey: z.string(),
    TxnSignature: z.string(),
  }),
});

/**
 * Transaction object from account_tx or tx response
 */
export const XrplTransactionSchema = z.object({
  Account: XrpAddressSchema,
  Amount: XrpAmountSchema.optional(),
  DeliverMax: XrpAmountSchema.optional(),
  Destination: XrpAddressSchema.optional(),
  DestinationTag: z.number().optional(),
  Fee: XrpDropsAmountSchema,
  Flags: z.number().optional(),
  Sequence: z.number(),
  Signers: z.array(SignerSchema).optional(),
  SigningPubKey: z.string().optional(),
  SourceTag: z.number().optional(),
  TransactionType: z.string(),
  TxnSignature: z.string().optional(),
  ctid: z.string().optional(),
  date: z.number().optional(),
  hash: z.string(),
  inLedger: z.number().optional(),
  ledger_index: z.number().optional(),
});

export type XrplTransaction = z.infer<typeof XrplTransactionSchema>;

/**
 * Transaction with metadata from account_tx
 */
const TransactionWithMetaSchema = z.object({
  meta: TransactionMetaSchema,
  tx: XrplTransactionSchema,
  validated: z.boolean(),
});

export type XrplTransactionWithMeta = z.infer<typeof TransactionWithMetaSchema>;

/**
 * Pagination marker for account_tx
 */
const PaginationMarkerSchema = z.object({
  ledger: z.number(),
  seq: z.number(),
});

/**
 * account_tx result
 */
const AccountTxResultSchema = z.object({
  account: XrpAddressSchema,
  ledger_index_max: z.number(),
  ledger_index_min: z.number(),
  limit: z.number().optional(),
  marker: PaginationMarkerSchema.optional(),
  status: z.literal('success'),
  transactions: z.array(TransactionWithMetaSchema),
  validated: z.boolean(),
});

/**
 * JSON-RPC response wrapper for account_tx
 */
export const XrplAccountTxResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal('2.0').optional(),
  result: AccountTxResultSchema,
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  warnings: z
    .array(
      z.object({
        id: z.number(),
        message: z.string(),
      })
    )
    .optional(),
});

export type XrplAccountTxResponse = z.infer<typeof XrplAccountTxResponseSchema>;

/**
 * tx result (single transaction lookup)
 */
const TxResultSchema = XrplTransactionSchema.extend({
  meta: TransactionMetaSchema,
  status: z.literal('success'),
  validated: z.boolean(),
});

/**
 * JSON-RPC response wrapper for tx
 */
export const XrplTxResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal('2.0').optional(),
  result: TxResultSchema,
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  warnings: z
    .array(
      z.object({
        id: z.number(),
        message: z.string(),
      })
    )
    .optional(),
});

export type XrplTxResponse = z.infer<typeof XrplTxResponseSchema>;

/**
 * Trust line (for token balances)
 */
const TrustLineSchema = z.object({
  account: XrpAddressSchema,
  balance: z.string(),
  currency: z.string(),
  limit: z.string(),
  limit_peer: z.string(),
  no_ripple: z.boolean().optional(),
  no_ripple_peer: z.boolean().optional(),
  quality_in: z.number(),
  quality_out: z.number(),
});

export type XrplTrustLine = z.infer<typeof TrustLineSchema>;

/**
 * account_lines result (token balances)
 */
const AccountLinesResultSchema = z.object({
  account: XrpAddressSchema,
  ledger_hash: z.string().optional(),
  ledger_index: z.number(),
  limit: z.number().optional(),
  lines: z.array(TrustLineSchema),
  marker: z.string().optional(),
  status: z.literal('success'),
  validated: z.boolean(),
});

/**
 * JSON-RPC response wrapper for account_lines
 */
export const XrplAccountLinesResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal('2.0').optional(),
  result: AccountLinesResultSchema,
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  warnings: z
    .array(
      z.object({
        id: z.number(),
        message: z.string(),
      })
    )
    .optional(),
});

export type XrplAccountLinesResponse = z.infer<typeof XrplAccountLinesResponseSchema>;
