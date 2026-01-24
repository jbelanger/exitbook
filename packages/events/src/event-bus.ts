type EventHandler<TEvent> = (event: TEvent) => void;

/**
 * Simple event bus for business events.
 * Decouples UI behavior from business logic.
 *
 * Events are delivered asynchronously via microtask queue to avoid
 * blocking the emitter. Ordering is preserved within the queue.
 */
export class EventBus<TEvent> {
  private handlers: EventHandler<TEvent>[] = [];
  private queue: TEvent[] = [];
  private flushing = false;

  constructor(private onError: (err: unknown) => void) {}

  /**
   * Subscribe to events. Returns an unsubscribe function.
   */
  subscribe(handler: EventHandler<TEvent>): () => void {
    this.handlers.push(handler);
    return () => {
      const index = this.handlers.indexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  /**
   * Emit an event. Delivery is asynchronous but ordered.
   */
  emit(event: TEvent): void {
    this.queue.push(event);
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
