import { parseDecimal } from '@exitbook/core';
import { bech32 } from 'bech32';

/**
 * Validate a Bech32 address format
 *
 * @param address - The Bech32 address to validate
 * @param expectedPrefix - Optional expected prefix (e.g., 'inj', 'osmo', 'cosmos')
 * @returns True if the address is valid, false otherwise
 */
export function validateBech32Address(address: string, expectedPrefix?: string): boolean {
  try {
    const decoded = bech32.decode(address);

    // If expectedPrefix is provided, verify it matches
    if (expectedPrefix && decoded.prefix !== expectedPrefix) {
      return false;
    }

    // Validate that words array is not empty
    if (decoded.words.length === 0) {
      return false;
    }

    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Decode a Bech32 address to its raw bytes
 *
 * @param address - The Bech32 address to decode
 * @returns Object containing prefix and raw bytes, or undefined if invalid
 * @internal
 */
function decodeBech32(address: string): { data: Uint8Array; prefix: string } | undefined {
  try {
    const decoded = bech32.decode(address);
    const data = bech32.fromWords(decoded.words);
    return {
      data: new Uint8Array(data),
      prefix: decoded.prefix,
    };
  } catch (_error) {
    return undefined;
  }
}

/**
 * Encode raw bytes to a Bech32 address with the specified prefix
 *
 * @param data - The raw bytes to encode
 * @param prefix - The Bech32 prefix (e.g., 'inj', 'osmo', 'cosmos')
 * @returns The encoded Bech32 address
 * @internal
 */
function encodeBech32(data: Uint8Array, prefix: string): string {
  const words = bech32.toWords(data);
  return bech32.encode(prefix, words);
}

/**
 * Derive address variants for the same public key with different Bech32 prefixes
 * Similar to Substrate's SS58 address derivation but for Cosmos chains
 *
 * This is useful for tracking the same account across different Cosmos SDK chains.
 * For example, the same account can be represented as:
 * - inj1... on Injective
 * - osmo1... on Osmosis
 * - cosmos1... on Cosmos Hub
 *
 * @param primaryAddress - The primary Bech32 address
 * @param prefixes - Array of Bech32 prefixes to generate variants for
 * @returns Array of address variants with different prefixes
 *
 * @example
 * const variants = deriveBech32AddressVariants('inj1abc...', ['inj', 'osmo', 'cosmos']);
 * // Returns: ['inj1abc...', 'osmo1abc...', 'cosmos1abc...']
 *
 * @public
 */
export function deriveBech32AddressVariants(primaryAddress: string, prefixes: string[]): string[] {
  try {
    // Decode the primary address to get the raw bytes
    const decoded = decodeBech32(primaryAddress);
    if (!decoded) {
      return [primaryAddress];
    }

    // Generate address variants for each prefix
    const variants = prefixes.map((prefix) => encodeBech32(decoded.data, prefix));

    // Remove duplicates and ensure primary address is included
    const uniqueVariants = Array.from(new Set([primaryAddress, ...variants]));

    return uniqueVariants;
  } catch (_error) {
    // If encoding/decoding fails, return just the primary address
    return [primaryAddress];
  }
}

/**
 * Check if two Bech32 addresses represent the same public key
 * Accounts for different prefix encodings
 *
 * @param address1 - First Bech32 address
 * @param address2 - Second Bech32 address
 * @returns True if both addresses represent the same public key
 *
 * @example
 * isSameBech32Address('inj1abc...', 'osmo1abc...') // true if same pubkey
 * isSameBech32Address('inj1abc...', 'inj1xyz...') // false
 *
 * @public
 */
export function isSameBech32Address(address1: string, address2: string): boolean {
  try {
    // Decode both addresses to get their raw bytes
    const decoded1 = decodeBech32(address1);
    const decoded2 = decodeBech32(address2);

    if (!decoded1 || !decoded2) {
      return address1 === address2;
    }

    // Compare the underlying bytes
    if (decoded1.data.length !== decoded2.data.length) {
      return false;
    }

    for (let i = 0; i < decoded1.data.length; i++) {
      if (decoded1.data[i] !== decoded2.data[i]) {
        return false;
      }
    }

    return true;
  } catch (_error) {
    // If either address is invalid, fall back to string comparison
    return address1 === address2;
  }
}

/**
 * Get common Bech32 prefixes for major Cosmos SDK chains
 * Used for address variant derivation
 *
 * @returns Array of common Bech32 prefixes
 *
 * @public
 */
export function getCommonCosmosPrefixes(): string[] {
  return [
    'inj', // Injective
    'osmo', // Osmosis
    'cosmos', // Cosmos Hub
    'terra', // Terra
    'juno', // Juno
    'secret', // Secret Network
    'stars', // Stargaze
    'akash', // Akash
    'kujira', // Kujira
    'evmos', // Evmos
    'cro', // Cronos
    'axelar', // Axelar
    'celestia', // Celestia
    'stride', // Stride
    'neutron', // Neutron
    'archway', // Archway
    'noble', // Noble
  ];
}

/**
 * Convert an address from one Bech32 prefix to another
 * Useful for tracking the same account across different chains
 *
 * @param address - The source Bech32 address
 * @param targetPrefix - The target Bech32 prefix
 * @returns The converted address or undefined if conversion fails
 *
 * @example
 * convertBech32Prefix('inj1abc...', 'osmo') // Returns 'osmo1abc...'
 *
 * @public
 */
export function convertBech32Prefix(address: string, targetPrefix: string): string | undefined {
  try {
    const decoded = decodeBech32(address);
    if (!decoded) {
      return undefined;
    }

    return encodeBech32(decoded.data, targetPrefix);
  } catch (_error) {
    return undefined;
  }
}

/**
 * Parse Cosmos message type to transaction type classification
 *
 * @param messageType - The Cosmos SDK message type (e.g., '/cosmos.bank.v1beta1.MsgSend')
 * @returns Transaction type classification
 *
 * @public
 */
export function parseCosmosMessageType(
  messageType: string
): 'transfer' | 'ibc_transfer' | 'contract_execution' | 'bridge_deposit' | 'bridge_withdrawal' | 'unknown' {
  // Bank transfers
  if (messageType.includes('cosmos.bank') && messageType.includes('MsgSend')) {
    return 'transfer';
  }

  // IBC transfers
  if (messageType.includes('ibc.applications.transfer') && messageType.includes('MsgTransfer')) {
    return 'ibc_transfer';
  }

  // CosmWasm contract execution
  if (messageType.includes('cosmwasm.wasm') && messageType.includes('MsgExecuteContract')) {
    return 'contract_execution';
  }

  // Injective Peggy bridge
  if (messageType.includes('injective.peggy')) {
    if (messageType.includes('MsgSendToEth') || messageType.includes('MsgWithdraw')) {
      return 'bridge_withdrawal';
    }
    if (messageType.includes('MsgDepositClaim') || messageType.includes('MsgValsetConfirm')) {
      return 'bridge_deposit';
    }
  }

  // Gravity Bridge
  if (messageType.includes('gravity.v1')) {
    if (messageType.includes('MsgSendToEth')) {
      return 'bridge_withdrawal';
    }
    if (messageType.includes('MsgDepositClaim')) {
      return 'bridge_deposit';
    }
  }

  return 'unknown';
}

/**
 * Check if a transaction is relevant to the given address
 *
 * A transaction is relevant if:
 * - The address is the recipient (to) and amount > 0
 * - The address is the sender (from) and amount > 0
 *
 * @param from - Sender address
 * @param to - Recipient address
 * @param relevantAddress - Address to check relevance for
 * @param amount - Transaction amount
 * @returns True if transaction is relevant, false otherwise
 *
 * @example
 * ```typescript
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1xyz", "1.5") // true (receiving)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1abc", "1.5") // true (sending)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1def", "1.5") // false (not involved)
 * isTransactionRelevant("inj1abc", "inj1xyz", "inj1xyz", "0")   // false (zero amount)
 * ```
 *
 * @public
 */
export function isTransactionRelevant(from: string, to: string, relevantAddress: string, amount: string): boolean {
  const amountValue = parseDecimal(amount).toNumber();

  if (amountValue <= 0) {
    return false;
  }

  if (to && relevantAddress === to) {
    return true;
  }

  if (from && relevantAddress === from) {
    return true;
  }

  return false;
}

/**
 * Format and normalize denomination strings
 *
 * Converts Injective-specific denominations to standard format:
 * - "inj" → "INJ"
 * - "uinj" → "INJ"
 * - Other denoms → UPPERCASE
 * - undefined → "INJ" (default)
 *
 * @param denom - Denomination string to format
 * @returns Formatted denomination
 *
 * @example
 * ```typescript
 * formatDenom("inj")     // "INJ"
 * formatDenom("uinj")    // "INJ"
 * formatDenom("usdc")    // "USDC"
 * formatDenom(undefined) // "INJ"
 * ```
 *
 * @public
 */
export function formatDenom(denom: string | undefined): string {
  if (!denom) {
    return 'INJ';
  }

  if (denom === 'inj' || denom === 'uinj') {
    return 'INJ';
  }

  return denom.toUpperCase();
}

/**
 * Generate unique Peggy bridge transaction identifier
 *
 * For Peggy bridge deposits, multiple validators submit the same deposit claim
 * as separate blockchain transactions. Use event_nonce to deduplicate these.
 * Falls back to claim_id from transaction level if event_nonce is not available.
 *
 * @param eventNonce - Event nonce from message (preferred for deduplication)
 * @param claimId - Claim ID from transaction level (fallback)
 * @param transactionHash - Original transaction hash (final fallback)
 * @returns Unique identifier for the transaction
 *
 * @example
 * ```typescript
 * generatePeggyEventRootId("12345", [1, 2], "0xabc")  // "peggy-deposit-12345"
 * generatePeggyEventRootId(undefined, [67], "0xabc")  // "peggy-deposit-67"
 * generatePeggyEventRootId(undefined, [], "0xabc")    // "0xabc"
 * ```
 *
 * @public
 */
export function generatePeggyEventRootId(
  eventNonce: string | undefined,
  claimId: number[] | undefined,
  transactionHash: string
): string {
  if (eventNonce) {
    return `peggy-deposit-${eventNonce}`;
  }

  if (claimId && Array.isArray(claimId) && claimId.length > 0) {
    return `peggy-deposit-${String(claimId[0])}`;
  }

  return transactionHash;
}
