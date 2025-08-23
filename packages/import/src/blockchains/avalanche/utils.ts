// Avalanche address validation
export function isValidAvalancheAddress(address: string): boolean {
  // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
}

// Convert address to checksum (important for Avalanche case-sensitivity)
export function toChecksumAddress(address: string): string {
  // Basic implementation - in production you'd want to use a proper checksum library
  if (!isValidAvalancheAddress(address)) {
    throw new Error("Invalid Avalanche address format");
  }
  return address; // For now, return as-is, but in production implement proper checksumming
}
