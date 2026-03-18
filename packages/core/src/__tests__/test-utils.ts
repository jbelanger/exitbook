import { buildAssetMovementCanonicalMaterial, buildFeeMovementCanonicalMaterial } from '../identity/index.js';
import type { AssetMovementDraft, FeeMovementDraft } from '../transaction/index.js';

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

const DEFAULT_BLOCKCHAIN_SOURCES = new Set([
  'bitcoin',
  'cardano',
  'cosmos',
  'ethereum',
  'near',
  'solana',
  'substrate',
  'theta',
  'xrp',
]);

type SeedTxSourceType = 'blockchain' | 'exchange';

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

// Tests often need fixture fingerprints synchronously; production code uses the
// async Web Crypto helper instead.
function sha256HexSync(data: string): string {
  const message = new TextEncoder().encode(data);
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const paddedMessage = new Uint8Array(paddedLength);
  const messageView = new DataView(paddedMessage.buffer);
  const words = new Uint32Array(64);
  const bitLength = message.length * 8;

  paddedMessage.set(message);
  paddedMessage[message.length] = 0x80;
  messageView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  messageView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let hash0 = 0x6a09e667;
  let hash1 = 0xbb67ae85;
  let hash2 = 0x3c6ef372;
  let hash3 = 0xa54ff53a;
  let hash4 = 0x510e527f;
  let hash5 = 0x9b05688c;
  let hash6 = 0x1f83d9ab;
  let hash7 = 0x5be0cd19;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = messageView.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 64; index += 1) {
      const sigma0 =
        rotateRight(words[index - 15]!, 7) ^ rotateRight(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const sigma1 =
        rotateRight(words[index - 2]!, 17) ^ rotateRight(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);

      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = hash0;
    let b = hash1;
    let c = hash2;
    let d = hash3;
    let e = hash4;
    let f = hash5;
    let g = hash6;
    let h = hash7;

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash0 = (hash0 + a) >>> 0;
    hash1 = (hash1 + b) >>> 0;
    hash2 = (hash2 + c) >>> 0;
    hash3 = (hash3 + d) >>> 0;
    hash4 = (hash4 + e) >>> 0;
    hash5 = (hash5 + f) >>> 0;
    hash6 = (hash6 + g) >>> 0;
    hash7 = (hash7 + h) >>> 0;
  }

  return [hash0, hash1, hash2, hash3, hash4, hash5, hash6, hash7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

function inferSeedTxSourceType(source: string): SeedTxSourceType {
  return DEFAULT_BLOCKCHAIN_SOURCES.has(source) ? 'blockchain' : 'exchange';
}

function buildSeedAccountFingerprint(source: string, sourceType: SeedTxSourceType, accountId: number): string {
  return sha256HexSync(
    `${sourceType === 'blockchain' ? 'blockchain' : 'exchange-api'}|${source}|identifier-${accountId}`
  );
}

export function seedTxFingerprint(source: string, accountId: number, identityReference: string): string;
export function seedTxFingerprint(
  source: string,
  sourceType: SeedTxSourceType,
  accountId: number,
  identityReference: string
): string;
export function seedTxFingerprint(
  source: string,
  sourceTypeOrAccountId: SeedTxSourceType | number,
  accountIdOrIdentityReference: number | string,
  maybeIdentityReference?: string
): string {
  const sourceType = typeof sourceTypeOrAccountId === 'number' ? inferSeedTxSourceType(source) : sourceTypeOrAccountId;
  const accountId =
    typeof sourceTypeOrAccountId === 'number' ? sourceTypeOrAccountId : (accountIdOrIdentityReference as number);
  const identityReference =
    typeof sourceTypeOrAccountId === 'number' ? accountIdOrIdentityReference : maybeIdentityReference;

  if (typeof identityReference !== 'string') {
    throw new Error('identityReference is required');
  }

  const normalizedIdentityReference = identityReference.trim();
  const accountFingerprint = buildSeedAccountFingerprint(source, sourceType, accountId);
  const canonicalMaterial =
    sourceType === 'blockchain'
      ? `${accountFingerprint}|blockchain|${source}|${normalizedIdentityReference}`
      : `${accountFingerprint}|exchange|${source}|${[normalizedIdentityReference].sort().join('|')}`;

  return sha256HexSync(canonicalMaterial);
}

export function seedMovementFingerprint(
  txFingerprint: string,
  canonicalMaterial: string,
  duplicateOccurrence: number
): string {
  return `movement:${txFingerprint}:${sha256HexSync(canonicalMaterial)}:${duplicateOccurrence}`;
}

export function seedAssetMovementFingerprint(
  txFingerprint: string,
  movementType: 'inflow' | 'outflow',
  movement: Pick<AssetMovementDraft, 'assetId' | 'grossAmount' | 'netAmount'>,
  duplicateOccurrence = 1
): string {
  return seedMovementFingerprint(
    txFingerprint,
    buildAssetMovementCanonicalMaterial({
      movementType,
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    }),
    duplicateOccurrence
  );
}

export function seedFeeMovementFingerprint(
  txFingerprint: string,
  fee: Pick<FeeMovementDraft, 'assetId' | 'amount' | 'scope' | 'settlement'>,
  duplicateOccurrence = 1
): string {
  return seedMovementFingerprint(
    txFingerprint,
    buildFeeMovementCanonicalMaterial({
      assetId: fee.assetId,
      amount: fee.amount,
      scope: fee.scope,
      settlement: fee.settlement,
    }),
    duplicateOccurrence
  );
}

/**
 * Asserts that a Result is Ok and returns its value. Throws with a descriptive
 * message if the result is an Err, causing the test to fail.
 */
export function assertOk<T, E>(result: { error?: E; isOk(): boolean; value?: T }): T {
  if (!result.isOk()) {
    throw new Error(`Expected Result to be Ok, but got Err: ${String(result.error)}`);
  }
  return result.value as T;
}

/**
 * Asserts that a Result is Err and returns its error. Throws with a descriptive
 * message if the result is Ok, causing the test to fail.
 */
export function assertErr<T, E>(result: { error?: E; isErr(): boolean; value?: T }): E {
  if (!result.isErr()) {
    throw new Error(`Expected Result to be Err, but got Ok: ${String(result.value)}`);
  }
  return result.error as E;
}
