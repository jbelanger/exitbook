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
    .description('Review unresolved link coverage gaps and resolve issue-level exceptions')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links gaps
  $ exitbook links gaps view a1b2c3d4e5
  $ exitbook links gaps explore
  $ exitbook links gaps resolve a1b2c3d4e5 --reason "BullBitcoin purchase sent directly to wallet"
  $ exitbook links gaps reopen a1b2c3d4e5

Notes:
  - Gap selectors use the GAP-REF shown in the gap list.
  - "resolve" hides that specific gap from the open gaps lens without creating a link.
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
  $ exitbook links gaps view a1b2c3d4e5
  $ exitbook links gaps view a1b2c3d4e5 --json
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
  $ exitbook links gaps explore a1b2c3d4e5

Common Usage:
  - Diagnose unresolved blockchain coverage gaps
  - Jump directly to one gap by GAP-REF
  - Review a gap before resolving it as an intentional no-link gap
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
