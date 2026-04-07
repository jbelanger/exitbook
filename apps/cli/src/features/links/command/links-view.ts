import { resultDoAsync } from '@exitbook/foundation';
import { err } from '@exitbook/foundation';
import type { Command } from 'commander';

import { cliErr, ExitCodes, runCliCommandBoundary } from '../../../cli/command.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import { explorerListSurfaceSpec, staticDetailSurfaceSpec } from '../../../cli/presentation.js';

import { runLinksBrowseCommand } from './links-browse-command.js';
import { LinksBrowseCommandOptionsSchema } from './links-option-schemas.js';

export function registerLinksViewCommand(linksCommand: Command): void {
  linksCommand
    .command('view [selector]')
    .description('Show static detail for one link proposal or one link gap')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links view resolved-li
  $ exitbook links view txfp123abc --gaps
  $ exitbook links view resolved-li --json
  $ exitbook links view --gaps        # Compatibility alias for links explore --gaps

Notes:
  - Proposal selectors use the persisted resolved-link fingerprint prefix of the representative proposal leg.
  - Gap selectors use the persisted transaction fingerprint prefix together with --gaps.
  - Use "links explore" when you want the interactive explorer.
`
    )
    .option('--status <status>', 'Filter proposals by status (suggested, confirmed, rejected)')
    .option('--gaps', 'Show coverage gaps instead of link proposals')
    .option('--min-confidence <score>', 'Filter proposals by minimum confidence score (0-1)', parseFloat)
    .option('--max-confidence <score>', 'Filter proposals by maximum confidence score (0-1)', parseFloat)
    .option('--verbose', 'Include full transaction details in proposal detail surfaces')
    .option('--json', 'Output JSON format')
    .action(async (selector: string | undefined, rawOptions: unknown) => {
      await executeLinksViewCommand(selector, rawOptions);
    });
}

async function executeLinksViewCommand(selector: string | undefined, rawOptions: unknown): Promise<void> {
  if (selector === undefined) {
    const format = detectCliOutputFormat(rawOptions);
    const optionsResult = parseCliCommandOptionsResult(rawOptions, LinksBrowseCommandOptionsSchema);

    if (optionsResult.isErr()) {
      await runCliCommandBoundary({
        command: 'links-view',
        format,
        action: async () => err(optionsResult.error),
      });
      return;
    }

    if (optionsResult.value.gaps === true) {
      await runLinksBrowseCommand({
        commandId: 'links-view',
        optionOverrides: { gaps: true },
        rawOptions,
        selector: undefined,
        surfaceSpec: explorerListSurfaceSpec('links-view'),
      });
      return;
    }

    await runCliCommandBoundary({
      command: 'links-view',
      format,
      action: async () =>
        resultDoAsync(async function* () {
          return yield* cliErr(
            new Error(
              'Use "links" or "links list" for static lists, "links explore" for the explorer, or "links view <ref>" for static detail.'
            ),
            ExitCodes.INVALID_ARGS
          );
        }),
    });

    return;
  }

  await runLinksBrowseCommand({
    commandId: 'links-view',
    rawOptions,
    selector,
    surfaceSpec: staticDetailSurfaceSpec('links-view'),
  });
}
