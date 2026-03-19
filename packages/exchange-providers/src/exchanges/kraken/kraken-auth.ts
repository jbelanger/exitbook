import { base64ToBytes, bytesToBase64, err, hmacSha512, ok, sha256Bytes } from '@exitbook/core';
import type { Result } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import { RateLimitError } from '@exitbook/http';

const API_VERSION = '0';

interface KrakenAuth {
  readonly apiKey: string;
  readonly apiSecret: string;
}

/**
 * Sign a Kraken private API request.
 *
 * Signature = HMAC-SHA512(urlPath, SHA256(nonce + body), base64-decoded secret)
 * See: https://docs.kraken.com/api/docs/guides/spot-rest-auth
 */
function signRequest(urlPath: string, body: string, nonce: string, secret: string): string {
  const sha256Hash = sha256Bytes(nonce + body);

  const pathBytes = new TextEncoder().encode(urlPath);
  const hmacInput = new Uint8Array(pathBytes.length + sha256Hash.length);
  hmacInput.set(pathBytes);
  hmacInput.set(sha256Hash, pathBytes.length);

  const secretBytes = base64ToBytes(secret);
  const signature = hmacSha512(secretBytes, hmacInput);
  return bytesToBase64(signature);
}

/**
 * Build a fresh signed request (nonce + HMAC signature) for a Kraken private API call.
 * Called on each retry attempt to ensure the nonce is always fresh.
 */
function buildSignedRequest(
  urlPath: string,
  params: Record<string, string | number>,
  auth: KrakenAuth
): { body: string; headers: Record<string, string> } {
  const nonce = Date.now().toString();

  const bodyParams = new URLSearchParams({
    nonce,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const body = bodyParams.toString();

  const signature = signRequest(urlPath, body, nonce, auth.apiSecret);

  return {
    body,
    headers: {
      'API-Key': auth.apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
}

interface KrakenApiResponse<T> {
  error: string[];
  result: T;
}

/**
 * Make an authenticated POST request to the Kraken private API.
 * Uses HttpClient for rate limiting, retries, and timeout handling.
 * Uses buildRequest for per-attempt signing (fresh nonce on each retry).
 */
export async function krakenPost<T>(
  httpClient: HttpClient,
  auth: KrakenAuth,
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<Result<T, Error>> {
  const urlPath = `/${API_VERSION}/private/${endpoint}`;

  const result = await httpClient.request<KrakenApiResponse<T>>(urlPath, {
    method: 'POST',
    buildRequest: () => buildSignedRequest(urlPath, params, auth),
    validateResponse: (data) => {
      const resp = data as KrakenApiResponse<unknown>;
      if (resp.error?.some((e) => e.includes('Rate limit'))) {
        return new RateLimitError('Kraken rate limit exceeded', 15_000);
      }
    },
  });

  if (result.isErr()) {
    return err(result.error);
  }

  const response = result.value;
  if (response.error.length > 0) {
    return err(new Error(response.error.join(', ')));
  }

  return ok(response.result);
}
