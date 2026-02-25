import crypto from 'node:crypto';

import type { HttpClient } from '@exitbook/http';
import { RateLimitError } from '@exitbook/http';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

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
  const sha256Hash = crypto
    .createHash('sha256')
    .update(nonce + body)
    .digest();
  const hmacInput = Buffer.concat([Buffer.from(urlPath), sha256Hash]);
  const secretBuffer = Buffer.from(secret, 'base64');
  return crypto.createHmac('sha512', secretBuffer).update(hmacInput).digest('base64');
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
