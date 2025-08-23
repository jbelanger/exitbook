// Address validation for SS58 format
export function isValidSS58Address(address: string, ss58Format?: number): boolean {
  // Basic SS58 address validation - starts with specific prefix based on network
  // This is a simplified version - in production you'd want to use @polkadot/util-crypto
  const ss58Regex = /^[1-9A-HJ-NP-Za-km-z]{47,48}$/;
  return ss58Regex.test(address);
}

// Convert between different SS58 formats if needed
export function encodeAddress(publicKey: Uint8Array, ss58Format: number): string {
  // This would typically use @polkadot/util-crypto's encodeAddress
  // For now, return placeholder - implement with proper SS58 encoding library
  throw new Error('SS58 encoding not implemented - use @polkadot/util-crypto');
}

export type SubstrateTransactionType = 
  | 'transfer'
  | 'transfer_keep_alive' 
  | 'force_transfer'
  | 'staking_bond'
  | 'staking_unbond'
  | 'staking_withdraw_unbonded'
  | 'staking_nominate'
  | 'staking_chill'
  | 'democracy_vote'
  | 'council_vote'
  | 'treasury_propose'
  | 'utility_batch'
  | 'proxy_proxy'
  | 'identity_set_identity'
  | 'multisig_approve_as_multi'
  | 'vesting_vest'
  | 'session_set_keys'
  | 'custom';

// Parse Substrate method to transaction type
export function parseSubstrateTransactionType(module: string, method: string): SubstrateTransactionType {
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
    case 'democracy_vote':
      return 'democracy_vote';
    case 'council_vote':
      return 'council_vote';
    case 'treasury_propose':
      return 'treasury_propose';
    case 'utility_batch':
      return 'utility_batch';
    case 'proxy_proxy':
      return 'proxy_proxy';
    case 'identity_set_identity':
      return 'identity_set_identity';
    case 'multisig_approve_as_multi':
      return 'multisig_approve_as_multi';
    case 'vesting_vest':
      return 'vesting_vest';
    case 'session_set_keys':
      return 'session_set_keys';
    default:
      return 'custom';
  }
}