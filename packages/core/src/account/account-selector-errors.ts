export class AmbiguousAccountFingerprintRefError extends Error {
  readonly fingerprintRef: string;
  readonly matches: readonly string[];

  constructor(fingerprintRef: string, matches: readonly string[]) {
    const matchSuffix = matches.length > 0 ? ` Matches include: ${matches.join(', ')}` : '';
    super(`Account ref '${fingerprintRef}' is ambiguous. Use a longer fingerprint prefix.${matchSuffix}`);
    this.name = 'AmbiguousAccountFingerprintRefError';
    this.fingerprintRef = fingerprintRef;
    this.matches = matches;
  }
}
