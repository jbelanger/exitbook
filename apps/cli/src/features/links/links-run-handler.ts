import type { LinkingEvent, LinkingRunParams, LinkingRunResult } from '@exitbook/accounting';
import { LinkOperation } from '@exitbook/app';
import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { OverrideStore } from '@exitbook/data';
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
    private readonly operation: LinkOperation,
    private readonly controller: EventDrivenController<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    try {
      if (this.controller) {
        await this.controller.start();
      }

      const result = await this.operation.execute(params);

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
 * No cleanup registration needed -- LinkOperation has no persistent resources.
 */
export function createLinksRunHandler(
  ctx: CommandContext,
  database: DataContext,
  options: { dryRun: boolean; isJsonMode: boolean }
): LinksRunHandler {
  const overrideStore = new OverrideStore(ctx.dataDir);

  if (options.isJsonMode) {
    const operation = new LinkOperation(database, overrideStore);
    return new LinksRunHandler(operation, undefined);
  }

  const eventBus = new EventBus<LinkingEvent>({
    onError: (busErr) => {
      logger.error({ err: busErr }, 'EventBus error');
    },
  });
  const controller = createEventDrivenController(eventBus, LinksRunMonitor, { dryRun: options.dryRun });
  const operation = new LinkOperation(database, overrideStore, eventBus);

  return new LinksRunHandler(operation, controller);
}
