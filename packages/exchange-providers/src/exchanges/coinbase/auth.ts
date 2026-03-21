import { base64ToBytes, bytesToBase64, err, ok, randomHex } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import type { HttpClient } from '@exitbook/http';
import { importPKCS8, SignJWT } from 'jose';

interface CoinbaseAuth {
  readonly apiKey: string;
  readonly secret: string;
}

const COINBASE_AUDIENCE = 'retail_rest_api_proxy';
const COINBASE_ISSUER = 'coinbase-cloud';
const SEC1_EC_PRIVATE_KEY_HEADER = '-----BEGIN EC PRIVATE KEY-----';
const SEC1_EC_PRIVATE_KEY_FOOTER = '-----END EC PRIVATE KEY-----';
const PKCS8_PRIVATE_KEY_HEADER = '-----BEGIN PRIVATE KEY-----';
const PKCS8_PRIVATE_KEY_FOOTER = '-----END PRIVATE KEY-----';
const EC_P256_ALGORITHM_IDENTIFIER_DER = Uint8Array.from([
  0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
  0x01, 0x07,
]);

const signingKeyCache = new WeakMap<CoinbaseAuth, Promise<CryptoKey>>();

/**
 * Build an ES256-signed JWT for Coinbase API authentication.
 *
 * ES256-signed JWT for Coinbase Advanced Trade API:
 * - Header: { alg: "ES256", typ: "JWT", kid: apiKey, nonce: random }
 * - Payload: { aud: ["retail_rest_api_proxy"], iss: "coinbase-cloud", nbf, exp, sub, uri }
 */
async function buildJwt(auth: CoinbaseAuth, method: string, path: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const uri = `${method} api.coinbase.com${path}`;
  const nonce = randomHex(16);
  const signingKey = await getSigningKey(auth);

  return new SignJWT({ uri })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'JWT',
      kid: auth.apiKey,
      nonce,
    })
    .setAudience([COINBASE_AUDIENCE])
    .setIssuer(COINBASE_ISSUER)
    .setSubject(auth.apiKey)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(signingKey);
}

function getSigningKey(auth: CoinbaseAuth): Promise<CryptoKey> {
  const cachedKey = signingKeyCache.get(auth);
  if (cachedKey) {
    return cachedKey;
  }

  const signingKeyPromise = importPKCS8(normalizeCoinbasePrivateKey(auth.secret), 'ES256').catch((error: unknown) => {
    signingKeyCache.delete(auth);
    throw error;
  });
  signingKeyCache.set(auth, signingKeyPromise);
  return signingKeyPromise;
}

function normalizeCoinbasePrivateKey(secret: string): string {
  if (secret.includes(PKCS8_PRIVATE_KEY_HEADER)) {
    return secret;
  }

  if (secret.includes(SEC1_EC_PRIVATE_KEY_HEADER)) {
    const sec1Der = pemToDer(secret, SEC1_EC_PRIVATE_KEY_HEADER, SEC1_EC_PRIVATE_KEY_FOOTER);
    const pkcs8Der = wrapEcPrivateKeyInPkcs8(sec1Der);
    return derToPem(pkcs8Der, PKCS8_PRIVATE_KEY_HEADER, PKCS8_PRIVATE_KEY_FOOTER);
  }

  throw new Error('Unsupported Coinbase private key format');
}

function pemToDer(pem: string, header: string, footer: string): Uint8Array {
  const base64 = pem.replace(header, '').replace(footer, '').replaceAll(/\s+/g, '');
  return base64ToBytes(base64);
}

function derToPem(der: Uint8Array, header: string, footer: string): string {
  const base64 = bytesToBase64(der);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [header, ...lines, footer].join('\n');
}

function wrapEcPrivateKeyInPkcs8(sec1PrivateKeyDer: Uint8Array): Uint8Array {
  const versionDer = Uint8Array.from([0x02, 0x01, 0x00]);
  const privateKeyOctetString = concatenateBytes(
    Uint8Array.from([0x04]),
    encodeDerLength(sec1PrivateKeyDer.length),
    sec1PrivateKeyDer
  );
  const body = concatenateBytes(versionDer, EC_P256_ALGORITHM_IDENTIFIER_DER, privateKeyOctetString);

  return concatenateBytes(Uint8Array.from([0x30]), encodeDerLength(body.length), body);
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) {
    return Uint8Array.from([length]);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function concatenateBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

interface CoinbasePaginatedResponse<T> {
  pagination: {
    ending_before: string | null;
    limit: number;
    next_starting_after: string | null;
    next_uri: string | null;
    order: string;
    starting_after: string | null;
  };
  data: T[];
}

/**
 * Make an authenticated GET request to the Coinbase v2 API.
 * Uses HttpClient for rate limiting, retries, and timeout handling.
 */
export async function coinbaseGet<T>(
  httpClient: HttpClient,
  auth: CoinbaseAuth,
  path: string
): Promise<Result<CoinbasePaginatedResponse<T>, Error>> {
  // Strip query params from URI for signing
  const pathForSigning = path.split('?')[0]!;
  let token: string;
  try {
    token = await buildJwt(auth, 'GET', pathForSigning);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }

  const result = await httpClient.get<CoinbasePaginatedResponse<T>>(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      'CB-VERSION': '2018-05-30',
    },
  });

  if (result.isErr()) {
    return err(result.error);
  }

  return ok(result.value);
}
