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
import { LinksCreateCommandOptionsSchema } from '../links-option-schemas.js';

import { ManualLinkCreateHandler, type LinksCreateResult } from './links-create-handler.js';

const TransactionSelectorSchema = z.string().trim().min(1, 'Transaction ref must not be empty');

type LinksCreateCommandOptions = z.infer<typeof LinksCreateCommandOptionsSchema>;

export function registerLinksCreateCommand(linksCommand: Command): void {
  linksCommand
    .command('create <source-selector> <target-selector>')
    .description('Create a confirmed manual link between two transactions when no suggestion exists')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links create e96a8b7baa b7c08af224 --asset RENDER
  $ exitbook links create e96a8b7baa b7c08af224 --asset RENDER --reason "Token migration"
  $ exitbook links create e96a8b7baa b7c08af224 --asset RENDER --json

Notes:
  - Pass the source outflow transaction first, then the target inflow transaction.
  - The asset symbol must resolve to exactly one outflow on the source and one inflow on the target.
  - This command immediately confirms the link and also writes a durable override so it survives reprocessing.
`
    )
    .requiredOption('--asset <symbol>', 'Asset symbol shared by the source outflow and target inflow')
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output JSON format')
    .action(async (sourceSelector: string, targetSelector: string, rawOptions: unknown) => {
      await executeLinksCreateCommand(sourceSelector, targetSelector, rawOptions);
    });
}

async function executeLinksCreateCommand(
  rawSourceSelector: string,
  rawTargetSelector: string,
  rawOptions: unknown
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'links-create',
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, LinksCreateCommandOptionsSchema);

        return {
          options,
          sourceSelector: yield* parseTransactionSelector(rawSourceSelector),
          targetSelector: yield* parseTransactionSelector(rawTargetSelector),
        };
      }),
    action: async (context) =>
      executeLinksCreateCommandResult(
        context.runtime,
        context.prepared.sourceSelector,
        context.prepared.targetSelector,
        context.prepared.options,
        format
      ),
  });
}

async function executeLinksCreateCommandResult(
  runtime: CommandRuntime,
  sourceSelector: string,
  targetSelector: string,
  options: LinksCreateCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(createCliFailure(profileResult.error, ExitCodes.GENERAL_ERROR));
    }

    const handler = new ManualLinkCreateHandler(
      database,
      profileResult.value.id,
      profileResult.value.profileKey,
      new OverrideStore(runtime.dataDir)
    );
    const createResult = await handler.create({
      assetSymbol: options.asset,
      reason: options.reason,
      sourceSelector,
      targetSelector,
    });
    if (createResult.isErr()) {
      return yield* err(createCliFailure(createResult.error, getTransactionSelectorErrorExitCode(createResult.error)));
    }

    if (format === 'json') {
      return jsonSuccess(createResult.value);
    }

    return textSuccess(() => {
      printLinksCreateResult(createResult.value);
    });
  });
}

function parseTransactionSelector(rawSelector: string): Result<string, ReturnType<typeof createCliFailure>> {
  const parseResult = TransactionSelectorSchema.safeParse(rawSelector);
  if (!parseResult.success) {
    return err(
      createCliFailure(
        new Error(parseResult.error.issues[0]?.message ?? 'Invalid transaction ref'),
        ExitCodes.INVALID_ARGS
      )
    );
  }

  return ok(parseResult.data);
}

function printLinksCreateResult(result: LinksCreateResult): void {
  if (result.action === 'created') {
    console.log(formatSuccessLine('Manual link created'));
  } else if (result.action === 'confirmed-existing') {
    console.log(formatSuccessLine('Existing link confirmed manually'));
  } else {
    console.log(formatSuccessLine('Manual link already confirmed'));
  }

  console.log(`   Link: #${result.linkId} (${result.linkType})`);
  console.log(
    `   Source: #${result.sourceTransactionId} (${result.sourcePlatformKey} / ${result.sourceTransactionRef}) ${result.sourceAmount} ${result.assetSymbol}`
  );
  console.log(
    `   Target: #${result.targetTransactionId} (${result.targetPlatformKey} / ${result.targetTransactionRef}) ${result.targetAmount} ${result.assetSymbol}`
  );
  if (result.existingStatusBefore && result.action !== 'already-confirmed') {
    console.log(`   Previous status: ${result.existingStatusBefore}`);
  }
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
