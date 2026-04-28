import { runLedgerLinking, type LedgerLinkingRunResult } from '@exitbook/accounting/ledger-linking';
import { buildLedgerLinkingRunPorts } from '@exitbook/data/accounting';
import { resultDoAsync } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { LedgerLinkingV2RunCommandOptionsSchema } from './ledger-option-schemas.js';

type LedgerLinkingV2RunCommandOptions = z.infer<typeof LedgerLinkingV2RunCommandOptionsSchema>;

interface LedgerLinkingV2RunOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  run: LedgerLinkingRunResult;
}

export function registerLedgerLinkingV2Command(ledgerCommand: Command, appRuntime: CliAppRuntime): void {
  const linkingV2 = ledgerCommand
    .command('linking-v2')
    .description('Run ledger-native relationship linking migration commands')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 run
  $ exitbook ledger linking-v2 run --dry-run
  $ exitbook ledger linking-v2 run --json

Notes:
  - This is the ledger-native v2 path, not legacy transaction link proposal review.
  - Use "ledger linking-v2 run --dry-run" to preview accepted relationships before writing them.
`
    );

  linkingV2
    .command('run')
    .description('Run ledger-linking v2 for the active profile')
    .option('--dry-run', 'Preview accepted relationships without writing them')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook ledger linking-v2 run
  $ exitbook ledger linking-v2 run --dry-run
  $ exitbook ledger linking-v2 run --json

Notes:
  - Non-TUI command.
  - Persists accepted ledger-linking relationships only unless --dry-run is set.
  - Does not create legacy transaction links, proposals, or gap issues.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLedgerLinkingV2RunCommand(rawOptions, appRuntime);
    });
}

async function executeLedgerLinkingV2RunCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'ledger-linking-v2-run',
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LedgerLinkingV2RunCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLedgerLinkingV2RunCommand(runtime, prepared),
  });
}

async function executePreparedLedgerLinkingV2RunCommand(
  ctx: CommandRuntime,
  prepared: LedgerLinkingV2RunCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const run = yield* toCliResult(
      await runLedgerLinking(profile.id, buildLedgerLinkingRunPorts(database), {
        dryRun: prepared.dryRun === true,
      }),
      ExitCodes.GENERAL_ERROR
    );
    const output: LedgerLinkingV2RunOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      run,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLedgerLinkingV2RunOutput(output));
  });
}

function renderLedgerLinkingV2RunOutput(output: LedgerLinkingV2RunOutput): void {
  const { profile, run } = output;

  console.log('Ledger linking v2 completed.');
  console.log(`Mode: ${run.persistence.mode === 'dry_run' ? 'dry run' : 'persisted'}`);
  console.log(`Profile: ${profile.profileKey} (#${profile.id})`);
  console.log(`Posting inputs: ${run.postingInputCount}`);
  console.log(
    `Transfer candidates: ${run.transferCandidateCount} (${run.sourceCandidateCount} source, ${run.targetCandidateCount} target)`
  );
  console.log(
    `Matched candidates: ${run.matchedSourceCandidateCount} source, ${run.matchedTargetCandidateCount} target`
  );
  console.log(
    `Unmatched candidates: ${run.unmatchedSourceCandidateCount} source, ${run.unmatchedTargetCandidateCount} target`
  );
  console.log(`Accepted relationships: ${run.acceptedRelationships.length}`);
  console.log(`Exact-hash matches: ${run.exactHashMatches.length}`);
  console.log(`Exact-hash ambiguities: ${run.exactHashAmbiguities.length}`);
  console.log(`Skipped postings: ${run.skippedCandidates.length}`);

  if (run.persistence.mode === 'dry_run') {
    console.log(`Planned materialization: ${run.persistence.plannedRelationshipCount} relationship(s)`);
    return;
  }

  const materialization = run.persistence.materialization;
  console.log(
    `Materialized: ${materialization.savedCount} saved, ${materialization.previousCount} replaced, ${materialization.resolvedEndpointCount} endpoint refs resolved`
  );
}
