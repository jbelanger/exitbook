/**
 * Per-provider display item
 */
export interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
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
  category: string;
  layer?: string | undefined;
  providers: ProviderViewItem[];
  providerCount: number;
  keyStatus: 'all-configured' | 'some-missing' | 'none-needed';
  missingKeyCount: number;
  exampleAddress: string;
}
