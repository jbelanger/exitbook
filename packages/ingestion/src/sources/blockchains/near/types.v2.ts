import type { NearReceiptEvent } from '@exitbook/blockchain-providers';
import { NearAccountIdSchema } from '@exitbook/blockchain-providers';
import type { OperationType } from '@exitbook/core';
import { DecimalStringSchema } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Fund flow derived from NEAR receipt events for accounting
 * One receipt event may produce multiple fund flows
 *
 * Important: Balance changes already include fee impact in their net deltas.
 * Fee flows are extracted separately for informational/tracking purposes.
 * The accounting pipeline must not double-subtract fees from balance change flows.
 */
export const NearFundFlowSchema = z.object({
  /** Receipt ID (links to NearReceiptEvent) */
  receiptId: z.string().min(1),

  /** Transaction hash */
  transactionHash: z.string().min(1),

  /** Flow type */
  flowType: z.enum(['native_balance_change', 'token_transfer', 'fee']),

  /** Asset (symbol or contract address) */
  asset: z.string().min(1),

  /** Amount (normalized to asset decimals) */
  amount: DecimalStringSchema,

  /** Decimals */
  decimals: z.number().nonnegative(),

  /** Source account (undefined for receives) */
  from: NearAccountIdSchema.optional().or(z.undefined()),

  /** Destination account (undefined for sends) */
  to: NearAccountIdSchema.optional().or(z.undefined()),

  /** Direction from queried account's perspective */
  direction: z.enum(['in', 'out', 'self']),

  /** Token contract (for token transfers) */
  contractId: NearAccountIdSchema.optional().or(z.undefined()),

  /** Timestamp */
  timestamp: z.number().positive(),
});

export type NearFundFlow = z.infer<typeof NearFundFlowSchema>;

/**
 * Analysis of a NEAR event for accounting
 * Contains the receipt event and derived fund flows
 */
export interface NearEventAnalysis {
  /** The original receipt event */
  event: NearReceiptEvent;

  /** Fund flows extracted from this event */
  flows: NearFundFlow[];

  /** Operation type (for UniversalTransaction) */
  operationType: OperationType;
}

/**
 * Internal type for representing a fund flow with Decimal amounts
 * Used during processing before converting to string format
 */
export interface NearFundFlowInternal {
  receiptId: string;
  transactionHash: string;
  flowType: 'native_balance_change' | 'token_transfer' | 'fee';
  asset: string;
  amount: Decimal;
  decimals: number;
  from?: string | undefined;
  to?: string | undefined;
  direction: 'in' | 'out' | 'self';
  contractId?: string | undefined;
  timestamp: number;
}
