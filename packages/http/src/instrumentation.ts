export function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint, 'http://placeholder.com');
    const pathname = url.pathname;

    return pathname
      .replace(/\/0x[a-f0-9]{40}/gi, '/{address}')
      .replace(/\/[a-f0-9]{32,}/gi, '/{apiKey}')
      .replace(/\/[A-Za-z0-9_-]{20,}/g, '/{apiKey}');
  } catch {
    return endpoint;
  }
}
