export function normalizeBlockchainTransactionHashForGrouping(hash: string): string {
  return hash.replace(/-\d+$/, '');
}
