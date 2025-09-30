import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for normalized Injective transaction
 */
export const InjectiveTransactionSchema = z.object({
  amount: numericString,
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  bridgeType: z.enum(['peggy', 'ibc', 'native']).optional(),
  claimId: z.array(z.number()).optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  ethereumReceiver: z.string().optional(),
  ethereumSender: z.string().optional(),
  eventNonce: z.string().optional(),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  from: z.string().min(1, 'From address must not be empty'),
  gasPrice: numericString.optional(),
  gasUsed: z.number().nonnegative().optional(),
  gasWanted: z.number().nonnegative().optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  memo: z.string().optional(),
  messageType: z.string().optional(),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  sourceChannel: z.string().optional(),
  sourcePort: z.string().optional(),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  to: z.string().min(1, 'To address must not be empty'),
  tokenAddress: z.string().optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenSymbol: z.string().optional(),
  tokenType: z.enum(['cw20', 'native', 'ibc']).optional(),
  txType: z.string().optional(),
  type: z.enum(['transfer', 'bridge_deposit', 'bridge_withdrawal', 'ibc_transfer']),
});
