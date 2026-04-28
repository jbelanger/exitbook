import type { Account } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { z } from 'zod';

import {
  cliErr,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  type CliCommandResult,
  type CliCompletion,
  type ExitCode,
} from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsWithOverridesResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveOwnedOptionalAccountSelector } from '../../accounts/account-selector.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { SolanaLedgerStressCommandOptionsSchema } from './ledger-option-schemas.js';
import {
  assertLedgerStressProcessedTransactionsFresh,
  getLedgerStressAccountResolutionExitCode,
  loadLedgerStressExpectedDiffs,
} from './ledger-stress-command-support.js';
import { logSolanaLedgerStressResult } from './solana-ledger-stress-presentation.js';
import {
  isSolanaChain,
  parseSolanaLedgerStressExpectedDiffFile,
  SolanaLedgerStressRunner,
} from './solana-ledger-stress-runner.js';
import type { SolanaLedgerStressResult } from './solana-ledger-stress-types.js';

type SolanaLedgerStressCommandOptions = z.infer<typeof SolanaLedgerStressCommandOptionsSchema>;

const SOLANA_LEDGER_STRESS_COMMAND_ID = 'ledger-stress-solana';

interface ExecuteSolanaLedgerStressCommandInput {
  appRuntime: CliAppRuntime;
  rawOptions: unknown;
  selector: string | undefined;
}

export function buildSolanaLedgerStressHelpText(): string {
  return `
Examples:
  $ exitbook ledger stress solana
  $ exitbook ledger stress solana solana-wallet-1
  $ exitbook ledger stress solana --expected-diffs ./fixtures/solana-ledger-diffs.json
  $ exitbook ledger stress solana --json

Notes:
  - Stress reruns Solana ledger-v2 from stored provider raw rows and compares against persisted legacy balance impact.
  - The command is read-only; run "exitbook reprocess" first when processed transactions are stale.
  - Default mode allows no diffs. Use --expected-diffs for documented intentional divergences such as partial-history staking category differences.
`;
}

export async function executeSolanaLedgerStressCommand(input: ExecuteSolanaLedgerStressCommandInput): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    command: SOLANA_LEDGER_STRESS_COMMAND_ID,
    format,
    appRuntime: input.appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          input.rawOptions,
          { selector: input.selector },
          SolanaLedgerStressCommandOptionsSchema
        );
      }),
    action: async (context) => executeCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeCommandResult(
  ctx: CommandRuntime,
  options: SolanaLedgerStressCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  const database = await ctx.openDatabaseSession();
  const profileResult = await resolveCommandProfile(ctx, database);
  if (profileResult.isErr()) {
    return cliErr(profileResult.error, ExitCodes.CONFIG_ERROR);
  }
  const profile = profileResult.value;

  const freshnessResult = await assertLedgerStressProcessedTransactionsFresh(database, profile.id);
  if (freshnessResult.isErr()) {
    return cliErr(freshnessResult.error, ExitCodes.GENERAL_ERROR);
  }

  const expectedDiffsResult = await loadLedgerStressExpectedDiffs(
    options.expectedDiffs,
    parseSolanaLedgerStressExpectedDiffFile
  );
  if (expectedDiffsResult.isErr()) {
    return cliErr(expectedDiffsResult.error, ExitCodes.INVALID_ARGS);
  }

  const accountsResult = await resolveStressAccounts(database, profile.id, options.selector);
  if (accountsResult.isErr()) {
    return cliErr(accountsResult.error, getLedgerStressAccountResolutionExitCode(accountsResult.error));
  }

  if (accountsResult.value.length === 0) {
    return cliErr(new Error('No Solana accounts found for the selected profile'), ExitCodes.NOT_FOUND);
  }

  const providerRuntime = await ctx.createManagedBlockchainProviderRuntime();
  const runner = new SolanaLedgerStressRunner({
    adapterRegistry: ctx.requireAppRuntime().adapterRegistry,
    db: database,
    providerRuntime,
  });

  const result = await runner.run(accountsResult.value, {
    expectedDiffs: expectedDiffsResult.value,
  });
  if (result.isErr()) {
    return cliErr(result.error, ExitCodes.GENERAL_ERROR);
  }

  return format === 'json' ? buildJsonCompletion(result.value) : buildTextCompletion(result.value);
}

async function resolveStressAccounts(
  database: DataSession,
  profileId: number,
  selector: string | undefined
): Promise<Result<Account[], Error>> {
  const accountService = createCliAccountLifecycleService(database);

  if (selector !== undefined && selector.trim().length > 0) {
    const selection = await resolveOwnedOptionalAccountSelector(accountService, profileId, selector);
    if (selection.isErr()) {
      return err(selection.error);
    }

    const account = selection.value?.account;
    if (account === undefined) {
      return err(new Error(`Account selector '${selector}' not found`));
    }
    if (account.accountType !== 'blockchain' || !isSolanaChain(account.platformKey)) {
      return err(new Error(`Account ${selector} is not a Solana blockchain account`));
    }

    return ok([account]);
  }

  const accountsResult = await database.accounts.findAll({
    accountType: 'blockchain',
    platformKey: 'solana',
    profileId,
  });
  if (accountsResult.isErr()) {
    return err(accountsResult.error);
  }

  return ok(accountsResult.value.sort((left, right) => left.id - right.id));
}

function buildJsonCompletion(result: SolanaLedgerStressResult): Result<CliCompletion, never> {
  return ok(jsonSuccess(result, { timestamp: new Date().toISOString() }, getExitCode(result)));
}

function buildTextCompletion(result: SolanaLedgerStressResult): Result<CliCompletion, never> {
  return ok(textSuccess(() => logSolanaLedgerStressResult(result), getExitCode(result)));
}

function getExitCode(result: SolanaLedgerStressResult): ExitCode {
  return result.status === 'passed' ? ExitCodes.SUCCESS : ExitCodes.GENERAL_ERROR;
}
