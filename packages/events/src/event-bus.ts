type EventHandler<TEvent> = (event: TEvent) => void;

export interface EventBusOptions {
  /**
   * Maximum number of events to buffer in the queue before dropping.
   * When limit is reached, oldest events are dropped (FIFO).
   * Default: 1000
   */
  maxQueueSize?: number | undefined;

  /**
   * Error handler for listener failures.
   * Never throws - listener errors are isolated from emitters and other listeners.
   */
  onError: (err: unknown) => void;
}

/**
 * Simple event bus for business events.
 * Decouples UI behavior from business logic.
 *
 * Events are delivered asynchronously via microtask queue to avoid
 * blocking the emitter. Ordering is preserved within the queue.
 *
 * **Guarantees:**
 * - Async delivery: Events are delivered via queueMicrotask, never blocking emitters
 * - Error isolation: Listener exceptions don't affect emitters or other listeners
 * - FIFO ordering: Events are delivered in emission order
 * - Bounded queue: Queue has a maximum size to prevent memory leaks
 */
export class EventBus<TEvent> {
  private handlers: EventHandler<TEvent>[] = [];
  private queue: TEvent[] = [];
  private flushing = false;
  private readonly maxQueueSize: number;
  private readonly onError: (err: unknown) => void;

  constructor(options: EventBusOptions) {
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.onError = options.onError;
  }

  subscribe(handler: EventHandler<TEvent>): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event. Delivery is asynchronous but ordered.
   *
   * If queue is full, oldest events are dropped (FIFO).
   * This prevents unbounded memory growth if events arrive faster than they're processed.
   */
  emit(event: TEvent): void {
    this.queue.push(event);

    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch (err) {
            // Never let event handler failures crash the system
            this.onError(err);
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }
}
