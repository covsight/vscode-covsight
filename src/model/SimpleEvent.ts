/**
 * Minimal synchronous event emitter used by model classes to notify listeners.
 */
export class SimpleEvent<T> {
  private handlers: Array<(value: T) => void> = [];

  /**
   * Registers a listener and returns a disposer that removes that same listener.
   */
  subscribe(handler: (value: T) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((current) => current !== handler);
    };
  }

  /**
   * Delivers the event to a snapshot of current listeners.
   *
   * Using a copy means listeners can unsubscribe during dispatch without skipping
   * other handlers in the same emission.
   */
  fire(value: T): void {
    for (const handler of [...this.handlers]) {
      handler(value);
    }
  }
}
