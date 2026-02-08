/**
 * Generic lifecycle controller for Ink TUI monitors.
 *
 * Encodes the EventRelay + LifecycleBridge + flushRender timing contract once.
 * Each call site provides the EventBus, the React component, and any extra props.
 *
 * The controller's only jobs are:
 *   1. Mount / unmount the Ink render tree
 *   2. Relay EventBus events to the component (with buffering for timing safety)
 *   3. Signal abort/fail/complete via LifecycleBridge for synchronous dispatch
 */

import type { EventBus } from '@exitbook/events';
import { render } from 'ink';
import React from 'react';

import { EventRelay } from './event-relay.js';

const UNMOUNT_DELAY_MS = 1000;

/**
 * Callback bridge for lifecycle signals from controller to React component.
 *
 * Allows controller to trigger synchronous state transitions before process.exit().
 * When the user presses Ctrl-C (SIGINT), the controller calls lifecycle.onAbort?.()
 * synchronously, then flushRender() forces Ink to paint the abort state before
 * process.exit(130) terminates the process.
 */
export interface LifecycleBridge {
  onAbort?: (() => void) | undefined;
  onComplete?: (() => void) | undefined;
  onFail?: ((errorMessage: string) => void) | undefined;
}

/** Props injected by the controller — not supplied by callers. */
interface InternalProps<TEvent> {
  relay: EventRelay<TEvent>;
  lifecycle: LifecycleBridge;
}

export class EventDrivenController<TEvent> {
  private renderInstance: ReturnType<typeof render> | undefined;
  private readonly relay = new EventRelay<TEvent>();
  private readonly lifecycle: LifecycleBridge = {};
  private unsubscribe: (() => void) | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type safety enforced at construction via createEventDrivenController
  private readonly component: React.ComponentType<any>;
  private readonly extraProps: Record<string, unknown>;

  /** @internal Use createEventDrivenController() for type-safe construction. */
  constructor(
    private readonly eventBus: EventBus<TEvent>,
    component: React.ComponentType<InternalProps<TEvent>>,
    extraProps: Record<string, unknown>
  ) {
    this.component = component;
    this.extraProps = extraProps;
  }

  start(): void {
    // Subscribe to EventBus BEFORE render to capture events that arrive
    // before React's useLayoutEffect runs (EventBus delivers via queueMicrotask)
    this.unsubscribe = this.eventBus.subscribe((event: TEvent) => {
      this.relay.push(event);
    });

    this.renderInstance = render(
      React.createElement(this.component, {
        ...this.extraProps,
        relay: this.relay,
        lifecycle: this.lifecycle,
      })
    );
  }

  complete(): void {
    this.lifecycle.onComplete?.();
  }

  abort(): void {
    this.lifecycle.onAbort?.();
    this.flushRender();
  }

  fail(errorMessage: string): void {
    this.lifecycle.onFail?.(errorMessage);
    this.flushRender();
  }

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
        React.createElement(this.component, {
          ...this.extraProps,
          relay: this.relay,
          lifecycle: this.lifecycle,
        })
      );
    }
  }
}

/**
 * Type-safe factory for EventDrivenController.
 *
 * Infers the component's props type and requires callers to supply all props
 * except relay/lifecycle (which the controller injects). Compile-time error
 * if required component props are missing or mistyped.
 */
export function createEventDrivenController<TEvent, TProps extends InternalProps<TEvent>>(
  eventBus: EventBus<TEvent>,
  component: React.ComponentType<TProps>,
  ...[extraProps]: keyof Omit<TProps, keyof InternalProps<TEvent>> extends never
    ? [extraProps?: Record<never, never>]
    : [extraProps: Omit<TProps, keyof InternalProps<TEvent>>]
): EventDrivenController<TEvent> {
  return new EventDrivenController(
    eventBus,
    component as React.ComponentType<InternalProps<TEvent>>,
    (extraProps ?? {}) as Record<string, unknown>
  );
}
