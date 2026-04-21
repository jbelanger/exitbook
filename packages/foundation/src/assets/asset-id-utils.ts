import { err, ok, type Result } from '../result/index.js';

/** Asset ID builders and parsers for blockchain, exchange, and fiat namespaces. */
export function buildBlockchainNativeAssetId(chain: string): Result<string, Error> {
  if (!chain || chain.trim() === '') {
    return err(new Error('Chain name must not be empty'));
  }
  return ok(`blockchain:${chain.toLowerCase()}:native`);
}

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

export function buildExchangeAssetId(exchange: string, currencyCode: string): Result<string, Error> {
  if (!exchange || exchange.trim() === '') {
    return err(new Error('Exchange name must not be empty'));
  }
  if (!currencyCode || currencyCode.trim() === '') {
    return err(new Error('Currency code must not be empty'));
  }
  return ok(`exchange:${exchange.toLowerCase()}:${currencyCode.toLowerCase()}`);
}

export function buildFiatAssetId(currencyCode: string): Result<string, Error> {
  if (!currencyCode || currencyCode.trim() === '') {
    return err(new Error('Currency code must not be empty'));
  }
  return ok(`fiat:${currencyCode.toLowerCase()}`);
}

/**
 * Returns true if the assetId does NOT contain an "unknown" token reference sentinel.
 * Rejects patterns like blockchain:ethereum:unknown or blockchain:ethereum:unknown:usdc.
 */
export function hasNoUnknownTokenRef(assetId: string): boolean {
  const parts = assetId.split(':');
  return !(parts.length >= 3 && parts[0] === 'blockchain' && parts[2] === 'unknown');
}

/**
 * Returns true if a blockchain assetId has the required 3-part structure with a non-empty ref.
 * Non-blockchain assetIds pass through (returns true).
 */
export function hasValidBlockchainAssetIdFormat(assetId: string): boolean {
  const parts = assetId.split(':');
  if (parts[0] !== 'blockchain') return true;
  return parts.length >= 3 && !!parts[2] && parts[2].trim() !== '';
}

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
      ref: parts.slice(2).join(':'),
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
    return ok({
      namespace: 'fiat',
      currencyCode: parts[1],
    });
  }

  return err(new Error(`Unknown assetId namespace: ${namespace}`));
}
