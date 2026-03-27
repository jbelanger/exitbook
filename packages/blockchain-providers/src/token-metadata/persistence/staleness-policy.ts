const TOKEN_METADATA_STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const REFERENCE_PLATFORM_MAPPING_STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

function isOlderThan(updatedAt: Date, thresholdMs: number): boolean {
  return Date.now() - updatedAt.getTime() > thresholdMs;
}

export function isTokenMetadataStale(updatedAt: Date): boolean {
  return isOlderThan(updatedAt, TOKEN_METADATA_STALENESS_THRESHOLD_MS);
}

export function isReferenceMatchStale(updatedAt: Date): boolean {
  return isOlderThan(updatedAt, TOKEN_METADATA_STALENESS_THRESHOLD_MS);
}

export function isReferencePlatformMappingStale(updatedAt: Date): boolean {
  return isOlderThan(updatedAt, REFERENCE_PLATFORM_MAPPING_STALENESS_THRESHOLD_MS);
}
