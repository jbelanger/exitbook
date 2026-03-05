import {
  LinkingOrchestrator,
  type LinkingEvent,
  type LinkingRunParams,
  type LinkingRunResult,
} from '@exitbook/accounting';
import type { OverrideEvent } from '@exitbook/core';
import type { DataContext, OverrideStore } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from 'neverthrow';

import { LinkingStoreAdapter } from './linking-store-adapter.js';

export type { LinkingRunParams, LinkingRunResult };

/**
 * App-layer operation for transaction linking.
 * Reads overrides from filesystem, constructs the adapter, and delegates to LinkingOrchestrator.
 */
export class LinkOperation {
  constructor(
    private readonly db: DataContext,
    private readonly overrideStore?: OverrideStore | undefined,
    private readonly eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    const store = new LinkingStoreAdapter(this.db);
    const orchestrator = new LinkingOrchestrator(store, this.eventBus);

    // Read overrides from filesystem
    const overridesResult = await this.readLinkOverrides();
    if (overridesResult.isErr()) return err(overridesResult.error);

    return orchestrator.execute(params, overridesResult.value);
  }

  private async readLinkOverrides(): Promise<Result<OverrideEvent[], Error>> {
    if (!this.overrideStore) return ok([]);

    if (!this.overrideStore.exists()) return ok([]);

    const result = await this.overrideStore.readAll();
    if (result.isErr()) {
      return err(new Error(`Failed to read override events: ${result.error.message}`));
    }

    const linkOverrides = result.value.filter((o) => o.scope === 'link' || o.scope === 'unlink');
    return ok(linkOverrides);
  }
}
