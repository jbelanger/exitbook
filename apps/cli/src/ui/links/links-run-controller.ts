/**
 * Links run controller - Manages lifecycle and rendering of operation tree
 */

import { performance } from 'node:perf_hooks';

import { render } from 'ink';
import React from 'react';

import { LinksRunMonitor } from './links-run-components.js';
import { createLinksRunState, type LinksRunState } from './links-run-state.js';

export class LinksRunController {
  private state: LinksRunState;
  private renderInstance: ReturnType<typeof render> | undefined = undefined;
  private startTime = 0;

  constructor(dryRun: boolean) {
    this.state = createLinksRunState(dryRun);
  }

  /**
   * Start the operation tree display
   */
  start(): void {
    this.startTime = performance.now();
    this.renderInstance = render(React.createElement(LinksRunMonitor, { state: this.state }));
  }

  /**
   * Update phase: Load transactions started
   */
  loadStarted(): void {
    this.state.load = {
      status: 'active',
      startedAt: performance.now(),
      totalTransactions: 0,
      sourceCount: 0,
      targetCount: 0,
    };
    this.rerender();
  }

  /**
   * Update phase: Load transactions completed
   */
  loadCompleted(totalTransactions: number, sourceCount: number, targetCount: number): void {
    if (this.state.load) {
      this.state.load.status = 'completed';
      this.state.load.completedAt = performance.now();
      this.state.load.totalTransactions = totalTransactions;
      this.state.load.sourceCount = sourceCount;
      this.state.load.targetCount = targetCount;
    }
    this.rerender();
  }

  /**
   * Update: Existing links cleared
   */
  existingCleared(count: number): void {
    this.state.existingCleared = count;
    this.rerender();
  }

  /**
   * Update phase: Matching started
   */
  matchStarted(): void {
    this.state.match = {
      status: 'active',
      startedAt: performance.now(),
      internalCount: 0,
      confirmedCount: 0,
      suggestedCount: 0,
    };
    this.rerender();
  }

  /**
   * Update phase: Matching completed
   */
  matchCompleted(internalCount: number, confirmedCount: number, suggestedCount: number): void {
    if (this.state.match) {
      this.state.match.status = 'completed';
      this.state.match.completedAt = performance.now();
      this.state.match.internalCount = internalCount;
      this.state.match.confirmedCount = confirmedCount;
      this.state.match.suggestedCount = suggestedCount;
    }
    this.rerender();
  }

  /**
   * Update phase: Save started
   */
  saveStarted(): void {
    this.state.save = {
      status: 'active',
      startedAt: performance.now(),
      totalSaved: 0,
    };
    this.rerender();
  }

  /**
   * Update phase: Save completed
   */
  saveCompleted(totalSaved: number): void {
    if (this.state.save) {
      this.state.save.status = 'completed';
      this.state.save.completedAt = performance.now();
      this.state.save.totalSaved = totalSaved;
    }
    this.rerender();
  }

  /**
   * Mark operation as complete (success)
   */
  complete(): void {
    this.state.isComplete = true;
    this.state.totalDurationMs = performance.now() - this.startTime;
    this.rerender();
  }

  /**
   * Mark operation as aborted
   */
  abort(): void {
    this.state.aborted = true;
    this.state.isComplete = true;
    this.state.totalDurationMs = performance.now() - this.startTime;
    this.rerender();
  }

  /**
   * Mark operation as failed
   */
  fail(errorMessage: string): void {
    this.state.errorMessage = errorMessage;
    this.state.isComplete = true;
    this.state.totalDurationMs = performance.now() - this.startTime;
    this.rerender();
  }

  /**
   * Stop and unmount the display
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      // Final render
      this.rerender();

      // Unmount after brief delay
      setTimeout(() => {
        if (this.renderInstance) {
          this.renderInstance.unmount();
          this.renderInstance = undefined;
        }
        resolve();
      }, 100);
    });
  }

  /**
   * Force a re-render
   */
  private rerender(): void {
    if (this.renderInstance) {
      this.renderInstance.rerender(React.createElement(LinksRunMonitor, { state: this.state }));
    }
  }
}
