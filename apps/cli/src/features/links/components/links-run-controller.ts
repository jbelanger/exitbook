/**
 * Thin lifecycle shell for the links run Ink UI.
 *
 * All state management lives inside the React component (useReducer).
 * The controller's only jobs are:
 *   1. Mount / unmount the Ink render tree
 *   2. Relay EventBus events to the component (with buffering for timing safety)
 *   3. Signal abort/fail/complete via LifecycleBridge for synchronous dispatch
 */

import type { EventBus } from '@exitbook/events';
import { render } from 'ink';
import React from 'react';

import { EventRelay } from '../../../ui/shared/index.js';
import type { LinkingEvent } from '../events.js';

import { LinksRunMonitor } from './links-run-components.js';
import type { LifecycleBridge } from './links-run-state.js';

const UNMOUNT_DELAY_MS = 1000;

export class LinksRunController {
  private renderInstance: ReturnType<typeof render> | undefined;
  private readonly relay = new EventRelay<LinkingEvent>();
  private readonly lifecycle: LifecycleBridge = {};
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly eventBus: EventBus<LinkingEvent>,
    private readonly dryRun: boolean
  ) {}

  start(): void {
    // Subscribe to EventBus BEFORE render to capture events that arrive
    // before React's useLayoutEffect runs (EventBus delivers via queueMicrotask)
    this.unsubscribe = this.eventBus.subscribe((event: LinkingEvent) => {
      this.relay.push(event);
    });

    this.renderInstance = render(
      React.createElement(LinksRunMonitor, {
        relay: this.relay,
        lifecycle: this.lifecycle,
        dryRun: this.dryRun,
      })
    );
  }

  /**
   * Mark operation as successfully complete
   */
  complete(): void {
    this.lifecycle.onComplete?.();
  }

  /**
   * Mark operation as aborted (Ctrl-C)
   */
  abort(): void {
    this.lifecycle.onAbort?.();
    this.flushRender();
  }

  /**
   * Mark operation as failed (handler error)
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
        React.createElement(LinksRunMonitor, {
          relay: this.relay,
          lifecycle: this.lifecycle,
          dryRun: this.dryRun,
        })
      );
    }
  }
}
