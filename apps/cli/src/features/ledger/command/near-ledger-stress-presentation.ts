import { logLedgerStressResult } from './ledger-stress-presentation.js';
import type { NearLedgerStressResult } from './near-ledger-stress-types.js';

export function logNearLedgerStressResult(result: NearLedgerStressResult): void {
  logLedgerStressResult(result, {
    title: 'NEAR ledger stress',
  });
}
