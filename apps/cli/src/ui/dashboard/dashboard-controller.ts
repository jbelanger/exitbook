import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { render } from 'ink';
import React from 'react';

import { calculateProviderMetrics } from '../provider-metrics.js';

import { Dashboard } from './dashboard-components.js';
import type { CliEvent, DashboardState } from './dashboard-state.js';
import { createDashboardState, updateStateFromEvent } from './dashboard-state.js';

const DASHBOARD_UPDATE_INTERVAL_MS = 250;

/**
 * Dashboard controller - orchestrates state updates and rendering.
 * Owns the update loop and delegates to state updaters and Ink renderer.
 */
export class DashboardController {
  private readonly logger = getLogger('DashboardController');
  private readonly state: DashboardState;
  private interval: NodeJS.Timeout | undefined = undefined;
  private inkInstance: ReturnType<typeof render> | undefined = undefined;
  private stopTimeouts: NodeJS.Timeout[] = [];

  constructor(
    private readonly instrumentation: InstrumentationCollector,
    private readonly providerManager: BlockchainProviderManager
  ) {
    this.state = createDashboardState();
  }

  /**
   * Start the dashboard update loop.
   */
  start(): void {
    if (this.interval) {
      this.logger.warn('Dashboard already started');
      return;
    }

    // Initial render with Ink
    this.renderDashboard();

    // Start update loop
    this.interval = setInterval(() => {
      this.renderDashboard();
    }, DASHBOARD_UPDATE_INTERVAL_MS);
  }

  /**
   * Stop the dashboard update loop and return promise that resolves when done.
   *
   * Performs delayed final renders to capture late-arriving HTTP metrics and events.
   * This approach is simpler than tracking pending requests and acceptable for CLI sessions.
   *
   * Render schedule:
   * - Immediate: Capture synchronous events
   * - +200ms: Catch fast HTTP requests
   * - +500ms: Catch most HTTP requests (typical p95 latency)
   * - +800ms: Final render for stragglers, then unmount
   */
  stop(): Promise<void> {
    // Clear any pending stop timeouts from previous stop() calls
    this.stopTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.stopTimeouts = [];

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    // Timing constants for final render schedule
    const QUICK_RENDER_DELAY_MS = 200;
    const TYPICAL_REQUEST_DELAY_MS = 500;
    const FINAL_RENDER_DELAY_MS = 800;
    const UNMOUNT_DELAY_MS = 200;

    return new Promise((resolve) => {
      // Immediate render
      this.renderDashboard();

      // Quick render for fast completions
      const timeout1 = setTimeout(() => {
        this.renderDashboard();
      }, QUICK_RENDER_DELAY_MS);
      this.stopTimeouts.push(timeout1);

      // Typical request latency
      const timeout2 = setTimeout(() => {
        this.renderDashboard();
      }, TYPICAL_REQUEST_DELAY_MS);
      this.stopTimeouts.push(timeout2);

      // Final render and unmount
      const timeout3 = setTimeout(() => {
        this.renderDashboard();

        const timeout4 = setTimeout(() => {
          if (this.inkInstance) {
            this.inkInstance.unmount();
            this.inkInstance = undefined;
          }
          this.stopTimeouts = [];
          resolve();
        }, UNMOUNT_DELAY_MS);
        this.stopTimeouts.push(timeout4);
      }, FINAL_RENDER_DELAY_MS);
      this.stopTimeouts.push(timeout3);
    });
  }

  /**
   * Handle event from event bus.
   */
  handleEvent(event: CliEvent): void {
    try {
      // Update state
      updateStateFromEvent(this.state, event);

      // Stop dashboard on completion
      if (event.type === 'process.completed' || event.type === 'process.failed') {
        this.stop().catch((error) => {
          this.logger.error({ error }, 'Error stopping dashboard');
        });
      }
    } catch (error) {
      this.logger.error({ error, event }, 'Error handling event');
    }
  }

  /**
   * Toggle activity log expansion.
   */
  private toggleActivityExpansion = (): void => {
    this.state.activityExpanded = !this.state.activityExpanded;
  };

  /**
   * Render the dashboard using Ink.
   */
  private renderDashboard(): void {
    try {
      // Get provider health with circuit state
      const providerHealth = this.providerManager.getProviderHealth();

      // Get current metrics
      const currentMetrics = this.instrumentation.getMetrics();

      // Calculate provider metrics
      const metrics = calculateProviderMetrics(currentMetrics, this.state.providerThrottles, providerHealth);

      // Create React element
      const element = React.createElement(Dashboard, {
        state: this.state,
        metrics,
        instrumentation: this.instrumentation,
        onToggleActivity: this.toggleActivityExpansion,
      });

      // Render or rerender
      if (!this.inkInstance) {
        // Initial render
        this.inkInstance = render(element, { stdout: process.stderr });
      } else {
        // Rerender with updated props
        this.inkInstance.rerender(element);
      }
    } catch (error) {
      this.logger.error({ error }, 'Dashboard render failed');
      this.stop().catch((stopError) => {
        this.logger.error({ error: stopError }, 'Error stopping dashboard after render failure');
      });
    }
  }
}
