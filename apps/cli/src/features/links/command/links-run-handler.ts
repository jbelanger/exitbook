import {
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting';
import type { OverrideStore } from '@exitbook/data/overrides';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { CommandScope } from '../../../runtime/command-scope.js';
import { createCliLinkingRuntime, readCliLinkOverrides } from '../../../runtime/linking-runtime.js';
import type { EventDrivenController } from '../../../ui/shared/index.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';
import type { InfrastructureHandler } from '../../shared/handler-contracts.js';

const logger = getLogger('LinksRunHandler');

/**
 * Tier 2 handler for `links run`.
 * Factory owns cleanup; command file never calls ctx.onCleanup().
 */
export class LinksRunHandler implements InfrastructureHandler<LinkingRunParams, LinkingRunResult> {
  constructor(
    private readonly orchestrator: LinkingOrchestrator,
    private readonly overrideStore: OverrideStore,
    private readonly controller: EventDrivenController<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    try {
      const overrides = await readCliLinkOverrides(this.overrideStore);
      if (overrides.isErr()) return err(overrides.error);

      if (this.controller) {
        await this.controller.start();
      }

      const result = await this.orchestrator.execute(params, overrides.value);

      if (result.isErr()) {
        if (this.controller) {
          this.controller.fail(result.error.message);
          await this.controller.stop();
        }
        return err(result.error);
      }

      if (this.controller) {
        this.controller.complete();
        await this.controller.stop();
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to run links operation');
    }
  }

  abort(): void {
    if (this.controller) {
      this.controller.abort();
      void this.controller.stop().catch((e) => {
        logger.warn({ e }, 'Failed to stop controller on abort');
      });
    }
  }
}

/**
 * Create a LinksRunHandler with appropriate infrastructure.
 *
 * No cleanup registration needed -- LinkingOrchestrator has no persistent resources.
 */
export async function createLinksRunHandler(
  ctx: CommandScope,
  options: { isJsonMode: boolean }
): Promise<Result<LinksRunHandler, Error>> {
  try {
    const database = await ctx.database();
    const readyResult = await ensureConsumerInputsReady(ctx, 'links-run', {
      isJsonMode: options.isJsonMode,
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    const runtimeResult = createCliLinkingRuntime({
      dataDir: ctx.dataDir,
      database,
      isJsonMode: options.isJsonMode,
    });
    if (runtimeResult.isErr()) {
      return err(runtimeResult.error);
    }

    const runtime = runtimeResult.value;
    return ok(new LinksRunHandler(runtime.orchestrator, runtime.overrideStore, runtime.controller));
  } catch (error) {
    return wrapError(error, 'Failed to create links run handler');
  }
}
