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

  constructor(private readonly instrumentation: InstrumentationCollector) {
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
   * Stop the dashboard update loop.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    // Final render before unmounting
    this.renderDashboard();

    // Unmount Ink instance after a brief delay to show final state
    setTimeout(() => {
      if (this.inkInstance) {
        this.inkInstance.unmount();
        this.inkInstance = undefined;
      }
    }, 100);
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
        this.stop();
      }
    } catch (error) {
      this.logger.error({ error, event }, 'Error handling event');
    }
  }

  /**
   * Render the dashboard using Ink.
   */
  private renderDashboard(): void {
    try {
      // Calculate provider metrics
      const metrics = calculateProviderMetrics(this.instrumentation.getMetrics(), this.state.providerThrottles);

      // Create React element
      const element = React.createElement(Dashboard, {
        state: this.state,
        metrics,
        instrumentation: this.instrumentation,
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
      this.stop();
    }
  }
}
