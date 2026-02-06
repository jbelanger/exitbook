/**
 * Dashboard Controller - Manages dashboard lifecycle and updates
 */

import { performance } from 'node:perf_hooks';

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector } from '@exitbook/http';
import type { IngestionEvent } from '@exitbook/ingestion';
import { render } from 'ink';
import React from 'react';

import { IngestionMonitor } from './ingestion-monitor-components.js';
import { createIngestionMonitorState, type IngestionMonitorState } from './ingestion-monitor-state.js';
import { updateStateFromEvent } from './ingestion-monitor-updater.js';

const REFRESH_INTERVAL_MS = 250;

// Timing constants for final render schedule after stop()
const QUICK_RENDER_DELAY_MS = 200;
const FINAL_RENDER_DELAY_MS = 800;
const UNMOUNT_DELAY_MS = 200;

export class IngestionMonitorController {
  private state: IngestionMonitorState;
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
    this.state = createIngestionMonitorState();
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
      React.createElement(IngestionMonitor, {
        state: this.state,
      })
    );

    // Subscribe to events
    this.unsubscribe = this.eventBus.subscribe(this.handleEvent);

    // Start refresh loop
    this.startRefreshLoop();
  }

  /**
   * Mark the operation as aborted (for Ctrl-C or fatal errors)
   */
  abort(): void {
    this.state.aborted = true;
    this.state.isComplete = true;
    this.state.errorMessage = undefined;
    this.state.totalDurationMs = this.state.import?.startedAt
      ? performance.now() - this.state.import.startedAt
      : undefined;
    this.rerender();
  }

  /**
   * Mark the operation as failed (for errors)
   */
  fail(errorMessage: string): void {
    this.state.errorMessage = errorMessage;
    this.state.aborted = false;
    this.state.isComplete = true;
    this.state.totalDurationMs = this.state.import?.startedAt
      ? performance.now() - this.state.import.startedAt
      : undefined;

    // Stop processing spinner if processing was active
    if (this.state.processing && this.state.processing.status === 'active') {
      this.state.processing.status = 'failed';
      this.state.processing.completedAt = performance.now();
    }

    this.rerender();
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
        React.createElement(IngestionMonitor, {
          state: this.state,
        })
      );
    }
  }
}
