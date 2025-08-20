// Substrate blockchain domain types and interfaces

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
    name: 'polkadot',
    displayName: 'Polkadot Relay Chain',
    ss58Format: 0,
    tokenSymbol: 'DOT',
    tokenDecimals: 10,
    rpcEndpoints: [
      'wss://rpc.polkadot.io',
      'wss://polkadot.api.onfinality.io/public-ws',
      'wss://polkadot-rpc.dwellir.com'
    ],
    explorerUrls: [
      'https://polkadot.subscan.io',
      'https://polkadot.js.org/apps'
    ],
    explorerApiUrl: 'https://polkadot.api.subscan.io',
    genesisHash: '0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3'
  },
  kusama: {
    name: 'kusama',
    displayName: 'Kusama Relay Chain',
    ss58Format: 2,
    tokenSymbol: 'KSM',
    tokenDecimals: 12,
    rpcEndpoints: [
      'wss://kusama-rpc.polkadot.io',
      'wss://kusama.api.onfinality.io/public-ws',
      'wss://kusama-rpc.dwellir.com'
    ],
    explorerUrls: [
      'https://kusama.subscan.io',
      'https://polkadot.js.org/apps/?rpc=wss://kusama-rpc.polkadot.io#/explorer'
    ],
    explorerApiUrl: 'https://kusama.api.subscan.io',
    genesisHash: '0xb0a8d493285c2df73290dfb7e61f870f17b41801197a149ca93654499ea3dafe'
  },
  bittensor: {
    name: 'bittensor',
    displayName: 'Bittensor Network',
    ss58Format: 42,
    tokenSymbol: 'TAO',
    tokenDecimals: 9,
    rpcEndpoints: [
      'wss://entrypoint-finney.opentensor.ai:443',
      'wss://bittensor-finney.api.onfinality.io/public-ws'
    ],
    explorerUrls: [
      'https://taostats.io',
      'https://bittensor.com/scan'
    ],
    explorerApiUrl: 'https://taostats.io/api',
    genesisHash: '0x5c0d1176a568c1f92944340dbfed9e9c530ebca703c85910e7164cb7d1c9e47b'
  }
};


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

