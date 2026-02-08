/**
 * Buffers events until a handler connects, then replays and forwards.
 *
 * Solves the timing gap between the controller's synchronous EventBus
 * subscription and the React component's useLayoutEffect subscription.
 * The EventBus delivers via queueMicrotask, so events emitted before
 * React commits the initial render would otherwise be lost.
 */
export class EventRelay<T> {
  private buffer: T[] = [];
  private handler: ((event: T) => void) | undefined;

  /** Forward an event to the connected handler, or buffer it. */
  push(event: T): void {
    if (this.handler) {
      this.handler(event);
    } else {
      this.buffer.push(event);
    }
  }

  /** Connect a handler. Replays any buffered events, then forwards new ones. */
  connect(handler: (event: T) => void): () => void {
    this.handler = handler;
    for (const event of this.buffer) {
      handler(event);
    }
    this.buffer.length = 0;
    return () => {
      this.handler = undefined;
    };
  }
}
