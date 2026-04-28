import { logLedgerStressResult } from './ledger-stress-presentation.js';
import type { SolanaLedgerStressResult } from './solana-ledger-stress-types.js';

export function logSolanaLedgerStressResult(result: SolanaLedgerStressResult): void {
  logLedgerStressResult(result, {
    title: 'Solana ledger stress',
  });
}
