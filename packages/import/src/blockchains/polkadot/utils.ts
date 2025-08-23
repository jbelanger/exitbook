// Address validation for SS58 format
export function isValidSS58Address(
  address: string,
  ss58Format?: number,
): boolean {
  // Basic SS58 address validation - starts with specific prefix based on network
  // This is a simplified version - in production you'd want to use @polkadot/util-crypto
  const ss58Regex = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;
  return ss58Regex.test(address);
}

// Convert between different SS58 formats if needed
export function encodeAddress(
  publicKey: Uint8Array,
  ss58Format: number,
): string {
  // This would typically use @polkadot/util-crypto's encodeAddress
  // For now, return placeholder - implement with proper SS58 encoding library
  throw new Error("SS58 encoding not implemented - use @polkadot/util-crypto");
}

// Parse Substrate method to transaction type
export function parseSubstrateTransactionType(
  module: string,
  method: string,
): "transfer" | "transfer_keep_alive" | "force_transfer" | "staking_bond" | "staking_unbond" | "staking_withdraw_unbonded" | "staking_nominate" | "staking_chill" | "utility_batch" | "custom" {
  const key = `${module}_${method}`.toLowerCase();

  switch (key) {
    case "balances_transfer":
    case "balances_transfer_all":
      return "transfer";
    case "balances_transfer_keep_alive":
      return "transfer_keep_alive";
    case "balances_force_transfer":
      return "force_transfer";
    case "staking_bond":
      return "staking_bond";
    case "staking_unbond":
      return "staking_unbond";
    case "staking_withdraw_unbonded":
      return "staking_withdraw_unbonded";
    case "staking_nominate":
      return "staking_nominate";
    case "staking_chill":
      return "staking_chill";
    case "utility_batch":
      return "utility_batch";
    default:
      return "custom";
  }
}
