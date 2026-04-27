import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { EVM_CHAINS } from '@exitbook/blockchain-providers/evm';
import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';

import { EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA } from './evm-family-ledger-stress-types.js';
import {
  LedgerStressRunnerCore,
  parseLedgerStressExpectedDiffFile,
  type LedgerStressRunOptions,
} from './ledger-stress-runner-core.js';
import type { LedgerStressExpectedDiff, LedgerStressResult } from './ledger-stress-types.js';

export const EVM_FAMILY_LEDGER_STRESS_CORE_CHAINS = ['arbitrum', 'avalanche', 'ethereum', 'theta'] as const;

export interface EvmFamilyLedgerStressRunOptions {
  chains: readonly string[];
  expectedDiffs?: readonly LedgerStressExpectedDiff[] | undefined;
  tolerance?: string | undefined;
}

interface EvmFamilyLedgerStressRunnerDeps {
  adapterRegistry: AdapterRegistry;
  db: DataSession;
  providerRuntime: IBlockchainProviderRuntime;
}

export class EvmFamilyLedgerStressRunner {
  private readonly runner: LedgerStressRunnerCore;

  constructor(deps: EvmFamilyLedgerStressRunnerDeps) {
    this.runner = new LedgerStressRunnerCore(deps, {
      expectedDiffDuplicateLabel: 'EVM-family ledger stress',
      processorLabel: 'Ledger-v2',
    });
  }

  async run(
    accounts: readonly Account[],
    options: EvmFamilyLedgerStressRunOptions
  ): Promise<Result<LedgerStressResult, Error>> {
    const normalizedChainsResult = normalizeEvmFamilyChains(options.chains);
    if (normalizedChainsResult.isErr()) {
      return err(normalizedChainsResult.error);
    }

    const runOptions: LedgerStressRunOptions = {
      chains: normalizedChainsResult.value,
      ...(options.expectedDiffs === undefined ? {} : { expectedDiffs: options.expectedDiffs }),
      ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    };

    return this.runner.run(accounts, runOptions);
  }
}

export function parseEvmFamilyLedgerStressExpectedDiffFile(value: unknown): Result<LedgerStressExpectedDiff[], Error> {
  return parseLedgerStressExpectedDiffFile(value, {
    expectedDiffsSchema: EVM_FAMILY_LEDGER_STRESS_EXPECTED_DIFFS_SCHEMA,
    label: 'EVM-family ledger stress',
  });
}

export function normalizeEvmFamilyChains(chains: readonly string[]): Result<string[], Error> {
  const normalizedChains = chains.map((chain) => chain.trim().toLowerCase()).filter((chain) => chain.length > 0);
  const selectedChains = normalizedChains.length > 0 ? normalizedChains : getAllEvmFamilyChains();

  for (const chain of selectedChains) {
    if (!isEvmFamilyChain(chain)) {
      return err(new Error(`Chain ${chain} is not supported by EVM-family ledger stress.`));
    }
  }

  return ok([...new Set(selectedChains)].sort());
}

export function isEvmFamilyChain(chain: string): boolean {
  return chain === 'theta' || chain in EVM_CHAINS;
}

function getAllEvmFamilyChains(): string[] {
  return [...Object.keys(EVM_CHAINS), 'theta'].sort();
}
