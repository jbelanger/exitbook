import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../../cli/options.js';
import {
  explorerDetailSurfaceSpec,
  explorerListSurfaceSpec,
  staticDetailSurfaceSpec,
  staticListSurfaceSpec,
} from '../../../../cli/presentation.js';

import { registerLinksGapReopenCommand, registerLinksGapResolveCommand } from './links-gap-resolution-command.js';
import {
  executePreparedLinksGapsBrowseCommand,
  prepareLinksGapsBrowseCommand,
  registerLinksGapsBrowseOptions,
  runLinksGapsBrowseCommand,
} from './links-gaps-browse-command.js';

export function registerLinksGapsCommand(linksCommand: Command): void {
  const gaps = linksCommand
    .command('gaps')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Review unresolved link coverage gaps and resolve transaction-level exceptions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links gaps
  $ exitbook links gaps view 3ab863db2a
  $ exitbook links gaps explore
  $ exitbook links gaps resolve 3ab863db2a --reason "BullBitcoin purchase sent directly to wallet"
  $ exitbook links gaps reopen 3ab863db2a

Notes:
  - Gap refs use the persisted transaction fingerprint prefix shown in the gap list.
  - "resolve" hides that transaction from the open gaps lens without creating a link.
  - Use legacy "--gaps" flags only when scripting older command surfaces.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);

      await runCliRuntimeCommand({
        command: 'links-gaps',
        format,
        prepare: async () =>
          resultDoAsync(async function* () {
            const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerLinksGapsBrowseOptions);
            const selector = parsedInvocation.selector?.trim();

            if (selector) {
              return yield* cliErr(
                new Error(
                  `Use "links gaps view ${selector}" for static detail or "links gaps explore ${selector}" for the explorer.`
                ),
                ExitCodes.INVALID_ARGS
              );
            }

            return yield* prepareLinksGapsBrowseCommand({
              commandId: 'links-gaps',
              rawOptions: parsedInvocation.rawOptions,
              selector: undefined,
              surfaceSpec: staticListSurfaceSpec('links-gaps'),
            });
          }),
        action: async (context) => executePreparedLinksGapsBrowseCommand(context.runtime, context.prepared),
      });
    });

  registerLinksGapsBrowseOptions(
    gaps
      .command('view <selector>')
      .description('Show static detail for one link gap')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links gaps view 3ab863db2a
  $ exitbook links gaps view 3ab863db2a --json
`
      )
  ).action(async (selector: string, rawOptions: unknown) => {
    await runLinksGapsBrowseCommand({
      commandId: 'links-gaps-view',
      rawOptions,
      selector,
      surfaceSpec: staticDetailSurfaceSpec('links-gaps-view'),
    });
  });

  registerLinksGapsBrowseOptions(
    gaps
      .command('explore [selector]')
      .description('Open the gaps explorer')
      .addHelpText(
        'after',
        `
Examples:
  $ exitbook links gaps explore
  $ exitbook links gaps explore 3ab863db2a

Common Usage:
  - Diagnose unresolved blockchain coverage gaps
  - Jump directly to one gap transaction by fingerprint ref
  - Review a gap before resolving it as an intentional no-link transaction
`
      )
  ).action(async (selector: string | undefined, rawOptions: unknown) => {
    await runLinksGapsBrowseCommand({
      commandId: 'links-gaps-explore',
      rawOptions,
      selector,
      surfaceSpec: selector
        ? explorerDetailSurfaceSpec('links-gaps-explore')
        : explorerListSurfaceSpec('links-gaps-explore'),
    });
  });

  registerLinksGapResolveCommand(gaps);
  registerLinksGapReopenCommand(gaps);
}
