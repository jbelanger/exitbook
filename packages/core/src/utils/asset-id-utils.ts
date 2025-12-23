import { err, ok, type Result } from 'neverthrow';

/**
 * Asset Identity Utilities
 *
 * Provides helper functions to build assetId strings according to the Asset Identity Specification.
 *
 * Format:
 * - Blockchain native: blockchain:<chain>:native
 * - Blockchain token: blockchain:<chain>:<contractOrMintOrDenom>
 * - Exchange asset: exchange:<exchange>:<currencyCode>
 * - Fiat: fiat:<currencyCode>
 */

/**
 * Build assetId for blockchain native assets (e.g., BTC, ETH, SOL)
 *
 * @param chain - Blockchain name (e.g., 'bitcoin', 'ethereum', 'solana')
 * @returns Asset ID in format: blockchain:<chain>:native
 *
 * @example
 * buildBlockchainNativeAssetId('bitcoin') // Ok('blockchain:bitcoin:native')
 * buildBlockchainNativeAssetId('ethereum') // Ok('blockchain:ethereum:native')
 */
export function buildBlockchainNativeAssetId(chain: string): Result<string, Error> {
  if (!chain || chain.trim() === '') {
    return err(new Error('Chain name must not be empty'));
  }
  return ok(`blockchain:${chain.toLowerCase()}:native`);
}

/**
 * Build assetId for blockchain tokens (ERC-20, SPL, IBC, etc.)
 *
 * Case handling:
 * - Hex addresses (0x-prefixed): normalized to lowercase for EVM compatibility
 * - Other references (Solana mints, IBC denoms): preserved as-is (case-sensitive)
 *
 * @param chain - Blockchain name (e.g., 'ethereum', 'solana', 'cosmos')
 * @param tokenRef - Token reference (contract address, mint address, or denom)
 * @returns Asset ID in format: blockchain:<chain>:<tokenRef>
 *
 * @example
 * buildBlockchainTokenAssetId('ethereum', '0xA0B86991C6218b36c1d19D4a2e9Eb0cE3606eB48')
 * // Ok('blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
 *
 * buildBlockchainTokenAssetId('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
 * // Ok('blockchain:solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
 *
 * buildBlockchainTokenAssetId('cosmos', 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2')
 * // Ok('blockchain:cosmos:ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2')
 */
export function buildBlockchainTokenAssetId(chain: string, tokenRef: string): Result<string, Error> {
  if (!chain || chain.trim() === '') {
    return err(new Error('Chain name must not be empty'));
  }
  if (!tokenRef || tokenRef.trim() === '') {
    return err(new Error('Token reference must not be empty'));
  }

  // Normalize hex addresses (0x-prefixed) to lowercase; preserve case for other references
  const normalizedTokenRef = tokenRef.startsWith('0x') ? tokenRef.toLowerCase() : tokenRef;

  return ok(`blockchain:${chain.toLowerCase()}:${normalizedTokenRef}`);
}

/**
 * Build assetId for exchange assets
 *
 * @param exchange - Exchange name (e.g., 'kraken', 'coinbase', 'kucoin')
 * @param currencyCode - Currency code from exchange (e.g., 'BTC', 'USDC', 'ETH')
 * @returns Asset ID in format: exchange:<exchange>:<currencyCode>
 *
 * @example
 * buildExchangeAssetId('kraken', 'BTC') // Ok('exchange:kraken:btc')
 * buildExchangeAssetId('coinbase', 'USDC') // Ok('exchange:coinbase:usdc')
 */
export function buildExchangeAssetId(exchange: string, currencyCode: string): Result<string, Error> {
  if (!exchange || exchange.trim() === '') {
    return err(new Error('Exchange name must not be empty'));
  }
  if (!currencyCode || currencyCode.trim() === '') {
    return err(new Error('Currency code must not be empty'));
  }
  return ok(`exchange:${exchange.toLowerCase()}:${currencyCode.toLowerCase()}`);
}

/**
 * Build assetId for fiat currencies
 *
 * @param currencyCode - ISO 4217 currency code (e.g., 'USD', 'EUR', 'GBP')
 * @returns Asset ID in format: fiat:<currencyCode>
 *
 * @example
 * buildFiatAssetId('USD') // Ok('fiat:usd')
 * buildFiatAssetId('EUR') // Ok('fiat:eur')
 */
export function buildFiatAssetId(currencyCode: string): Result<string, Error> {
  if (!currencyCode || currencyCode.trim() === '') {
    return err(new Error('Currency code must not be empty'));
  }
  return ok(`fiat:${currencyCode.toLowerCase()}`);
}

/**
 * Parse an assetId to extract its components
 *
 * @param assetId - Asset ID to parse
 * @returns Parsed components
 *
 * @example
 * parseAssetId('blockchain:ethereum:native')
 * // Ok({ namespace: 'blockchain', chain: 'ethereum', ref: 'native' })
 *
 * parseAssetId('exchange:kraken:btc')
 * // Ok({ namespace: 'exchange', exchange: 'kraken', currencyCode: 'btc' })
 */
export function parseAssetId(assetId: string): Result<
  {
    chain?: string | undefined;
    currencyCode?: string | undefined;
    exchange?: string | undefined;
    namespace: 'blockchain' | 'exchange' | 'fiat';
    ref?: string | undefined;
  },
  Error
> {
  const parts = assetId.split(':');

  if (parts.length < 2) {
    return err(new Error(`Invalid assetId format: ${assetId}`));
  }

  const namespace = parts[0];

  if (namespace === 'blockchain') {
    if (parts.length < 3) {
      return err(new Error(`Invalid blockchain assetId format: ${assetId}`));
    }
    return ok({
      namespace: 'blockchain',
      chain: parts[1],
      ref: parts.slice(2).join(':'), // Handle cases like "unknown:symbol"
    });
  }

  if (namespace === 'exchange') {
    if (parts.length < 3) {
      return err(new Error(`Invalid exchange assetId format: ${assetId}`));
    }
    return ok({
      namespace: 'exchange',
      exchange: parts[1],
      currencyCode: parts[2],
    });
  }

  if (namespace === 'fiat') {
    if (parts.length < 2) {
      return err(new Error(`Invalid fiat assetId format: ${assetId}`));
    }
    return ok({
      namespace: 'fiat',
      currencyCode: parts[1],
    });
  }

  return err(new Error(`Unknown assetId namespace: ${namespace}`));
}
