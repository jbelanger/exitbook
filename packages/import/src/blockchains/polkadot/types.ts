// Substrate provider-specific API response types

export interface SubstrateTransaction {
  hash: string;
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  from: string;
  to?: string;
  amount: string;
  fee: string;
  success: boolean;
  module: string;
  call: string;
  args?: any;
  events?: SubstrateEvent[];
}

export interface SubstrateEvent {
  method: string;
  section: string;
  data: any[];
}

export interface SubstrateExtrinsic {
  hash: string;
  method: string;
  section: string;
  args: any;
  signer: string;
  nonce: number;
  signature: string;
  tip: string;
  success: boolean;
  error?: {
    module: string;
    name: string;
    docs: string[];
  };
}

export interface SubstrateBalance {
  free: string;
  reserved: string;
  frozen: string;
  total: string;
}

export interface SubstrateAccountInfo {
  nonce: number;
  consumers: number;
  providers: number;
  sufficients: number;
  data: SubstrateBalance;
}

export interface SubstrateBlock {
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  extrinsics: SubstrateExtrinsic[];
  events: SubstrateEvent[];
}

// Substrate RPC methods
export interface SubstrateRPCMethods {
  // System methods
  'system_account': (address: string) => Promise<SubstrateAccountInfo>;
  'system_properties': () => Promise<{
    ss58Format: number;
    tokenDecimals: number[];
    tokenSymbol: string[];
  }>;
  
  // Chain methods
  'chain_getBlock': (blockHash?: string) => Promise<any>;
  'chain_getBlockHash': (blockNumber?: number) => Promise<string>;
  'chain_getFinalizedHead': () => Promise<string>;
  
  // State methods
  'state_getStorage': (key: string, blockHash?: string) => Promise<string>;
  'state_call': (method: string, data: string, blockHash?: string) => Promise<string>;
}

// Substrate transaction types
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
    case 'utility_batch':
      return 'utility_batch';
    default:
      return 'custom';
  }
}