import {
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting';
import type { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { createCliLinkingRuntime, readCliLinkOverrides } from '../../../runtime/linking-runtime.js';
import type { EventDrivenController } from '../../../ui/shared/index.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';

const logger = getLogger('LinksRunRunner');

export interface LinksRunRuntime {
  orchestrator: LinkingOrchestrator;
  overrideStore: OverrideStore;
  controller?: EventDrivenController<LinkingEvent> | undefined;
}

export async function executeLinksRunWithRuntime(
  runtime: LinksRunRuntime,
  profileKey: string,
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  try {
    const overrides = await readCliLinkOverrides(runtime.overrideStore, profileKey);
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
    return wrapError(error, 'Failed to run links operation');
  }
}

function abortLinksRunRuntime(runtime: LinksRunRuntime): void {
  if (runtime.controller) {
    runtime.controller.abort();
    void runtime.controller.stop().catch((error) => {
      logger.warn({ error }, 'Failed to stop controller on abort');
    });
  }
}

export async function runLinks(
  ctx: CommandRuntime,
  options: { isJsonMode: boolean; profileId: number; profileKey: string },
  params: LinkingRunParams
): Promise<Result<LinkingRunResult, Error>> {
  try {
    const database = await ctx.database();
    const readyResult = await ensureConsumerInputsReady(ctx, 'links-run', {
      isJsonMode: options.isJsonMode,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    const runtimeResult = createCliLinkingRuntime({
      dataDir: ctx.dataDir,
      database,
      isJsonMode: options.isJsonMode,
      profileId: options.profileId,
      profileKey: options.profileKey,
    });
    if (runtimeResult.isErr()) {
      return err(runtimeResult.error);
    }

    const runtime = runtimeResult.value;
    const linksRuntime: LinksRunRuntime = {
      orchestrator: runtime.orchestrator,
      overrideStore: runtime.overrideStore,
      controller: runtime.controller,
    };
    ctx.onAbort(() => abortLinksRunRuntime(linksRuntime));
    return executeLinksRunWithRuntime(linksRuntime, options.profileKey, params);
  } catch (error) {
    return wrapError(error, 'Failed to run links operation');
  }
}
