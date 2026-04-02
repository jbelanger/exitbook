export class AmbiguousTransactionFingerprintRefError extends Error {
  readonly fingerprintRef: string;
  readonly matches: readonly string[];

  constructor(fingerprintRef: string, matches: readonly string[]) {
    const matchSuffix = matches.length > 0 ? ` Matches include: ${matches.join(', ')}` : '';
    super(`Transaction ref '${fingerprintRef}' is ambiguous. Use a longer fingerprint prefix.${matchSuffix}`);
    this.name = 'AmbiguousTransactionFingerprintRefError';
    this.fingerprintRef = fingerprintRef;
    this.matches = matches;
  }
}
