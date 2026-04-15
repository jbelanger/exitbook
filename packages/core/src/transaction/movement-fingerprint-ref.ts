export const MOVEMENT_FINGERPRINT_REF_LENGTH = 10;

export function formatMovementFingerprintRef(movementFingerprint: string): string {
  const parts = movementFingerprint.split(':');
  if (parts.length !== 3 || parts[0] !== 'movement') {
    if (movementFingerprint.length <= MOVEMENT_FINGERPRINT_REF_LENGTH) {
      return movementFingerprint;
    }

    return movementFingerprint.slice(0, MOVEMENT_FINGERPRINT_REF_LENGTH);
  }

  const movementHash = parts[1];
  const duplicateOccurrence = parts[2];
  if (!movementHash || !duplicateOccurrence) {
    return movementFingerprint.slice(0, MOVEMENT_FINGERPRINT_REF_LENGTH);
  }

  const hashRef =
    movementHash.length <= MOVEMENT_FINGERPRINT_REF_LENGTH
      ? movementHash
      : movementHash.slice(0, MOVEMENT_FINGERPRINT_REF_LENGTH);

  return `${hashRef}:${duplicateOccurrence}`;
}
