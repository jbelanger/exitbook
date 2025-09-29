// Substrate provider-specific API response types
// Chain-specific configurations
export interface SubstrateChainConfig {
  apiKey?: string | undefined;
  chainId?: string | undefined;
  displayName: string;
  explorerApiUrl?: string | undefined;
  explorerUrls: string[];
  genesisHash?: string | undefined;
  name: string;
  rpcEndpoints: string[];
  ss58Format: number;
  tokenDecimals: number;
  tokenSymbol: string;
}

// Supported Substrate chains
export const SUBSTRATE_CHAINS: Record<string, SubstrateChainConfig> = {
  bittensor: {
    displayName: 'Bittensor Network',
    explorerApiUrl: 'https://taostats.io/api',
    explorerUrls: ['https://taostats.io', 'https://bittensor.com/scan'],
    genesisHash: '0x5c0d1176a568c1f92944340dbfed9e9c530ebca703c85910e7164cb7d1c9e47b',
    name: 'bittensor',
    rpcEndpoints: ['wss://entrypoint-finney.opentensor.ai:443', 'wss://bittensor-finney.api.onfinality.io/public-ws'],
    ss58Format: 42,
    tokenDecimals: 9,
    tokenSymbol: 'TAO',
  },
  kusama: {
    displayName: 'Kusama Relay Chain',
    explorerApiUrl: 'https://kusama.api.subscan.io',
    explorerUrls: [
      'https://kusama.subscan.io',
      'https://polkadot.js.org/apps/?rpc=wss://kusama-rpc.polkadot.io#/explorer',
    ],
    genesisHash: '0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe',
    name: 'kusama',
    rpcEndpoints: [
      'wss://kusama-rpc.polkadot.io',
      'wss://kusama.api.onfinality.io/public-ws',
      'wss://kusama-rpc.dwellir.com',
    ],
    ss58Format: 2,
    tokenDecimals: 12,
    tokenSymbol: 'KSM',
  },
  polkadot: {
    displayName: 'Polkadot Relay Chain',
    explorerApiUrl: 'https://polkadot.api.subscan.io',
    explorerUrls: ['https://polkadot.subscan.io', 'https://polkadot.js.org/apps'],
    genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3',
    name: 'polkadot',
    rpcEndpoints: [
      'wss://rpc.polkadot.io',
      'wss://polkadot.api.onfinality.io/public-ws',
      'wss://polkadot-rpc.dwellir.com',
    ],
    ss58Format: 0,
    tokenDecimals: 10,
    tokenSymbol: 'DOT',
  },
};

export interface SubstrateTransaction {
  amount: string;
  args?: unknown;
  blockHash: string;
  blockNumber: number;
  call: string;
  events?: SubstrateEvent[] | undefined;
  fee: string;
  from: string;
  hash: string;
  module: string;
  success: boolean;
  timestamp: number;
  to?: string | undefined;
}

export interface SubstrateEvent {
  data: unknown[];
  method: string;
  section: string;
}

export interface SubstrateExtrinsic {
  args: unknown;
  error?: {
    docs: string[];
    module: string;
    name: string;
  };
  hash: string;
  method: string;
  nonce: number;
  section: string;
  signature: string;
  signer: string;
  success: boolean;
  tip: string;
}

export interface SubstrateBalance {
  free: string;
  frozen: string;
  reserved: string;
  total: string;
}

export interface SubstrateAccountInfo {
  consumers: number;
  data: SubstrateBalance;
  nonce: number;
  providers: number;
  sufficients: number;
}

export interface SubstrateBlock {
  events: SubstrateEvent[];
  extrinsics: SubstrateExtrinsic[];
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
}

// Substrate RPC methods
export interface SubstrateRPCMethods {
  // Chain methods
  chain_getBlock: (blockHash?: string) => Promise<SubstrateBlock> | undefined;
  chain_getBlockHash: (blockNumber?: number) => Promise<string> | undefined;

  chain_getFinalizedHead: () => Promise<string>;
  state_call: (method: string, data: string, blockHash?: string) => Promise<string> | undefined;
  // State methods
  state_getStorage: (key: string, blockHash?: string) => Promise<string> | undefined;

  // System methods
  system_account: (address: string) => Promise<SubstrateAccountInfo>;
  system_properties: () => Promise<{
    ss58Format: number;
    tokenDecimals: number[];
    tokenSymbol: string[];
  }>;
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

// Taostats transaction interface for Bittensor
export interface TaostatsTransaction {
  amount: string;
  block: number;
  block_hash: string;
  block_number: number;
  confirmations: number;
  fee?: string | undefined;
  from: string;
  hash: string;
  success: boolean;
  timestamp: number;
  to: string;
}

// Subscan API response types
export interface SubscanTransfer {
  amount: string;
  block_hash: string;
  block_num: number;
  block_timestamp: number;
  call: string;
  extrinsic_index: string;
  fee: string;
  from: string;
  hash: string;
  module: string;
  success: boolean;
  to: string;
}

export interface SubscanTransfersResponse {
  code: number;
  data?: {
    transfers: SubscanTransfer[];
  };
}

export interface TaostatsBalanceResponse {
  balance: string;
}

export interface SubscanAccountResponse {
  code: number;
  data?: {
    balance?: string | undefined;
    reserved?: string | undefined;
  };
}
