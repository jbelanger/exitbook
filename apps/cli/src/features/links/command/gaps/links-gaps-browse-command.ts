import type { Result } from '@exitbook/foundation';
import type { Command } from 'commander';

import { runCliRuntimeCommand, type CliCommandResult, type CliFailure } from '../../../../cli/command.js';
import { detectCliOutputFormat } from '../../../../cli/options.js';
import type { BrowseSurfaceSpec } from '../../../../cli/presentation.js';
import type { CommandRuntime } from '../../../../runtime/command-runtime.js';
import {
  executePreparedLinksBrowseCommand,
  prepareLinksBrowseCommand,
  type PreparedLinksBrowseCommand,
} from '../links-browse-command.js';

interface ExecuteLinksGapsBrowseCommandInput {
  commandId: string;
  rawOptions: unknown;
  selector?: string | undefined;
  surfaceSpec: BrowseSurfaceSpec;
}

export function registerLinksGapsBrowseOptions(command: Command): Command {
  return command.option('--json', 'Output JSON format');
}

export function prepareLinksGapsBrowseCommand(
  input: ExecuteLinksGapsBrowseCommandInput
): Result<PreparedLinksBrowseCommand, CliFailure> {
  return prepareLinksBrowseCommand({
    ...input,
    rawOptions: buildLinksGapsRawOptions(input.rawOptions),
  });
}

export async function executePreparedLinksGapsBrowseCommand(
  runtime: CommandRuntime,
  prepared: PreparedLinksBrowseCommand
): Promise<CliCommandResult> {
  return executePreparedLinksBrowseCommand(runtime, prepared);
}

export async function runLinksGapsBrowseCommand(input: ExecuteLinksGapsBrowseCommandInput): Promise<void> {
  await runCliRuntimeCommand({
    command: input.commandId,
    format: detectCliOutputFormat(input.rawOptions),
    prepare: async () => prepareLinksGapsBrowseCommand(input),
    action: async (context) => executePreparedLinksGapsBrowseCommand(context.runtime, context.prepared),
  });
}

function buildLinksGapsRawOptions(rawOptions: unknown): Record<string, unknown> {
  const baseOptions =
    typeof rawOptions === 'object' && rawOptions !== null ? { ...(rawOptions as Record<string, unknown>) } : {};

  return {
    ...baseOptions,
    gaps: true,
  };
}
