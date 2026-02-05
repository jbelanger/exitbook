/**
 * Dashboard Controller - Manages dashboard lifecycle and updates
 */

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import type { IngestionEvent } from '@exitbook/ingestion';
import { render } from 'ink';
import React from 'react';

import { Dashboard } from './dashboard-components.js';
import { createDashboardState, type DashboardState } from './dashboard-state.js';
import { updateStateFromEvent } from './dashboard-updater.js';

const REFRESH_INTERVAL_MS = 250;

// Timing constants for final render schedule after stop()
const QUICK_RENDER_DELAY_MS = 200;
const FINAL_RENDER_DELAY_MS = 800;
const UNMOUNT_DELAY_MS = 200;

export class DashboardController {
  private state: DashboardState;
  private instrumentation: InstrumentationCollector;
  private eventBus: EventBus<IngestionEvent>;
  private renderInstance: ReturnType<typeof render> | undefined = undefined;
  private refreshTimer: NodeJS.Timeout | undefined = undefined;
  private unsubscribe: (() => void) | undefined = undefined;

  private providerManager: BlockchainProviderManager;

  constructor(
    eventBus: EventBus<IngestionEvent>,
    instrumentation: InstrumentationCollector,
    providerManager: BlockchainProviderManager
  ) {
    this.state = createDashboardState();
    this.instrumentation = instrumentation;
    this.eventBus = eventBus;
    this.providerManager = providerManager;
  }

  /**
   * Start the dashboard
   */
  start(): void {
    // Render initial state
    this.renderInstance = render(
      React.createElement(Dashboard, {
        state: this.state,
      })
    );

    // Subscribe to events
    this.unsubscribe = this.eventBus.subscribe(this.handleEvent);

    // Start refresh loop
    this.startRefreshLoop();
  }

  /**
   * Stop the dashboard with delayed final renders to capture late events
   */
  async stop(): Promise<void> {
    // Stop refresh loop
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    // Unsubscribe from events (but keep rendering for late events)
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    // Schedule final renders to capture late-arriving events
    return new Promise<void>((resolve) => {
      // Quick render to show immediate final state
      setTimeout(() => {
        this.rerender();
      }, QUICK_RENDER_DELAY_MS);

      // Final render to capture late HTTP metrics
      setTimeout(() => {
        this.rerender();
      }, FINAL_RENDER_DELAY_MS);

      // Unmount after final renders
      setTimeout(() => {
        if (this.renderInstance) {
          this.renderInstance.unmount();
          this.renderInstance = undefined;
        }
        resolve();
      }, FINAL_RENDER_DELAY_MS + UNMOUNT_DELAY_MS);
    });
  }

  /**
   * Handle incoming event
   */
  private handleEvent = (event: IngestionEvent): void => {
    updateStateFromEvent(this.state, event, this.instrumentation, this.providerManager);
  };

  /**
   * Start the refresh loop (250ms updates)
   */
  private startRefreshLoop(): void {
    this.refreshTimer = setInterval(() => {
      this.rerender();
    }, REFRESH_INTERVAL_MS);
  }

  /**
   * Force a re-render
   */
  private rerender(): void {
    if (this.renderInstance) {
      this.renderInstance.rerender(
        React.createElement(Dashboard, {
          state: this.state,
        })
      );
    }
  }
}
