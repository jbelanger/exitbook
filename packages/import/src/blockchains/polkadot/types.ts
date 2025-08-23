// Substrate provider-specific API response types
// Chain-specific configurations
export interface SubstrateChainConfig {
  name: string;
  displayName: string;
  chainId?: string;
  ss58Format: number;
  tokenSymbol: string;
  tokenDecimals: number;
  rpcEndpoints: string[];
  explorerUrls: string[];
  explorerApiUrl?: string;
  apiKey?: string;
  genesisHash?: string;
}

// Supported Substrate chains
export const SUBSTRATE_CHAINS: { [key: string]: SubstrateChainConfig } = {
  polkadot: {
    name: "polkadot",
    displayName: "Polkadot Relay Chain",
    ss58Format: 0,
    tokenSymbol: "DOT",
    tokenDecimals: 10,
    rpcEndpoints: [
      "wss://rpc.polkadot.io",
      "wss://polkadot.api.onfinality.io/public-ws",
      "wss://polkadot-rpc.dwellir.com",
    ],
    explorerUrls: [
      "https://polkadot.subscan.io",
      "https://polkadot.js.org/apps",
    ],
    explorerApiUrl: "https://polkadot.api.subscan.io",
    genesisHash:
      "0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3",
  },
  kusama: {
    name: "kusama",
    displayName: "Kusama Relay Chain",
    ss58Format: 2,
    tokenSymbol: "KSM",
    tokenDecimals: 12,
    rpcEndpoints: [
      "wss://kusama-rpc.polkadot.io",
      "wss://kusama.api.onfinality.io/public-ws",
      "wss://kusama-rpc.dwellir.com",
    ],
    explorerUrls: [
      "https://kusama.subscan.io",
      "https://polkadot.js.org/apps/?rpc=wss://kusama-rpc.polkadot.io#/explorer",
    ],
    explorerApiUrl: "https://kusama.api.subscan.io",
    genesisHash:
      "0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe",
  },
  bittensor: {
    name: "bittensor",
    displayName: "Bittensor Network",
    ss58Format: 42,
    tokenSymbol: "TAO",
    tokenDecimals: 9,
    rpcEndpoints: [
      "wss://entrypoint-finney.opentensor.ai:443",
      "wss://bittensor-finney.api.onfinality.io/public-ws",
    ],
    explorerUrls: ["https://taostats.io", "https://bittensor.com/scan"],
    explorerApiUrl: "https://taostats.io/api",
    genesisHash:
      "0x5c0d1176a568c1f92944340dbfed9e9c530ebca703c85910e7164cb7d1c9e47b",
  },
};

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
  args?: unknown;
  events?: SubstrateEvent[];
}

export interface SubstrateEvent {
  method: string;
  section: string;
  data: unknown[];
}

export interface SubstrateExtrinsic {
  hash: string;
  method: string;
  section: string;
  args: unknown;
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
  system_account: (address: string) => Promise<SubstrateAccountInfo>;
  system_properties: () => Promise<{
    ss58Format: number;
    tokenDecimals: number[];
    tokenSymbol: string[];
  }>;

  // Chain methods
  chain_getBlock: (blockHash?: string) => Promise<SubstrateBlock>;
  chain_getBlockHash: (blockNumber?: number) => Promise<string>;
  chain_getFinalizedHead: () => Promise<string>;

  // State methods
  state_getStorage: (key: string, blockHash?: string) => Promise<string>;
  state_call: (
    method: string,
    data: string,
    blockHash?: string,
  ) => Promise<string>;
}

// Substrate transaction types
export type SubstrateTransactionType =
  | "transfer"
  | "transfer_keep_alive"
  | "force_transfer"
  | "staking_bond"
  | "staking_unbond"
  | "staking_withdraw_unbonded"
  | "staking_nominate"
  | "staking_chill"
  | "democracy_vote"
  | "council_vote"
  | "treasury_propose"
  | "utility_batch"
  | "proxy_proxy"
  | "identity_set_identity"
  | "multisig_approve_as_multi"
  | "vesting_vest"
  | "session_set_keys"
  | "custom";

// Parse Substrate method to transaction type
export function parseSubstrateTransactionType(
  module: string,
  method: string,
): SubstrateTransactionType {
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

// Taostats transaction interface for Bittensor
export interface TaostatsTransaction {
  from: string;
  to: string;
  hash: string;
  block: number;
  timestamp: number;
  amount: string;
  fee?: string;
}
