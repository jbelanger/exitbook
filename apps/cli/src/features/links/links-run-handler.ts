import {
  createTransactionLinkQueries,
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting';
// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import type { KyselyDB } from '@exitbook/data';
import { createTransactionQueries, OverrideStore } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

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
    private readonly controller: EventDrivenController<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    try {
      if (this.controller) {
        await this.controller.start();
      }

      const result = await this.orchestrator.execute(params);

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
 * createTransactionQueries/createTransactionLinkQueries are pure DB wrappers,
 * OverrideStore constructor only sets a file path, and EventBus construction
 * cannot throw. No Result wrapping needed — this is intentional.
 *
 * No cleanup registration needed -- LinkingOrchestrator has no persistent resources.
 */
export function createLinksRunHandler(
  ctx: CommandContext,
  database: KyselyDB,
  options: { dryRun: boolean; isJsonMode: boolean }
): LinksRunHandler {
  const transactionRepository = createTransactionQueries(database);
  const linkRepository = createTransactionLinkQueries(database);
  const overrideStore = new OverrideStore(ctx.dataDir);

  if (options.isJsonMode) {
    const orchestrator = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore);
    return new LinksRunHandler(orchestrator, undefined);
  }

  const eventBus = new EventBus<LinkingEvent>({
    onError: (busErr) => {
      logger.error({ err: busErr }, 'EventBus error');
    },
  });
  const controller = createEventDrivenController(eventBus, LinksRunMonitor, { dryRun: options.dryRun });
  const orchestrator = new LinkingOrchestrator(transactionRepository, linkRepository, overrideStore, eventBus);

  return new LinksRunHandler(orchestrator, controller);
}
