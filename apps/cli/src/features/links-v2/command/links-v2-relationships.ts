import type { LedgerLinkingPersistedRelationship } from '@exitbook/accounting/ledger-linking';
import { buildLedgerLinkingRelationshipReader } from '@exitbook/data/accounting';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';
import type { z } from 'zod';

import {
  cliErr,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCommandResult,
  type CliFailure,
} from '../../../cli/command.js';
import { ExitCodes } from '../../../cli/exit-codes.js';
import { JsonFlagSchema } from '../../../cli/option-schema-primitives.js';
import { detectCliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

const LinksV2RelationshipListCommandOptionsSchema = JsonFlagSchema;
const LinksV2RelationshipViewCommandOptionsSchema = JsonFlagSchema;

type LinksV2RelationshipListCommandOptions = z.infer<typeof LinksV2RelationshipListCommandOptionsSchema>;
type LinksV2RelationshipViewCommandOptions = z.infer<typeof LinksV2RelationshipViewCommandOptionsSchema>;

interface LinksV2RelationshipListOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  relationships: readonly LedgerLinkingPersistedRelationship[];
}

interface LinksV2RelationshipViewOutput {
  profile: {
    id: number;
    profileKey: string;
  };
  relationship: LedgerLinkingPersistedRelationship;
}

export function registerLinksV2RelationshipCommands(linksV2: Command, appRuntime: CliAppRuntime): void {
  linksV2
    .command('list')
    .description('List persisted ledger-native relationships for the active profile')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 list
  $ exitbook links-v2 list --json

Notes:
  - Reads persisted v2 ledger relationships only.
  - Does not read legacy transaction links or suggested proposals.
`
    )
    .action(async (rawOptions: unknown) => {
      await executeLinksV2RelationshipListCommand(rawOptions, appRuntime);
    });

  linksV2
    .command('view')
    .description('Show one persisted ledger-native relationship')
    .argument('<relationship-ref>', 'Relationship database id, stable key, or unique stable key prefix')
    .option('--json', 'Output results in JSON format')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook links-v2 view 42
  $ exitbook links-v2 view ledger-linking:exact_hash_transfer:v1:abc123
  $ exitbook links-v2 view ledger-linking:exact_hash_transfer:v1:abc123 --json

Notes:
  - Numeric refs match the current relationship row id.
  - Text refs match exact stable keys first, then unique stable key prefixes.
`
    )
    .action(async (relationshipRef: string, rawOptions: unknown) => {
      await executeLinksV2RelationshipViewCommand(relationshipRef, rawOptions, appRuntime);
    });
}

async function executeLinksV2RelationshipListCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'links-v2-list',
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2RelationshipListCommandOptionsSchema),
    action: async ({ runtime, prepared }) => executePreparedLinksV2RelationshipListCommand(runtime, prepared),
  });
}

async function executeLinksV2RelationshipViewCommand(
  relationshipRef: string,
  rawOptions: unknown,
  appRuntime: CliAppRuntime
): Promise<void> {
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command: 'links-v2-view',
    format,
    appRuntime,
    prepare: async () => parseCliCommandOptionsResult(rawOptions, LinksV2RelationshipViewCommandOptionsSchema),
    action: async ({ runtime, prepared }) =>
      executePreparedLinksV2RelationshipViewCommand(runtime, relationshipRef, prepared),
  });
}

async function executePreparedLinksV2RelationshipListCommand(
  ctx: CommandRuntime,
  prepared: LinksV2RelationshipListCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const relationships = yield* toCliResult(
      await buildLedgerLinkingRelationshipReader(database).loadLedgerLinkingRelationships(profile.id),
      ExitCodes.GENERAL_ERROR
    );
    const output: LinksV2RelationshipListOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      relationships,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2RelationshipListOutput(output));
  });
}

async function executePreparedLinksV2RelationshipViewCommand(
  ctx: CommandRuntime,
  relationshipRef: string,
  prepared: LinksV2RelationshipViewCommandOptions
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const database = await ctx.openDatabaseSession();
    const profile = yield* toCliResult(await resolveCommandProfile(ctx, database), ExitCodes.GENERAL_ERROR);
    const relationships = yield* toCliResult(
      await buildLedgerLinkingRelationshipReader(database).loadLedgerLinkingRelationships(profile.id),
      ExitCodes.GENERAL_ERROR
    );
    const relationship = yield* resolveLinksV2RelationshipRef(relationshipRef, relationships);
    const output: LinksV2RelationshipViewOutput = {
      profile: {
        id: profile.id,
        profileKey: profile.profileKey,
      },
      relationship,
    };

    if (prepared.json === true) {
      return jsonSuccess(output);
    }

    return textSuccess(() => renderLinksV2RelationshipViewOutput(output));
  });
}

function resolveLinksV2RelationshipRef(
  rawRef: string,
  relationships: readonly LedgerLinkingPersistedRelationship[]
): Result<LedgerLinkingPersistedRelationship, CliFailure> {
  const result = findLinksV2Relationship(rawRef, relationships);

  if (result.isErr()) {
    return cliErr(result.error, ExitCodes.INVALID_ARGS);
  }

  return ok(result.value);
}

function findLinksV2Relationship(
  rawRef: string,
  relationships: readonly LedgerLinkingPersistedRelationship[]
): Result<LedgerLinkingPersistedRelationship, Error> {
  const relationshipRef = rawRef.trim();
  if (relationshipRef === '') {
    return err(new Error('Relationship ref must not be empty'));
  }

  if (/^\d+$/.test(relationshipRef)) {
    const relationshipId = Number(relationshipRef);
    const byId = relationships.find((relationship) => relationship.id === relationshipId);
    if (byId === undefined) {
      return err(new Error(`No links-v2 relationship matched id ${relationshipId}`));
    }

    return ok(byId);
  }

  const exactMatches = relationships.filter((relationship) => relationship.relationshipStableKey === relationshipRef);
  if (exactMatches.length === 1) {
    return ok(exactMatches[0]!);
  }

  if (exactMatches.length > 1) {
    return err(new Error(`Relationship ref "${relationshipRef}" matched multiple stable keys; use a numeric id`));
  }

  const prefixMatches = relationships.filter((relationship) =>
    relationship.relationshipStableKey.startsWith(relationshipRef)
  );
  if (prefixMatches.length === 1) {
    return ok(prefixMatches[0]!);
  }

  if (prefixMatches.length > 1) {
    return err(new Error(`Relationship ref "${relationshipRef}" matched multiple stable keys; use a numeric id`));
  }

  return err(new Error(`No links-v2 relationship matched "${relationshipRef}"`));
}

function renderLinksV2RelationshipListOutput(output: LinksV2RelationshipListOutput): void {
  console.log(`Links v2 relationships for ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Relationships: ${output.relationships.length}`);

  for (const relationship of output.relationships) {
    console.log(
      `  #${relationship.id} ${relationship.relationshipKind} ${relationshipResolutionStatus(relationship)} ${relationship.allocations.length} allocation(s) ${relationship.relationshipStableKey}`
    );
  }
}

function renderLinksV2RelationshipViewOutput(output: LinksV2RelationshipViewOutput): void {
  const { relationship } = output;

  console.log(`Links v2 relationship #${relationship.id}`);
  console.log(`Profile: ${output.profile.profileKey} (#${output.profile.id})`);
  console.log(`Stable key: ${relationship.relationshipStableKey}`);
  console.log(`Kind: ${relationship.relationshipKind}`);
  console.log(`Status: ${relationshipResolutionStatus(relationship)}`);
  console.log('Allocations:');
  for (const allocation of relationship.allocations) {
    renderRelationshipAllocation(allocation);
  }
  console.log(`Created: ${relationship.createdAt}`);
  console.log(`Updated: ${relationship.updatedAt ?? 'never'}`);
}

function renderRelationshipAllocation(allocation: LedgerLinkingPersistedRelationship['allocations'][number]): void {
  console.log(
    `  #${allocation.id} ${allocation.allocationSide} ${allocation.quantity} ${allocation.assetSymbol} (${allocation.assetId})`
  );
  console.log(`    Activity: ${allocation.sourceActivityFingerprint}`);
  console.log(`    Journal: ${allocation.journalFingerprint}`);
  console.log(`    Posting: ${allocation.postingFingerprint ?? 'journal-level'}`);
  console.log(`    Current journal id: ${allocation.currentJournalId ?? 'unresolved'}`);
  console.log(`    Current posting id: ${allocation.currentPostingId ?? 'unresolved'}`);
}

function relationshipResolutionStatus(relationship: LedgerLinkingPersistedRelationship): 'resolved' | 'stale' {
  return relationship.allocations.length > 0 && relationship.allocations.every(allocationIsResolved)
    ? 'resolved'
    : 'stale';
}

function allocationIsResolved(allocation: LedgerLinkingPersistedRelationship['allocations'][number]): boolean {
  return allocation.currentJournalId !== undefined && allocation.currentPostingId !== undefined;
}
