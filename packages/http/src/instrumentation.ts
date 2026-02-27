/**
 * Sanitizes an endpoint URL by removing API keys and sensitive parameters.
 */
export function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint, 'http://placeholder.com');
    const pathname = url.pathname;

    // Replace common API key patterns
    return pathname
      .replace(/\/0x[a-f0-9]{40}/gi, '/{address}') // Ethereum addresses
      .replace(/\/[a-f0-9]{32,}/gi, '/{apiKey}') // Hex API keys
      .replace(/\/[A-Za-z0-9_-]{20,}/g, '/{apiKey}'); // Base64-like keys
  } catch {
    // If not a valid URL, just return the original
    return endpoint;
  }
}
