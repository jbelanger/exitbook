import {
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting';
import { err, ok, type OverrideEvent, type Result } from '@exitbook/core';
import { buildLinkingPorts, type DataContext, OverrideStore } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';

import { LinksRunMonitor } from './components/links-run-components.js';

const logger = getLogger('LinksRunHandler');

/**
 * Tier 2 handler for `links run`.
 * Factory owns cleanup; command file never calls ctx.onCleanup().
 */
export class LinksRunHandler {
  constructor(
    private readonly orchestrator: LinkingOrchestrator,
    private readonly overrideStore: OverrideStore,
    private readonly controller: EventDrivenController<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    try {
      const overrides = await readLinkOverrides(this.overrideStore);
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
      return err(error instanceof Error ? error : new Error(String(error)));
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
 * Returns a bare value (not Result) because creation is infallible:
 * OverrideStore constructor only sets a file path, and EventBus
 * construction cannot throw. No Result wrapping needed.
 *
 * No cleanup registration needed -- LinkingOrchestrator has no persistent resources.
 */
export function createLinksRunHandler(
  ctx: CommandContext,
  database: DataContext,
  options: { isJsonMode: boolean }
): LinksRunHandler {
  const overrideStore = new OverrideStore(ctx.dataDir);
  const store = buildLinkingPorts(database);

  if (options.isJsonMode) {
    const orchestrator = new LinkingOrchestrator(store);
    return new LinksRunHandler(orchestrator, overrideStore, undefined);
  }

  const eventBus = new EventBus<LinkingEvent>({
    onError: (busErr) => {
      logger.error({ err: busErr }, 'EventBus error');
    },
  });
  const controller = createEventDrivenController(eventBus, LinksRunMonitor, {});
  const orchestrator = new LinkingOrchestrator(store, eventBus);

  return new LinksRunHandler(orchestrator, overrideStore, controller);
}

/**
 * Read link/unlink override events from the override store.
 */
async function readLinkOverrides(overrideStore: OverrideStore): Promise<Result<OverrideEvent[], Error>> {
  if (!overrideStore.exists()) return ok([]);

  const result = await overrideStore.readByScopes(['link', 'unlink']);
  if (result.isErr()) return err(new Error(`Failed to read override events: ${result.error.message}`));

  return ok(result.value);
}
