import { buildProfileLinkGapSourceReader } from '@exitbook/data/accounting';
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
import { LinksGapResolutionCommandOptionsSchema } from '../links-option-schemas.js';

import {
  LinksGapResolutionHandler,
  type LinksGapResolutionAction,
  type LinksGapResolutionResult,
} from './links-gap-resolution-handler.js';

const GapSelectorArgumentSchema = z.string().trim().min(1, 'Gap ref must not be empty');

type LinksGapResolutionCommandOptions = z.infer<typeof LinksGapResolutionCommandOptionsSchema>;

interface LinksGapResolutionCommandDefinition<TAction extends LinksGapResolutionAction> {
  action: TAction;
  commandId: `links-gaps-${TAction}`;
  commandName: TAction;
  description: string;
}

const LINKS_GAP_RESOLUTION_COMMANDS = {
  reopen: {
    action: 'reopen',
    commandId: 'links-gaps-reopen',
    commandName: 'reopen',
    description: 'Reopen a previously-resolved link gap',
  },
  resolve: {
    action: 'resolve',
    commandId: 'links-gaps-resolve',
    commandName: 'resolve',
    description: 'Resolve a link gap without creating a link',
  },
} as const satisfies Record<LinksGapResolutionAction, LinksGapResolutionCommandDefinition<LinksGapResolutionAction>>;

export function registerLinksGapResolveCommand(gapsCommand: Command): void {
  registerLinksGapResolutionCommand(gapsCommand, LINKS_GAP_RESOLUTION_COMMANDS.resolve);
}

export function registerLinksGapReopenCommand(gapsCommand: Command): void {
  registerLinksGapResolutionCommand(gapsCommand, LINKS_GAP_RESOLUTION_COMMANDS.reopen);
}

function registerLinksGapResolutionCommand<TAction extends LinksGapResolutionAction>(
  gapsCommand: Command,
  definition: LinksGapResolutionCommandDefinition<TAction>
): void {
  gapsCommand
    .command(`${definition.commandName} <selector>`)
    .description(definition.description)
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links gaps ${definition.commandName} a1b2c3d4e5
  $ exitbook links gaps ${definition.commandName} a1b2c3d4e5 --reason "BullBitcoin purchase sent directly to wallet"
  $ exitbook links gaps ${definition.commandName} a1b2c3d4e5 --json
`
    )
    .option('--reason <text>', 'Optional audit reason stored with the override event')
    .option('--json', 'Output JSON format')
    .action(async (selector: string, rawOptions: unknown) => {
      await executeLinksGapResolutionCommand(definition, selector, rawOptions);
    });
}

async function executeLinksGapResolutionCommand<TAction extends LinksGapResolutionAction>(
  definition: LinksGapResolutionCommandDefinition<TAction>,
  rawSelector: string,
  rawOptions: unknown
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: definition.commandId,
    format,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, LinksGapResolutionCommandOptionsSchema);
        return {
          options,
          selector: yield* parseGapSelectorResult(rawSelector),
        };
      }),
    action: async (context) =>
      executeLinksGapResolutionCommandResult(
        context.runtime,
        definition,
        context.prepared.selector,
        context.prepared.options,
        format
      ),
  });
}

async function executeLinksGapResolutionCommandResult<TAction extends LinksGapResolutionAction>(
  runtime: CommandRuntime,
  definition: LinksGapResolutionCommandDefinition<TAction>,
  selector: string,
  options: LinksGapResolutionCommandOptions,
  format: 'json' | 'text'
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(createCliFailure(profileResult.error, ExitCodes.GENERAL_ERROR));
    }

    const handler = new LinksGapResolutionHandler(
      buildProfileLinkGapSourceReader(database, runtime.dataDir, {
        profileId: profileResult.value.id,
        profileKey: profileResult.value.profileKey,
      }),
      profileResult.value.profileKey,
      new OverrideStore(runtime.dataDir)
    );
    const resolutionResult =
      definition.action === 'resolve'
        ? await handler.resolve({ selector, reason: options.reason })
        : await handler.reopen({ selector, reason: options.reason });
    if (resolutionResult.isErr()) {
      return yield* err(
        createCliFailure(resolutionResult.error, getTransactionSelectorErrorExitCode(resolutionResult.error))
      );
    }

    if (format === 'json') {
      return jsonSuccess(resolutionResult.value);
    }

    return textSuccess(() => {
      printLinksGapResolutionResult(resolutionResult.value);
    });
  });
}

function parseGapSelectorResult(rawSelector: string): Result<string, ReturnType<typeof createCliFailure>> {
  const parseResult = GapSelectorArgumentSchema.safeParse(rawSelector);
  if (!parseResult.success) {
    return err(
      createCliFailure(new Error(parseResult.error.issues[0]?.message ?? 'Invalid gap ref'), ExitCodes.INVALID_ARGS)
    );
  }

  return ok(parseResult.data);
}

function printLinksGapResolutionResult(result: LinksGapResolutionResult): void {
  if (result.action === 'resolve') {
    console.log(formatSuccessLine(result.changed ? 'Link gap resolved' : 'Link gap already resolved'));
  } else {
    console.log(formatSuccessLine(result.changed ? 'Link gap reopened' : 'Link gap already open'));
  }

  console.log(`   Gap: ${result.gapRef} (${result.assetSymbol} / ${result.direction})`);
  console.log(`   Transaction: #${result.transactionId} (${result.platformKey} / ${result.transactionRef})`);
  console.log(`   Asset ID: ${result.assetId}`);
  console.log(`   Fingerprint: ${result.txFingerprint}`);
  if (result.transactionGapCount > 1) {
    console.log(`   Open gap rows on tx: ${result.transactionGapCount}`);
  }
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
}
