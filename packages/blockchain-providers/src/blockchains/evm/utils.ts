import { createHash } from 'node:crypto';

/**
 * Normalize EVM address to lowercase for consistent storage and comparison.
 *
 * EVM addresses are case-insensitive. While EIP-55 defines checksummed addresses
 * (mixed case for validation), all comparisons and storage use lowercase.
 *
 * @param address - The EVM address (0x...)
 * @returns Lowercase address
 */
export function normalizeEvmAddress(address: string): string;
export function normalizeEvmAddress(address: string | null | undefined): string | undefined;
export function normalizeEvmAddress(address: string | null | undefined): string | undefined {
  if (!address) {
    return undefined;
  }
  return address.toLowerCase();
}

/**
 * Minimum fields required for generating unique beacon withdrawal event IDs.
 * All fields are mandatory to ensure uniqueness across all withdrawals.
 */
export interface BeaconWithdrawalFields {
  withdrawalIndex: string; // Unique withdrawal index across all time
  validatorIndex: string; // Validator that generated this withdrawal
  address: string; // Recipient address
  amountWei: string; // Withdrawal amount in Wei (must be already converted from Gwei if needed)
  blockNumber: string; // Block containing this withdrawal
  timestamp: string; // Withdrawal timestamp
  nativeCurrency: string; // Chain native currency (e.g., 'ETH')
}

/**
 * Generates a unique, deterministic event ID for beacon chain withdrawals.
 * Unlike standard transactions, beacon withdrawals require all fields to ensure uniqueness
 * since multiple withdrawals can occur in the same block with similar amounts.
 *
 * Fields included in hash (all mandatory):
 * - withdrawalIndex: Unique index for this withdrawal across all time
 * - validatorIndex: Validator that generated this withdrawal
 * - address: Recipient address (normalized to lowercase)
 * - amountWei: Withdrawal amount in Wei
 * - blockNumber: Block containing this withdrawal
 * - timestamp: Withdrawal timestamp
 * - nativeCurrency: Chain native currency (e.g., 'ETH')
 *
 * @param fields - Complete beacon withdrawal fields
 * @returns SHA-256 hash of all withdrawal fields (lowercase hex)
 */
export function generateBeaconWithdrawalEventId(fields: BeaconWithdrawalFields): string {
  // Normalize address to lowercase for consistency
  const normalizedAddress = fields.address.toLowerCase();

  // Build deterministic string from all withdrawal fields
  // Order matters for deterministic hashing
  const parts = [
    fields.withdrawalIndex,
    fields.validatorIndex,
    normalizedAddress,
    fields.amountWei,
    fields.blockNumber,
    fields.timestamp,
    fields.nativeCurrency,
  ];

  const dataString = parts.join('|');

  // Generate SHA-256 hash
  const hash = createHash('sha256').update(dataString).digest('hex');

  return hash;
}

/**
 * Extracts the method ID from transaction input data.
 * Method ID is the first 4 bytes (10 characters including '0x') of input data.
 *
 * @param inputData - Transaction input data
 * @returns Method ID or undefined if input is too short
 */
export function extractMethodId(inputData: string | null | undefined): string | undefined {
  if (!inputData || inputData.length < 10) {
    return undefined;
  }
  return inputData.slice(0, 10);
}

/**
 * Determines transaction type based on function name presence.
 * Transactions with function names are contract calls, others are transfers.
 *
 * @param functionName - Function name from transaction data
 * @returns Transaction type
 */
export function getTransactionTypeFromFunctionName(
  functionName: string | null | undefined
): 'contract_call' | 'transfer' {
  return functionName ? 'contract_call' : 'transfer';
}
