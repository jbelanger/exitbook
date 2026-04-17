const HEX_IDENTIFIER_PATTERN = /^0x[0-9a-fA-F]+$/;

export function isCaseInsensitiveIdentifier(identifier: string): boolean {
  return HEX_IDENTIFIER_PATTERN.test(identifier.trim());
}

export function normalizeIdentifierForMatching(identifier: string): string {
  const trimmedIdentifier = identifier.trim();
  return isCaseInsensitiveIdentifier(trimmedIdentifier) ? trimmedIdentifier.toLowerCase() : trimmedIdentifier;
}

export function identifiersMatch(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return normalizeIdentifierForMatching(left) === normalizeIdentifierForMatching(right);
}
