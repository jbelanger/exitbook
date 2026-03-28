export type BlockchainDisplayCategory = 'evm' | 'substrate' | 'cosmos' | 'utxo' | 'solana' | 'other';

/**
 * Per-provider display item
 */
export interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvName?: string | undefined;
  apiKeyConfigured?: boolean | undefined;
  capabilities: string[];
  rateLimit?: string | undefined;
}

/**
 * Per-blockchain display item
 */
export interface BlockchainViewItem {
  name: string;
  displayName: string;
  category: BlockchainDisplayCategory;
  layer?: string | undefined;
  providers: ProviderViewItem[];
  providerCount: number;
  keyStatus: 'all-configured' | 'some-missing' | 'none-needed';
  missingKeyCount: number;
  exampleAddress: string;
}
