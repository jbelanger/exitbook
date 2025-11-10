/**
 * Normalize EVM address to lowercase for consistent storage and comparison.
 * EVM addresses are case-insensitive (checksummed addresses are for validation only).
 *
 * @param address - The EVM address (0x...)
 * @returns Lowercase address, or undefined if input is undefined/null
 */
export function normalizeEvmAddress(address: string | null | undefined): string | undefined {
  if (!address) {
    return undefined;
  }
  return address.toLowerCase();
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
