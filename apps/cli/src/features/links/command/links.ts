import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliRuntimeCommand } from '../../../cli/command.js';
import { detectCliTokenOutputFormat, parseCliBrowseRootInvocationResult } from '../../../cli/options.js';
import { staticListSurfaceSpec } from '../../../cli/presentation.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';

import {
  buildLinksBrowseOptionsHelpText,
  executePreparedLinksBrowseCommand,
  prepareLinksBrowseCommand,
  registerLinksBrowseOptions,
} from './links-browse-command.js';
import { registerLinksExploreCommand } from './links-explore.js';
import { registerLinksListCommand } from './links-list.js';
import { registerLinksViewCommand } from './links-view.js';
import { registerLinksConfirmCommand, registerLinksRejectCommand } from './review/links-review-command.js';
import { registerLinksRunCommand } from './run/links-run.js';

const LINKS_COMMAND_ID = 'links';

/**
 * Register the unified links command with all subcommands.
 *
 * Structure:
 *   links                     - Static list of link proposals
 *   links list                - Explicit static list alias
 *   links view <ref>          - Static detail for one proposal or one gap
 *   links explore             - Interactive review explorer
 *   links run                 - Run the linking algorithm
 *   links confirm <id>        - Confirm a suggested proposal
 *   links reject <id>         - Reject a proposal
 */
export function registerLinksCommand(program: Command, appRuntime: CliAppRuntime): void {
  const links = program
    .command('links')
    .usage('[options]')
    .argument('[tokens...]')
    .allowUnknownOption(true)
    .description('Review transaction link proposals, inspect coverage gaps, and run link reconciliation')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links
  $ exitbook links --status suggested
  $ exitbook links --gaps
  $ exitbook links view resolved-li
  $ exitbook links explore --status suggested
  $ exitbook links explore --gaps
  $ exitbook links run
  $ exitbook links confirm 123

Browse Options:
${buildLinksBrowseOptionsHelpText()}

Notes:
  - Use bare "links" or "links list" for static lists.
  - Use "links view <ref>" for one static proposal or gap detail card.
  - Use "links explore" for the interactive explorer.
  - Use "links run" to refresh suggestions before reviewing them.
`
    )
    .action(async (tokens: string[] | undefined) => {
      const format = detectCliTokenOutputFormat(tokens);

      await runCliRuntimeCommand({
        appRuntime,
        command: LINKS_COMMAND_ID,
        format,
        prepare: async () =>
          resultDoAsync(async function* () {
            const parsedInvocation = yield* parseCliBrowseRootInvocationResult(tokens, registerLinksBrowseOptions);
            const selector = parsedInvocation.selector?.trim();

            if (selector) {
              return yield* cliErr(
                new Error(
                  `Use "links view ${selector}" for static detail or "links explore ${selector}" for the explorer.`
                ),
                ExitCodes.INVALID_ARGS
              );
            }

            return yield* prepareLinksBrowseCommand({
              commandId: LINKS_COMMAND_ID,
              rawOptions: parsedInvocation.rawOptions,
              selector: undefined,
              surfaceSpec: staticListSurfaceSpec(LINKS_COMMAND_ID),
            });
          }),
        action: async (context) => executePreparedLinksBrowseCommand(context.runtime, context.prepared),
      });
    });

  registerLinksListCommand(links);
  registerLinksViewCommand(links);
  registerLinksExploreCommand(links);
  registerLinksRunCommand(links, appRuntime);
  registerLinksConfirmCommand(links);
  registerLinksRejectCommand(links);
}
