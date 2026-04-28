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
import { SOLANA_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from './solana-ledger-stress-types.js';

const SOLANA_LEDGER_STRESS_CHAIN = 'solana';

export interface SolanaLedgerStressRunOptions {
  expectedDiffs?: readonly LedgerStressExpectedDiff[] | undefined;
  tolerance?: string | undefined;
}

interface SolanaLedgerStressRunnerDeps {
  adapterRegistry: AdapterRegistry;
  db: DataSession;
  providerRuntime: IBlockchainProviderRuntime;
}

export class SolanaLedgerStressRunner {
  private readonly runner: LedgerStressRunnerCore;

  constructor(deps: SolanaLedgerStressRunnerDeps) {
    this.runner = new LedgerStressRunnerCore(deps, {
      expectedDiffDuplicateLabel: 'Solana ledger stress',
      processorLabel: 'Solana ledger-v2',
    });
  }

  async run(
    accounts: readonly Account[],
    options: SolanaLedgerStressRunOptions = {}
  ): Promise<Result<LedgerStressResult, Error>> {
    for (const account of accounts) {
      if (!isSolanaChain(account.platformKey)) {
        return err(new Error(`Account ${account.identifier} is on ${account.platformKey}, not Solana.`));
      }
    }

    const runOptions: LedgerStressRunOptions = {
      chains: [SOLANA_LEDGER_STRESS_CHAIN],
      ...(options.expectedDiffs === undefined ? {} : { expectedDiffs: options.expectedDiffs }),
      ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    };

    return this.runner.run(accounts, runOptions);
  }
}

export function parseSolanaLedgerStressExpectedDiffFile(value: unknown): Result<LedgerStressExpectedDiff[], Error> {
  return parseLedgerStressExpectedDiffFile(value, {
    expectedDiffsSchema: SOLANA_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
    label: 'Solana ledger stress',
  });
}

export function isSolanaChain(chain: string): boolean {
  return chain === SOLANA_LEDGER_STRESS_CHAIN;
}
