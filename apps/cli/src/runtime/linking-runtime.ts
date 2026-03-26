import { LinkingOrchestrator, type LinkingEvent } from '@exitbook/accounting';
import type { OverrideEvent } from '@exitbook/core';
import { buildLinkingPorts } from '@exitbook/data/accounting';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { LinksRunMonitor } from '../features/links/view/links-run-components.jsx';
import { createEventDrivenController, type EventDrivenController } from '../ui/shared/index.js';

const logger = getLogger('cli-linking-runtime');

interface CliLinkingRuntime {
  controller?: EventDrivenController<LinkingEvent> | undefined;
  orchestrator: LinkingOrchestrator;
  overrideStore: OverrideStore;
}

interface CreateCliLinkingRuntimeOptions {
  dataDir: string;
  database: DataSession;
  isJsonMode: boolean;
  profileId: number;
  profileKey: string;
}

export function createCliLinkingRuntime(options: CreateCliLinkingRuntimeOptions): Result<CliLinkingRuntime, Error> {
  try {
    const overrideStore = new OverrideStore(options.dataDir);
    const store = buildLinkingPorts(options.database, options.profileId);

    if (options.isJsonMode) {
      return ok({
        orchestrator: new LinkingOrchestrator(store),
        overrideStore,
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
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function readCliLinkOverrides(
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
