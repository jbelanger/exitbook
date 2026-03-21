/* eslint-disable unicorn/no-null -- API response fixture shape */
import { ok } from '@exitbook/core';
import type { HttpClient } from '@exitbook/http';
import { importSPKI, jwtVerify } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { coinbaseGet } from '../auth.js';

const TEST_API_KEY = 'organizations/test-org/apiKeys/test-key';
const TEST_PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFjEtiE+GdXYxqoWc1Up0FwH/4GhPcAiLPbzCkeKnslYoAoGCCqGSM49
AwEHoUQDQgAEBrtGfZanTUDhKZ4+OKOBbT3HyyXl34Or8205S2OPCnOXDhSxV2dq
wyRBfRuLvIed/8uPDvyGkUS8w71k1/0IbA==
-----END EC PRIVATE KEY-----`;
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBrtGfZanTUDhKZ4+OKOBbT3HyyXl
34Or8205S2OPCnOXDhSxV2dqwyRBfRuLvIed/8uPDvyGkUS8w71k1/0IbA==
-----END PUBLIC KEY-----`;

function createHttpClientStub() {
  return {
    get: vi.fn().mockResolvedValue(
      ok({
        pagination: {
          ending_before: null,
          limit: 100,
          next_starting_after: null,
          next_uri: null,
          order: 'asc',
          starting_after: null,
        },
        data: [],
      })
    ),
  } as unknown as HttpClient & { get: ReturnType<typeof vi.fn> };
}

describe('coinbaseGet', () => {
  it('builds a valid ES256 bearer token from an EC private key PEM', async () => {
    const httpClient = createHttpClientStub();

    const result = await coinbaseGet(
      httpClient,
      {
        apiKey: TEST_API_KEY,
        secret: TEST_PRIVATE_KEY,
      },
      '/v2/accounts'
    );

    expect(result.isOk()).toBe(true);
    expect(httpClient.get).toHaveBeenCalledTimes(1);

    const [, options] = httpClient.get.mock.calls[0] as [string, { headers: Record<string, string> }];
    const authorization = options.headers['Authorization'];
    expect(authorization?.startsWith('Bearer ')).toBe(true);
    expect(authorization).toBeDefined();

    if (authorization === undefined) {
      throw new Error('Authorization header missing');
    }

    const token = authorization.slice('Bearer '.length);
    const publicKey = await importSPKI(TEST_PUBLIC_KEY, 'ES256');
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      issuer: 'coinbase-cloud',
      subject: TEST_API_KEY,
      audience: 'retail_rest_api_proxy',
    });

    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.typ).toBe('JWT');
    expect(protectedHeader.kid).toBe(TEST_API_KEY);
    expect(typeof protectedHeader['nonce']).toBe('string');
    expect(String(protectedHeader['nonce'])).toMatch(/^[0-9a-f]{32}$/);

    expect(payload['uri']).toBe('GET api.coinbase.com/v2/accounts');
    expect(payload.exp).toBeTypeOf('number');
    expect(payload.iat).toBeTypeOf('number');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(120);
  });
});
