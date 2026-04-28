import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, type Result } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';

import {
  LedgerStressRunnerCore,
  parseLedgerStressExpectedDiffFile,
  type LedgerStressRunOptions,
} from './ledger-stress-runner-core.js';
import type { LedgerStressExpectedDiff, LedgerStressResult } from './ledger-stress-types.js';
import { XRP_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from './xrp-ledger-stress-types.js';

const XRP_LEDGER_STRESS_CHAIN = 'xrp';

export interface XrpLedgerStressRunOptions {
  expectedDiffs?: readonly LedgerStressExpectedDiff[] | undefined;
  tolerance?: string | undefined;
}

interface XrpLedgerStressRunnerDeps {
  adapterRegistry: AdapterRegistry;
  db: DataSession;
  providerRuntime: IBlockchainProviderRuntime;
}

export class XrpLedgerStressRunner {
  private readonly runner: LedgerStressRunnerCore;

  constructor(deps: XrpLedgerStressRunnerDeps) {
    this.runner = new LedgerStressRunnerCore(deps, {
      expectedDiffDuplicateLabel: 'XRP ledger stress',
      processorLabel: 'XRP ledger-v2',
    });
  }

  async run(
    accounts: readonly Account[],
    options: XrpLedgerStressRunOptions = {}
  ): Promise<Result<LedgerStressResult, Error>> {
    for (const account of accounts) {
      if (!isXrpChain(account.platformKey)) {
        return err(new Error(`Account ${account.identifier} is on ${account.platformKey}, not XRP.`));
      }
    }

    const runOptions: LedgerStressRunOptions = {
      chains: [XRP_LEDGER_STRESS_CHAIN],
      ...(options.expectedDiffs === undefined ? {} : { expectedDiffs: options.expectedDiffs }),
      ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    };

    return this.runner.run(accounts, runOptions);
  }
}

export function parseXrpLedgerStressExpectedDiffFile(value: unknown): Result<LedgerStressExpectedDiff[], Error> {
  return parseLedgerStressExpectedDiffFile(value, {
    expectedDiffsSchema: XRP_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
    label: 'XRP ledger stress',
  });
}

export function isXrpChain(chain: string): boolean {
  return chain === XRP_LEDGER_STRESS_CHAIN;
}
