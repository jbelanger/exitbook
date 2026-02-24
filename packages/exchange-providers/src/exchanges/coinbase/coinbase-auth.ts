import crypto from 'node:crypto';

const BASE_URL = 'https://api.coinbase.com';

interface CoinbaseAuth {
  readonly apiKey: string;
  readonly secret: string;
}

/**
 * Build an ES256-signed JWT for Coinbase API authentication.
 *
 * Format matches ccxt's createAuthToken for ECDSA keys:
 * - Header: { alg: "ES256", typ: "JWT", kid: apiKey, nonce: random }
 * - Payload: { aud: ["retail_rest_api_proxy"], iss: "coinbase-cloud", nbf, exp, sub, uri }
 */
function buildJwt(auth: CoinbaseAuth, method: string, path: string): string {
  const now = Math.floor(Date.now() / 1000);
  const uri = `${method} api.coinbase.com${path}`;
  const nonce = crypto.randomBytes(16).toString('hex');

  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: auth.apiKey,
    nonce,
  };

  const payload = {
    aud: ['retail_rest_api_proxy'],
    iss: 'coinbase-cloud',
    nbf: now,
    exp: now + 120,
    sub: auth.apiKey,
    iat: now,
    uri,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const message = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(message);
  const derSignature = sign.sign(auth.secret);

  // Convert DER signature to raw r||s format (64 bytes) for ES256 JWT
  const rawSignature = derToRaw(derSignature);
  const encodedSignature = base64url(rawSignature);

  return `${message}.${encodedSignature}`;
}

/** DER-encoded ECDSA signature → raw 64-byte r||s */
function derToRaw(der: Buffer): Buffer {
  // DER: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
  let offset = 2; // skip 0x30 + total length
  // r
  offset += 1; // skip 0x02
  const rLen = der[offset]!;
  offset += 1;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;
  // s
  offset += 1; // skip 0x02
  const sLen = der[offset]!;
  offset += 1;
  const s = der.subarray(offset, offset + sLen);

  const raw = Buffer.alloc(64);
  // Right-align r and s into 32-byte slots (they may have leading zero padding)
  r.subarray(Math.max(0, rLen - 32)).copy(raw, 32 - Math.min(32, rLen));
  s.subarray(Math.max(0, sLen - 32)).copy(raw, 64 - Math.min(32, sLen));
  return raw;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

export interface CoinbasePaginatedResponse<T> {
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
 */
export async function coinbaseGet<T>(auth: CoinbaseAuth, path: string): Promise<CoinbasePaginatedResponse<T>> {
  // Strip query params from URI for signing (matches ccxt behavior)
  const pathForSigning = path.split('?')[0]!;
  const token = buildJwt(auth, 'GET', pathForSigning);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'CB-VERSION': '2018-05-30',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Coinbase API error ${response.status}: ${body}`);
  }

  return (await response.json()) as CoinbasePaginatedResponse<T>;
}
