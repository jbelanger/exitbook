/**
 * Dashboard Controller - Thin lifecycle shell for the ingestion monitor Ink UI.
 *
 * All state management lives inside the React component (useReducer).
 * The controller's only jobs are:
 *   1. Mount / unmount the Ink render tree
 *   2. Relay EventBus events to the component (with buffering for timing safety)
 *   3. Signal abort/fail via the LifecycleBridge callbacks
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import { render } from 'ink';
import React from 'react';

import { EventRelay } from '../shared/index.js';

import { IngestionMonitor } from './ingestion-monitor-components.js';
import type { LifecycleBridge } from './ingestion-monitor-state.js';
import type { CliEvent } from './ingestion-monitor-updater.js';

const UNMOUNT_DELAY_MS = 1000;

export class IngestionMonitorController {
  private renderInstance: ReturnType<typeof render> | undefined;
  private readonly relay = new EventRelay<CliEvent>();
  private readonly lifecycle: LifecycleBridge = {};
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly eventBus: EventBus<CliEvent>,
    private readonly instrumentation: InstrumentationCollector,
    private readonly providerManager: BlockchainProviderManager
  ) {}

  /**
   * Start the dashboard
   */
  start(): void {
    // Subscribe to EventBus BEFORE render to capture events that arrive
    // before React's useLayoutEffect runs (EventBus delivers via queueMicrotask)
    this.unsubscribe = this.eventBus.subscribe((event: CliEvent) => {
      this.relay.push(event);
    });

    this.renderInstance = render(
      React.createElement(IngestionMonitor, {
        relay: this.relay,
        instrumentation: this.instrumentation,
        providerManager: this.providerManager,
        lifecycle: this.lifecycle,
      })
    );
  }

  /**
   * Mark the operation as aborted (for Ctrl-C or fatal errors)
   */
  abort(): void {
    this.lifecycle.onAbort?.();
    this.flushRender();
  }

  /**
   * Mark the operation as failed (for errors)
   */
  fail(errorMessage: string): void {
    this.lifecycle.onFail?.(errorMessage);
    this.flushRender();
  }

  /**
   * Unmount the Ink tree after a delay to let late events render
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = undefined;
        }
        this.renderInstance?.unmount();
        this.renderInstance = undefined;
        resolve();
      }, UNMOUNT_DELAY_MS);
    });
  }

  /**
   * Force a synchronous Ink render to flush pending React state updates.
   * Required for abort/fail paths where process.exit() follows immediately.
   */
  private flushRender(): void {
    if (this.renderInstance) {
      this.renderInstance.rerender(
        React.createElement(IngestionMonitor, {
          relay: this.relay,
          instrumentation: this.instrumentation,
          providerManager: this.providerManager,
          lifecycle: this.lifecycle,
        })
      );
    }
  }
}
