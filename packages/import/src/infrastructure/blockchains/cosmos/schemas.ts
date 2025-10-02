import { tryParseDecimal } from '@exitbook/core';
import { z } from 'zod';

/**
 * Numeric string validator for amounts/values
 * Uses Decimal.js for precision-safe validation
 */
const numericString = z.string().refine(
  (val) => {
    if (val === '') return false;
    return tryParseDecimal(val);
  },
  {
    message: 'Must be a valid numeric string',
  }
);

/**
 * Schema for unified Cosmos SDK transaction
 *
 * Validates transactions from all Cosmos SDK-based chains (Injective, Osmosis, Cosmos Hub, etc.)
 * Supports the superset of features across all Cosmos SDK chains including:
 * - Message-based transactions (MsgSend, MsgTransfer, MsgExecuteContract)
 * - IBC transfers
 * - Bridge operations (Peggy, Gravity Bridge)
 * - CosmWasm contract interactions
 */
export const CosmosTransactionSchema = z.object({
  // Core transaction data
  id: z.string().min(1, 'Transaction ID must not be empty'),
  timestamp: z.number().positive('Timestamp must be positive'),
  status: z.enum(['success', 'failed', 'pending']),

  // Transaction flow
  from: z.string().min(1, 'From address must not be empty'),
  to: z.string().min(1, 'To address must not be empty'),

  // Value information
  amount: numericString,
  currency: z.string().min(1, 'Currency must not be empty'),

  // Block context
  blockHeight: z.number().optional(),
  blockId: z.string().optional(),

  // Provider identification
  providerId: z.string().min(1, 'Provider ID must not be empty'),

  // Cosmos-specific metadata
  messageType: z.string().optional(),
  memo: z.string().optional(),
  txType: z.string().optional(),

  // Transaction type classification
  type: z.enum(['transfer', 'bridge_deposit', 'bridge_withdrawal', 'ibc_transfer', 'contract_execution']),

  // Gas information
  gasUsed: z.number().nonnegative().optional(),
  gasWanted: z.number().nonnegative().optional(),
  gasPrice: numericString.optional(),

  // Fee information
  feeAmount: numericString.optional(),
  feeCurrency: z.string().optional(),

  // Token-specific information
  tokenAddress: z.string().optional(),
  tokenDecimals: z.number().nonnegative().optional(),
  tokenSymbol: z.string().optional(),
  tokenType: z.enum(['cw20', 'native', 'ibc']).optional(),

  // IBC-specific information
  sourceChannel: z.string().optional(),
  sourcePort: z.string().optional(),
  destinationChannel: z.string().optional(),
  destinationPort: z.string().optional(),
  ibcDenom: z.string().optional(),

  // Bridge information
  bridgeType: z.enum(['peggy', 'gravity', 'ibc', 'native']).optional(),
  bridgeId: z.string().optional(),

  // Injective Peggy bridge-specific
  ethereumSender: z.string().optional(),
  ethereumReceiver: z.string().optional(),
  eventNonce: z.string().optional(),
  claimId: z.array(z.number()).optional(),

  // Gravity Bridge-specific
  gravityNonce: z.string().optional(),
  gravityBatchNonce: z.string().optional(),

  // CosmWasm contract-specific
  contractAddress: z.string().optional(),
  contractAction: z.string().optional(),
  contractResult: z.string().optional(),
});

/**
 * Type inferred from schema
 */
export type CosmosTransactionSchemaType = z.infer<typeof CosmosTransactionSchema>;
