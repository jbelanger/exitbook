import { z } from 'zod';

import { EvmAddressSchema } from '../../schemas.js';

/**
 * Constant representing the beacon chain as a synthetic "from" address.
 * Used for consensus layer withdrawals since they don't originate from a specific address.
 */
export const BEACON_CHAIN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Schema for Etherscan beacon chain withdrawal structure.
 *
 * Etherscan API returns withdrawals with amounts in Gwei.
 * These need to be converted to Wei (multiply by 10^9) during mapping.
 */
export const EtherscanBeaconWithdrawalSchema = z.object({
  withdrawalIndex: z.string().regex(/^\d+$/, 'Withdrawal index must be numeric string'),
  validatorIndex: z.string().regex(/^\d+$/, 'Validator index must be numeric string'),
  address: EvmAddressSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be numeric string (in Gwei)'),
  blockNumber: z.string().regex(/^\d+$/, 'Block number must be numeric string'),
  timestamp: z.string().regex(/^\d+$/, 'Timestamp must be numeric string'),
});

/**
 * Schema for Etherscan API response wrapper.
 *
 * Status codes:
 * - '1': Success
 * - '0': Error
 */
export const EtherscanBeaconWithdrawalResponseSchema = z.object({
  status: z.enum(['0', '1']),
  message: z.string(),
  result: z.union([z.array(EtherscanBeaconWithdrawalSchema), z.string()]),
});

// Type exports
export type EtherscanBeaconWithdrawal = z.infer<typeof EtherscanBeaconWithdrawalSchema>;
export type EtherscanBeaconWithdrawalResponse = z.infer<typeof EtherscanBeaconWithdrawalResponseSchema>;
