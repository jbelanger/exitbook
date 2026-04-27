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
import { NEAR_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from './near-ledger-stress-types.js';

const NEAR_LEDGER_STRESS_CHAIN = 'near';

export interface NearLedgerStressRunOptions {
  expectedDiffs?: readonly LedgerStressExpectedDiff[] | undefined;
  tolerance?: string | undefined;
}

interface NearLedgerStressRunnerDeps {
  adapterRegistry: AdapterRegistry;
  db: DataSession;
  providerRuntime: IBlockchainProviderRuntime;
}

export class NearLedgerStressRunner {
  private readonly runner: LedgerStressRunnerCore;

  constructor(deps: NearLedgerStressRunnerDeps) {
    this.runner = new LedgerStressRunnerCore(deps, {
      expectedDiffDuplicateLabel: 'NEAR ledger stress',
      processorLabel: 'NEAR ledger-v2',
    });
  }

  async run(
    accounts: readonly Account[],
    options: NearLedgerStressRunOptions = {}
  ): Promise<Result<LedgerStressResult, Error>> {
    for (const account of accounts) {
      if (!isNearChain(account.platformKey)) {
        return err(new Error(`Account ${account.identifier} is on ${account.platformKey}, not NEAR.`));
      }
    }

    const runOptions: LedgerStressRunOptions = {
      chains: [NEAR_LEDGER_STRESS_CHAIN],
      ...(options.expectedDiffs === undefined ? {} : { expectedDiffs: options.expectedDiffs }),
      ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    };

    return this.runner.run(accounts, runOptions);
  }
}

export function parseNearLedgerStressExpectedDiffFile(value: unknown): Result<LedgerStressExpectedDiff[], Error> {
  return parseLedgerStressExpectedDiffFile(value, {
    expectedDiffsSchema: NEAR_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
    label: 'NEAR ledger stress',
  });
}

export function isNearChain(chain: string): boolean {
  return chain === NEAR_LEDGER_STRESS_CHAIN;
}
