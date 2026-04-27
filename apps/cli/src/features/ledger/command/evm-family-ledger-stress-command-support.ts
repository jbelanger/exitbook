import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Account } from '@exitbook/core';
import { buildProcessedTransactionsFreshnessPorts } from '@exitbook/data/projections';
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
import {
  AccountSelectorResolutionError,
  getAccountSelectorErrorExitCode,
  resolveOwnedOptionalAccountSelector,
} from '../../accounts/account-selector.js';
import { createCliAccountLifecycleService } from '../../accounts/account-service.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { logEvmFamilyLedgerStressResult } from './evm-family-ledger-stress-presentation.js';
import {
  EVM_FAMILY_LEDGER_STRESS_CORE_CHAINS,
  EvmFamilyLedgerStressRunner,
  isEvmFamilyChain,
  normalizeEvmFamilyChains,
  parseEvmFamilyLedgerStressExpectedDiffFile,
} from './evm-family-ledger-stress-runner.js';
import type {
  EvmFamilyLedgerStressExpectedDiff,
  EvmFamilyLedgerStressResult,
} from './evm-family-ledger-stress-types.js';
import { EvmFamilyLedgerStressCommandOptionsSchema } from './ledger-option-schemas.js';

type EvmFamilyLedgerStressCommandOptions = z.infer<typeof EvmFamilyLedgerStressCommandOptionsSchema>;

const EVM_FAMILY_LEDGER_STRESS_COMMAND_ID = 'ledger-stress-evm-family';

interface ExecuteEvmFamilyLedgerStressCommandInput {
  appRuntime: CliAppRuntime;
  rawOptions: unknown;
  selector: string | undefined;
}

export function buildEvmFamilyLedgerStressHelpText(): string {
  return `
Examples:
  $ exitbook ledger stress evm-family
  $ exitbook ledger stress evm-family ethereum-main
  $ exitbook ledger stress evm-family --chains ethereum,arbitrum,avalanche,theta
  $ exitbook ledger stress evm-family --expected-diffs ./fixtures/evm-ledger-diffs.json
  $ exitbook ledger stress evm-family --json

Notes:
  - Stress reruns ledger-v2 from stored raw rows and compares against persisted legacy balance impact.
  - The command is read-only; run "exitbook reprocess" first when processed transactions are stale.
  - Default mode allows no diffs. Use --expected-diffs for documented intentional divergences.
  - Core migration coverage should include ${EVM_FAMILY_LEDGER_STRESS_CORE_CHAINS.join(', ')}.
`;
}

export async function executeEvmFamilyLedgerStressCommand(
  input: ExecuteEvmFamilyLedgerStressCommandInput
): Promise<void> {
  const format = detectCliOutputFormat(input.rawOptions);

  await runCliRuntimeCommand({
    command: EVM_FAMILY_LEDGER_STRESS_COMMAND_ID,
    format,
    appRuntime: input.appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        return yield* parseCliCommandOptionsWithOverridesResult(
          input.rawOptions,
          { selector: input.selector },
          EvmFamilyLedgerStressCommandOptionsSchema
        );
      }),
    action: async (context) => executeCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeCommandResult(
  ctx: CommandRuntime,
  options: EvmFamilyLedgerStressCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  const database = await ctx.openDatabaseSession();
  const profileResult = await resolveCommandProfile(ctx, database);
  if (profileResult.isErr()) {
    return cliErr(profileResult.error, ExitCodes.CONFIG_ERROR);
  }
  const profile = profileResult.value;

  const freshnessResult = await assertProcessedTransactionsFresh(database, profile.id);
  if (freshnessResult.isErr()) {
    return cliErr(freshnessResult.error, ExitCodes.GENERAL_ERROR);
  }

  const chainsResult = parseChainsOption(options.chains);
  if (chainsResult.isErr()) {
    return cliErr(chainsResult.error, ExitCodes.INVALID_ARGS);
  }

  const expectedDiffsResult = await loadExpectedDiffs(options.expectedDiffs);
  if (expectedDiffsResult.isErr()) {
    return cliErr(expectedDiffsResult.error, ExitCodes.INVALID_ARGS);
  }

  const accountsResult = await resolveStressAccounts(database, profile.id, options.selector, chainsResult.value);
  if (accountsResult.isErr()) {
    return cliErr(accountsResult.error, getStressAccountResolutionExitCode(accountsResult.error));
  }

  if (accountsResult.value.length === 0) {
    return cliErr(new Error('No EVM-family accounts found for the selected profile and chains'), ExitCodes.NOT_FOUND);
  }

  const providerRuntime = await ctx.createManagedBlockchainProviderRuntime();
  const runner = new EvmFamilyLedgerStressRunner({
    adapterRegistry: ctx.requireAppRuntime().adapterRegistry,
    db: database,
    providerRuntime,
  });

  const result = await runner.run(accountsResult.value, {
    chains: chainsResult.value,
    expectedDiffs: expectedDiffsResult.value,
  });
  if (result.isErr()) {
    return cliErr(result.error, ExitCodes.GENERAL_ERROR);
  }

  return format === 'json' ? buildJsonCompletion(result.value) : buildTextCompletion(result.value);
}

async function assertProcessedTransactionsFresh(
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

function parseChainsOption(value: string | undefined): Result<string[], Error> {
  const chains = value === undefined ? [] : value.split(',');
  return normalizeEvmFamilyChains(chains);
}

async function loadExpectedDiffs(
  expectedDiffsPath: string | undefined
): Promise<Result<EvmFamilyLedgerStressExpectedDiff[], Error>> {
  if (expectedDiffsPath === undefined) {
    return ok([]);
  }

  const resolvedPath = path.resolve(process.cwd(), expectedDiffsPath);
  try {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    return parseEvmFamilyLedgerStressExpectedDiffFile(parsed);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function resolveStressAccounts(
  database: DataSession,
  profileId: number,
  selector: string | undefined,
  chains: readonly string[]
): Promise<Result<Account[], Error>> {
  const accountService = createCliAccountLifecycleService(database);
  const chainSet = new Set(chains);

  if (selector !== undefined && selector.trim().length > 0) {
    const selection = await resolveOwnedOptionalAccountSelector(accountService, profileId, selector);
    if (selection.isErr()) {
      return err(selection.error);
    }

    const account = selection.value?.account;
    if (account === undefined) {
      return err(new Error(`Account selector '${selector}' not found`));
    }
    if (account.accountType !== 'blockchain' || !isEvmFamilyChain(account.platformKey)) {
      return err(new Error(`Account ${selector} is not an EVM-family blockchain account`));
    }
    if (!chainSet.has(account.platformKey)) {
      return err(new Error(`Account ${selector} is on ${account.platformKey}, outside selected chains`));
    }

    return ok([account]);
  }

  const accountsResult = await database.accounts.findAll({
    accountType: 'blockchain',
    profileId,
  });
  if (accountsResult.isErr()) {
    return err(accountsResult.error);
  }

  return ok(
    accountsResult.value
      .filter((account) => isEvmFamilyChain(account.platformKey) && chainSet.has(account.platformKey))
      .sort((left, right) => left.platformKey.localeCompare(right.platformKey) || left.id - right.id)
  );
}

function getStressAccountResolutionExitCode(error: Error): ExitCode {
  if (error instanceof AccountSelectorResolutionError) {
    return getAccountSelectorErrorExitCode(error);
  }

  return ExitCodes.INVALID_ARGS;
}

function buildJsonCompletion(result: EvmFamilyLedgerStressResult): Result<CliCompletion, never> {
  return ok(jsonSuccess(result, { timestamp: new Date().toISOString() }, getExitCode(result)));
}

function buildTextCompletion(result: EvmFamilyLedgerStressResult): Result<CliCompletion, never> {
  return ok(textSuccess(() => logEvmFamilyLedgerStressResult(result), getExitCode(result)));
}

function getExitCode(result: EvmFamilyLedgerStressResult): ExitCode {
  return result.status === 'passed' ? ExitCodes.SUCCESS : ExitCodes.GENERAL_ERROR;
}
