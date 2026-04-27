import type { EvmFamilyLedgerStressResult } from './evm-family-ledger-stress-types.js';
import { logLedgerStressResult } from './ledger-stress-presentation.js';

export function logEvmFamilyLedgerStressResult(result: EvmFamilyLedgerStressResult): void {
  logLedgerStressResult(result, {
    title: 'EVM-family ledger stress',
    formatChains: formatEvmFamilyChains,
  });
}

function formatEvmFamilyChains(chains: readonly string[]): string {
  const visibleCoreChains = chains.filter((chain) => ['arbitrum', 'avalanche', 'ethereum', 'theta'].includes(chain));
  if (visibleCoreChains.length === 4 && chains.length > 8) {
    return `all EVM-compatible chains plus theta (${chains.length} chains)`;
  }

  return chains.join(', ');
}
