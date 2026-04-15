import { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import {
  createCliFailure,
  ExitCodes,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  type CliCommandResult,
} from '../../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../../cli/options.js';
import { formatSuccessLine } from '../../../../cli/success.js';
import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../../profiles/profile-resolution.js';
import { getTransactionSelectorErrorExitCode } from '../../../transactions/transaction-selector.js';
import { LinksCreateGroupedCommandOptionsSchema } from '../links-option-schemas.js';

import { ManualGroupedLinkCreateHandler, type LinksCreateGroupedResult } from './links-create-grouped-handler.js';

const TransactionSelectorSchema = z.string().trim().min(1, 'Transaction ref must not be empty');

type LinksCreateGroupedCommandOptions = z.infer<typeof LinksCreateGroupedCommandOptionsSchema>;

export function registerLinksCreateGroupedCommand(linksCommand: Command): void {
  linksCommand
    .command('create-grouped')
    .description('Create confirmed grouped manual links for exact many-to-one or one-to-many transfers')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links create-grouped --source 78a82e8482 --source d0c794045d --target 38adc7a548 --asset ADA
  $ exitbook links create-grouped --source 1001abcd --target 2002efgh --target 3003ijkl --asset USDC --reason "Bridge split"
  $ exitbook links create-grouped --source 78a82e8482 --source d0c794045d --target 38adc7a548 --asset ADA --json

Notes:
  - Repeat --source or --target so exactly one side contains multiple transactions.
  - This command supports only exact many-to-one or one-to-many grouped transfers.
  - The selected movements must balance exactly for the requested asset.
  - This command immediately confirms the grouped links and also writes durable overrides so they survive reprocessing.
`
    )
    .requiredOption(
      '--source <selector>',
      'Source outflow transaction ref. Repeat for grouped source legs.',
      collect,
      []
    )
    .requiredOption(
      '--target <selector>',
      'Target inflow transaction ref. Repeat for grouped target legs.',
      collect,
      []
    )
    .requiredOption('--asset <symbol>', 'Asset symbol shared by all selected source outflows and target inflows')
    .option('--reason <text>', 'Optional audit reason stored with the override events')
    .option('--json', 'Output JSON format')
    .action(async (rawOptions: unknown) => {
      await executeLinksCreateGroupedCommand(rawOptions);
    });
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function executeLinksCreateGroupedCommand(rawOptions: unknown): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'links-create-grouped',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, LinksCreateGroupedCommandOptionsSchema);

        return {
          options,
          sourceSelectors: yield* collectTransactionSelectors(options.source),
          targetSelectors: yield* collectTransactionSelectors(options.target),
        };
      }),
    action: async (context) =>
      executeLinksCreateGroupedCommandResult(
        context.runtime,
        context.prepared.sourceSelectors,
        context.prepared.targetSelectors,
        context.prepared.options,
        format
      ),
  });
}

async function executeLinksCreateGroupedCommandResult(
  runtime: CommandRuntime,
  sourceSelectors: string[],
  targetSelectors: string[],
  options: LinksCreateGroupedCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(createCliFailure(profileResult.error, ExitCodes.GENERAL_ERROR));
    }

    const handler = new ManualGroupedLinkCreateHandler(
      database,
      profileResult.value.id,
      profileResult.value.profileKey,
      new OverrideStore(runtime.dataDir)
    );
    const createResult = await handler.create({
      assetSymbol: options.asset,
      reason: options.reason,
      sourceSelectors,
      targetSelectors,
    });
    if (createResult.isErr()) {
      return yield* err(createCliFailure(createResult.error, getTransactionSelectorErrorExitCode(createResult.error)));
    }

    if (format === 'json') {
      return jsonSuccess(createResult.value);
    }

    return textSuccess(() => {
      printLinksCreateGroupedResult(createResult.value);
    });
  });
}

function collectTransactionSelectors(rawSelectors: string[]): Result<string[], ReturnType<typeof createCliFailure>> {
  const selectors: string[] = [];

  for (const rawSelector of rawSelectors) {
    const parseResult = TransactionSelectorSchema.safeParse(rawSelector);
    if (!parseResult.success) {
      return err(
        createCliFailure(
          new Error(parseResult.error.issues[0]?.message ?? 'Invalid transaction ref'),
          ExitCodes.INVALID_ARGS
        )
      );
    }

    selectors.push(parseResult.data);
  }

  return ok(selectors);
}

function printLinksCreateGroupedResult(result: LinksCreateGroupedResult): void {
  switch (result.action) {
    case 'created':
      console.log(formatSuccessLine('Grouped manual links created'));
      break;
    case 'confirmed-existing':
      console.log(formatSuccessLine('Existing grouped links confirmed manually'));
      break;
    case 'already-confirmed':
      console.log(formatSuccessLine('Grouped manual links already confirmed'));
      break;
    case 'mixed':
      console.log(formatSuccessLine('Grouped manual links applied'));
      break;
  }

  console.log(`   Shape: ${result.groupShape} (${result.sourceCount} source, ${result.targetCount} target)`);
  console.log(
    `   Links: ${result.links.length} total (${result.createdCount} created, ${result.confirmedExistingCount} confirmed existing, ${result.unchangedCount} unchanged)`
  );
  for (const entry of result.links) {
    console.log(
      `   - #${entry.linkId} ${entry.sourceTransactionRef} -> ${entry.targetTransactionRef} ${entry.sourceAmount} ${result.assetSymbol} (${entry.action})`
    );
  }
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
