import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import { z } from 'zod';

import { ExitCodes, jsonSuccess, runCliRuntimeCommand, textSuccess, toCliResult } from '../../../cli/command.js';
import { parseCliCommandOptionsResult, detectCliOutputFormat } from '../../../cli/options.js';
import { buildCostBasisInputFromFlags } from '../../cost-basis/command/cost-basis-utils.js';
import { validateAccountingMethodJurisdictionOptions } from '../../shared/option-schema-primitives.js';
import { outputIssuesStaticScopedList, type IssuesStaticScopedListState } from '../view/issues-static-renderer.js';

import { loadScopedCostBasisIssuesData, type IssuesScopedCostBasisData } from './issues-data.js';

const IssuesCostBasisCommandOptionsSchema = z
  .object({
    method: z.string().optional(),
    jurisdiction: z.string().optional(),
    taxYear: z.string().optional(),
    fiatCurrency: z.string().optional(),
    json: z.boolean().optional(),
  })
  .superRefine(validateAccountingMethodJurisdictionOptions);

type IssuesCostBasisCommandOptions = z.infer<typeof IssuesCostBasisCommandOptionsSchema>;

export function registerIssuesCostBasisCommand(issuesCommand: Command): void {
  issuesCommand
    .command('cost-basis')
    .description('Show tax-readiness issues for one filing scope')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA or US')
    .option('--tax-year <year>', 'Tax year for calculation (for example, 2024)')
    .option('--fiat-currency <currency>', 'Fiat currency override when supported')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook issues cost-basis --jurisdiction CA --tax-year 2024 --method average-cost
  $ exitbook issues cost-basis --jurisdiction US --tax-year 2024 --method fifo --json
`
    )
    .action(async (rawOptions: unknown) => {
      await runCliRuntimeCommand({
        command: 'issues-cost-basis',
        format: detectCliOutputFormat(rawOptions),
        prepare: async () =>
          resultDoAsync(async function* () {
            const options = yield* parseCliCommandOptionsResult(rawOptions, IssuesCostBasisCommandOptionsSchema);
            const params = yield* toCliResult(buildScopedCostBasisParams(options), ExitCodes.INVALID_ARGS);

            return {
              options,
              params,
            };
          }),
        action: async ({ runtime, prepared }) =>
          resultDoAsync(async function* () {
            const data = yield* await loadScopedCostBasisIssuesData(
              runtime,
              prepared.options.json ? 'json' : 'text',
              prepared.params
            );

            if (prepared.options.json) {
              return jsonSuccess({
                scope: data.scope,
                currentIssues: data.issueRecords.map((record) => record.issue),
              });
            }

            return textSuccess(() => {
              outputIssuesStaticScopedList(toIssuesStaticScopedListState(data));
            });
          }),
      });
    });
}

function buildScopedCostBasisParams(
  options: IssuesCostBasisCommandOptions
): ReturnType<typeof buildCostBasisInputFromFlags> {
  return buildCostBasisInputFromFlags(options);
}

function toIssuesStaticScopedListState(data: IssuesScopedCostBasisData): IssuesStaticScopedListState {
  return {
    activeProfileKey: data.activeProfileKey,
    activeProfileSource: data.activeProfileSource,
    currentIssues: data.issueRecords.map((record) => record.issue),
    profileDisplayName: data.profileDisplayName,
    scope: data.scope,
  };
}
