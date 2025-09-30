import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for Substrate event data
 */
export const SubstrateEventDataSchema = z.object({
  data: z.array(z.unknown()),
  method: z.string(),
  section: z.string(),
});

/**
 * Schema for normalized Substrate transaction
 */
export const SubstrateTransactionSchema = z.object({
  amount: numericString,
  args: z.unknown().optional(),
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  call: z.string().optional(),
  chainName: z.string().optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  events: z.array(SubstrateEventDataSchema).optional(),
  extrinsicIndex: z.string().optional(),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  from: z.string().min(1, 'From address must not be empty'),
  genesisHash: z.string().optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  module: z.string().optional(),
  nonce: z.number().nonnegative().optional(),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  signature: z.string().optional(),
  ss58Format: z.number().nonnegative().optional(),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  tip: numericString.optional(),
  to: z.string().min(1, 'To address must not be empty'),
  type: z.enum(['transfer', 'staking', 'democracy', 'council', 'utility', 'proxy', 'multisig', 'custom']),
});
