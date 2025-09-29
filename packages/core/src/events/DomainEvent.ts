/**
 * Base Domain Event interface
 *
 * All domain events across the system should extend this interface
 * to ensure consistent structure and enable cross-package event handling.
 */
export interface DomainEvent {
  readonly requestId: string;
  readonly timestamp: string;
  readonly transactionId?: string | undefined;
  readonly type: string;
}
