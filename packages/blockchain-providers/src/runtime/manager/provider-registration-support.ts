import type { ProviderMetadata } from '../../contracts/registry.js';

interface ApiKeyValidationResult {
  available: boolean;
  envVar: string;
}

/**
 * Validate that required API key is available in environment.
 */
export function validateProviderApiKey(
  metadata: Pick<ProviderMetadata, 'apiKeyEnvVar' | 'displayName' | 'name' | 'requiresApiKey'>,
  apiKey?: string
): ApiKeyValidationResult {
  const envVar = metadata.apiKeyEnvVar || `${metadata.name.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const resolvedApiKey = apiKey ?? process.env[envVar];
  const available = Boolean(resolvedApiKey && resolvedApiKey !== 'YourApiKeyToken');

  return {
    available,
    envVar,
  };
}

/**
 * Build helpful error message when preferred provider is not found.
 */
export function buildProviderNotFoundError(
  blockchain: string,
  preferredProvider: string,
  availableProviders: string[]
): string {
  const providersList = availableProviders.join(', ');
  const suggestions = [
    `Available providers for ${blockchain}: ${providersList}`,
    `Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
    `Check for typos in provider name: '${preferredProvider}'`,
    `Use 'pnpm run providers:sync --fix' to sync configuration`,
  ];

  return `Preferred provider '${preferredProvider}' not found for ${blockchain}.\n${suggestions.join('\n')}`;
}
