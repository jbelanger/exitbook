import { decodeAddress, encodeAddress, isAddress } from '@polkadot/util-crypto';

// Address validation for SS58 format
export function isValidSS58Address(address: string, ss58Format?: number): boolean {
  return isAddress(address, false, ss58Format);
}

// Convert between different SS58 formats if needed
export function encodeSS58Address(publicKey: Uint8Array, ss58Format: number): string {
  return encodeAddress(publicKey, ss58Format);
}

/**
 * Derive common SS58 address variants for the same public key
 * Similar to Bitcoin's address derivation but for Substrate/Polkadot ecosystems
 */
export function derivePolkadotAddressVariants(primaryAddress: string): string[] {
  try {
    // Decode the primary address to get the public key
    const publicKey = decodeAddress(primaryAddress);

    // Common SS58 network formats used across the Polkadot ecosystem
    const commonFormats = [
      0, // Polkadot mainnet
      2, // Kusama
      42, // Generic Substrate
      67, // Acala
      126, // Edgeware
      252, // Social Network
      // Add more formats as needed for supported networks
    ];

    // Generate address variants for each format
    const variants = commonFormats.map((format) => encodeAddress(publicKey, format));

    // Remove duplicates and ensure primary address is included
    const uniqueVariants = Array.from(new Set([primaryAddress, ...variants]));

    return uniqueVariants;
  } catch (_error) {
    // If decoding fails, return just the primary address
    // This handles invalid addresses gracefully
    return [primaryAddress];
  }
}

/**
 * Check if two SS58 addresses represent the same public key
 * Accounts for different network format encodings
 */
export function isSamePolkadotAddress(address1: string, address2: string): boolean {
  try {
    // Decode both addresses to get their public keys
    const publicKey1 = decodeAddress(address1);
    const publicKey2 = decodeAddress(address2);

    // Compare the underlying public keys byte by byte
    if (publicKey1.length !== publicKey2.length) {
      return false;
    }

    for (let i = 0; i < publicKey1.length; i++) {
      if (publicKey1[i] !== publicKey2[i]) {
        return false;
      }
    }

    return true;
  } catch (_error) {
    // If either address is invalid, fall back to string comparison
    return address1 === address2;
  }
}

// Parse Substrate method to transaction type
export function parseSubstrateTransactionType(
  module: string,
  method: string,
):
  | 'transfer'
  | 'transfer_keep_alive'
  | 'force_transfer'
  | 'staking_bond'
  | 'staking_unbond'
  | 'staking_withdraw_unbonded'
  | 'staking_nominate'
  | 'staking_chill'
  | 'utility_batch'
  | 'custom' {
  const key = `${module}_${method}`.toLowerCase();

  switch (key) {
    case 'balances_transfer':
    case 'balances_transfer_all':
      return 'transfer';
    case 'balances_transfer_keep_alive':
      return 'transfer_keep_alive';
    case 'balances_force_transfer':
      return 'force_transfer';
    case 'staking_bond':
      return 'staking_bond';
    case 'staking_unbond':
      return 'staking_unbond';
    case 'staking_withdraw_unbonded':
      return 'staking_withdraw_unbonded';
    case 'staking_nominate':
      return 'staking_nominate';
    case 'staking_chill':
      return 'staking_chill';
    case 'utility_batch':
      return 'utility_batch';
    default:
      return 'custom';
  }
}
