import fs from 'fs';
import path from 'path';

interface ExplorerConfig {
  name: string;
  enabled: boolean;
  priority: number;
  requiresApiKey?: boolean;
  mainnet: {
    baseUrl: string;
  };
  testnet: {
    baseUrl: string;
  };
  rateLimit: {
    requestsPerSecond: number;
  };
  timeout: number;
  retries: number;
}

export interface BlockchainExplorersConfig {
  [blockchain: string]: {
    explorers: ExplorerConfig[];
  };
}

/**
 * Load blockchain explorer configuration from JSON
 */
export function loadExplorerConfig(): BlockchainExplorersConfig {
  // Get config path from environment variable or use default
  const configPath = process.env.BLOCKCHAIN_EXPLORERS_CONFIG 
    ? path.resolve(process.cwd(), process.env.BLOCKCHAIN_EXPLORERS_CONFIG)
    : path.join(process.cwd(), 'config/blockchain-explorers.json');
  
  try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    throw new Error(`Failed to load blockchain explorer configuration from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get enabled explorers for a blockchain and network
 */
export function getEnabledExplorers(blockchain: string): ExplorerConfig[] {
  const config = loadExplorerConfig();
  const blockchainConfig = config[blockchain];
  
  if (!blockchainConfig) {
    throw new Error(`No explorer configuration found for blockchain: ${blockchain}`);
  }
  
  return blockchainConfig.explorers
    .filter(explorer => explorer.enabled)
    .sort((a, b) => a.priority - b.priority); // Sort by priority (lower number = higher priority)
}

/**
 * Get explorer configuration for a specific explorer
 */
export function getExplorerConfig(blockchain: string, explorerName: string): ExplorerConfig | null {
  const config = loadExplorerConfig();
  const blockchainConfig = config[blockchain];
  
  if (!blockchainConfig) {
    return null;
  }
  
  return blockchainConfig.explorers.find(explorer => explorer.name === explorerName) || null;
}