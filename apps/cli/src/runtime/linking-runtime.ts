import {
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting/linking';
import type { OverrideEvent } from '@exitbook/core';
import { buildLinkingPorts } from '@exitbook/data/accounting';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CliOutputFormat } from '../cli/options.js';
import { LinksRunMonitor } from '../features/links/view/links-run-components.jsx';
import { createEventDrivenController, type EventDrivenController } from '../ui/shared/index.js';

const logger = getLogger('cli-linking-runtime');

export interface CliLinkingRuntime {
  controller?: EventDrivenController<LinkingEvent> | undefined;
  orchestrator: LinkingOrchestrator;
  overrideStore: OverrideStore;
  profileKey: string;
}

interface CreateCliLinkingRuntimeOptions {
  dataDir: string;
  database: DataSession;
  format: CliOutputFormat;
  profileId: number;
  profileKey: string;
}

interface WithCliLinkingRuntimeOptions extends CreateCliLinkingRuntimeOptions {
  onAbortRegistered?: ((abort: () => void) => void) | undefined;
  onAbortReleased?: (() => void) | undefined;
}

export function createCliLinkingRuntime(options: CreateCliLinkingRuntimeOptions): Result<CliLinkingRuntime, Error> {
  try {
    const overrideStore = new OverrideStore(options.dataDir);
    const store = buildLinkingPorts(options.database, options.profileId);

    if (options.format === 'json') {
      return ok({
        orchestrator: new LinkingOrchestrator(store),
        overrideStore,
        profileKey: options.profileKey,
      });
    }

    const eventBus = new EventBus<LinkingEvent>({
      onError: (error) => {
        logger.error({ error }, 'EventBus error during links run');
      },
    });
    const controller = createEventDrivenController(eventBus, LinksRunMonitor, {});

    return ok({
      controller,
      orchestrator: new LinkingOrchestrator(store, eventBus),
      overrideStore,
      profileKey: options.profileKey,
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function withCliLinkingRuntime<T>(
  options: WithCliLinkingRuntimeOptions,
  operation: (runtime: CliLinkingRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const runtimeResult = createCliLinkingRuntime(options);
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const runtime = runtimeResult.value;
  options.onAbortRegistered?.(() => abortCliLinkingRuntime(runtime));

  try {
    return await operation(runtime);
  } finally {
    options.onAbortReleased?.();
  }
}

async function readCliLinkOverrides(
  overrideStore: OverrideStore,
  profileKey: string
): Promise<Result<OverrideEvent[], Error>> {
  if (!overrideStore.exists()) {
    return ok([]);
  }

  const result = await overrideStore.readByScopes(profileKey, ['link', 'unlink']);
  if (result.isErr()) {
    return err(new Error(`Failed to read override events: ${result.error.message}`));
  }

  return ok(result.value);
}

export async function executeCliLinkingRuntime(
  runtime: CliLinkingRuntime,
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  try {
    const overrides = await readCliLinkOverrides(runtime.overrideStore, runtime.profileKey);
    if (overrides.isErr()) {
      return err(overrides.error);
    }

    if (runtime.controller) {
      await runtime.controller.start();
    }

    const result = await runtime.orchestrator.execute(params, overrides.value);
    if (result.isErr()) {
      if (runtime.controller) {
        runtime.controller.fail(result.error.message);
        await runtime.controller.stop();
      }
      return err(result.error);
    }

    if (runtime.controller) {
      runtime.controller.complete();
      await runtime.controller.stop();
    }

    return ok(result.value);
  } catch (error) {
    if (runtime.controller) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.controller.fail(message);
      await runtime.controller.stop().catch((controllerError) => {
        logger.warn({ controllerError }, 'Failed to stop controller after exception');
      });
    }
    return wrapError(error, 'Failed to run links operation');
  }
}

export function abortCliLinkingRuntime(runtime: CliLinkingRuntime): void {
  if (!runtime.controller) {
    return;
  }

  runtime.controller.abort();
  void runtime.controller.stop().catch((error) => {
    logger.warn({ error }, 'Failed to stop controller on abort');
  });
}
