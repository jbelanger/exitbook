import { logLedgerStressResult } from './ledger-stress-presentation.js';
import type { XrpLedgerStressResult } from './xrp-ledger-stress-types.js';

export function logXrpLedgerStressResult(result: XrpLedgerStressResult): void {
  logLedgerStressResult(result, {
    title: 'XRP ledger stress',
  });
}
