import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 */
const numericString = z
  .string()
  .refine((val) => !isNaN(parseFloat(val)) && isFinite(parseFloat(val)), { message: 'Must be a valid numeric string' });

/**
 * Schema for normalized Avalanche transaction
 */
export const AvalancheTransactionSchema = z.object({
  amount: numericString,
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),
  currency: z.string().min(1, 'Currency must not be empty'),
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),
  from: z.string().min(1, 'From address must not be empty'),
  functionName: z.string().optional(),
  gasPrice: numericString.optional(),
  gasUsed: numericString.optional(),
  id: z.string().min(1, 'Transaction ID must not be empty'),
  inputData: z.string().optional(),
  methodId: z.string().optional(),
  providerId: z.string().min(1, 'Provider ID must not be empty'),
  status: z.enum(['success', 'failed', 'pending']),
  timestamp: z.number().positive('Timestamp must be positive'),
  to: z.string().min(1, 'To address must not be empty'),
  tokenAddress: z.string().optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenSymbol: z.string().optional(),
  tokenType: z.enum(['erc20', 'erc721', 'erc1155', 'native']).optional(),
  traceId: z.string().optional(),
  type: z.enum(['transfer', 'token_transfer', 'internal', 'contract_call']),
});
