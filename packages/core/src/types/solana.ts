import { Decimal } from 'decimal.js';

/**
 * Solana network configuration
 */
export interface SolanaNetworkConfig {
  name: string;
  displayName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  rpcUrl: string;
  explorerApiUrl?: string;
  cluster: 'mainnet-beta' | 'testnet' | 'devnet';
}

/**
 * Supported Solana networks
 */
export const SOLANA_NETWORKS: Record<string, SolanaNetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Solana Mainnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9, // SOL has 9 decimal places (lamports)
    rpcUrl: 'https://api.mainnet-beta.solana.com', // Fallback - Official Solana RPC (40 req/10sec per RPC)
    explorerApiUrl: 'https://api.solscan.io',
    cluster: 'mainnet-beta'
  },
  testnet: {
    name: 'testnet',
    displayName: 'Solana Testnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9,
    rpcUrl: 'https://api.testnet.solana.com',
    explorerApiUrl: 'https://api-testnet.solscan.io',
    cluster: 'testnet'
  },
  devnet: {
    name: 'devnet',
    displayName: 'Solana Devnet',
    tokenSymbol: 'SOL',
    tokenDecimals: 9,
    rpcUrl: 'https://api.devnet.solana.com',
    explorerApiUrl: 'https://api-devnet.solscan.io',
    cluster: 'devnet'
  }
};


/**
 * Solana address validation
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded and typically 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: number | string): Decimal {
  return new Decimal(lamports).dividedBy(new Decimal(10).pow(9));
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number | string): Decimal {
  return new Decimal(sol).mul(new Decimal(10).pow(9));
}

