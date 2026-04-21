import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { CliAppRuntime } from '../runtime/app-runtime.js';
import type { CommandRuntime } from '../runtime/command-runtime.js';

import {
  runCliCommandBoundary,
  runCliRuntimeCommand,
  type CliCommandResult,
  type CliCompletion,
  type CliFailure,
} from './command.js';
import { detectCliOutputFormat } from './options.js';
import {
  collapseEmptyExplorerToStatic,
  type ExplorerNavigability,
  type ResolvedBrowsePresentation,
} from './presentation.js';

type AwaitableResult<TValue, TError> = Promise<Result<TValue, TError>> | Result<TValue, TError>;

export interface PreparedBrowseCommand<TParams> {
  params: TParams;
  presentation: ResolvedBrowsePresentation;
}

export interface BrowseCommandExecutionContext<TParams, TBrowsePresentation> {
  browsePresentation: TBrowsePresentation;
  finalPresentation: ResolvedBrowsePresentation;
  params: TParams;
}

interface BrowseExecutionOptions<TParams, TBrowsePresentation, TError> {
  buildCompletion(
    context: BrowseCommandExecutionContext<TParams, TBrowsePresentation>
  ): AwaitableResult<CliCompletion, TError>;
  loadBrowsePresentation(params: TParams): AwaitableResult<TBrowsePresentation, TError>;
  prepared: PreparedBrowseCommand<TParams>;
  resolveNavigability(params: TParams, browsePresentation: TBrowsePresentation): ExplorerNavigability;
}

interface RunPreparedBrowseCommandBoundaryOptions<TPrepared> {
  action(prepared: TPrepared): Promise<CliCommandResult>;
  command: string;
  rawOptions: unknown;
  prepare(): AwaitableResult<TPrepared, CliFailure>;
}

interface RunPreparedBrowseRuntimeCommandOptions<TPrepared> {
  action(context: { prepared: TPrepared; runtime: CommandRuntime }): Promise<CliCommandResult>;
  appRuntime?: CliAppRuntime | undefined;
  command: string;
  rawOptions: unknown;
  prepare(): AwaitableResult<TPrepared, CliFailure>;
}

export function prepareBrowseCommand<TParams>(
  params: TParams,
  presentation: ResolvedBrowsePresentation
): PreparedBrowseCommand<TParams> {
  return {
    params,
    presentation,
  };
}

export async function executePreparedBrowseCommand<TParams, TBrowsePresentation, TError>(
  options: BrowseExecutionOptions<TParams, TBrowsePresentation, TError>
): Promise<Result<CliCompletion, TError>> {
  return resultDoAsync(async function* () {
    const browsePresentation = yield* await options.loadBrowsePresentation(options.prepared.params);
    const finalPresentation = collapseEmptyExplorerToStatic(
      options.prepared.presentation,
      options.resolveNavigability(options.prepared.params, browsePresentation)
    );

    return yield* await options.buildCompletion({
      browsePresentation,
      finalPresentation,
      params: options.prepared.params,
    });
  });
}

export async function runPreparedBrowseCommandBoundary<TPrepared>(
  options: RunPreparedBrowseCommandBoundaryOptions<TPrepared>
): Promise<void> {
  await runCliCommandBoundary({
    command: options.command,
    format: detectCliOutputFormat(options.rawOptions),
    action: async () =>
      resultDoAsync(async function* () {
        const prepared = yield* await options.prepare();
        return yield* await options.action(prepared);
      }),
  });
}

export async function runPreparedBrowseRuntimeCommand<TPrepared>(
  options: RunPreparedBrowseRuntimeCommandOptions<TPrepared>
): Promise<void> {
  await runCliRuntimeCommand({
    appRuntime: options.appRuntime,
    command: options.command,
    format: detectCliOutputFormat(options.rawOptions),
    prepare: async () => await options.prepare(),
    action: async (context) => options.action({ runtime: context.runtime, prepared: context.prepared }),
  });
}
