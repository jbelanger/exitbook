import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildProcessedTransactionsFreshnessPorts } from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';

import { ExitCodes, type ExitCode } from '../../../cli/command.js';
import { AccountSelectorResolutionError, getAccountSelectorErrorExitCode } from '../../accounts/account-selector.js';

import type { LedgerStressExpectedDiff } from './ledger-stress-types.js';

export async function assertLedgerStressProcessedTransactionsFresh(
  database: DataSession,
  profileId: number
): Promise<Result<void, Error>> {
  const freshnessResult = await buildProcessedTransactionsFreshnessPorts(database, profileId).checkFreshness();
  if (freshnessResult.isErr()) {
    return err(freshnessResult.error);
  }

  if (freshnessResult.value.status !== 'fresh') {
    return err(
      new Error(
        `Processed transactions are ${freshnessResult.value.status}: ${freshnessResult.value.reason ?? 'no detail'}. Run "exitbook reprocess" first.`
      )
    );
  }

  return ok(undefined);
}

export async function loadLedgerStressExpectedDiffs<TDiff extends LedgerStressExpectedDiff>(
  expectedDiffsPath: string | undefined,
  parse: (value: unknown) => Result<TDiff[], Error>
): Promise<Result<TDiff[], Error>> {
  if (expectedDiffsPath === undefined) {
    return ok([]);
  }

  const resolvedPath = path.resolve(process.cwd(), expectedDiffsPath);
  try {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    return parse(parsed);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export function getLedgerStressAccountResolutionExitCode(error: Error): ExitCode {
  if (error instanceof AccountSelectorResolutionError) {
    return getAccountSelectorErrorExitCode(error);
  }

  return ExitCodes.INVALID_ARGS;
}
