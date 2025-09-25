import type { DomainEvent, SourceDetails } from '@crypto/core';

/**
 * Domain Events for Transaction Processing
 */

export interface TransactionProcessedEvent extends DomainEvent {
  readonly importSessionId?: string;
  readonly movementCount: number;
  readonly sessionId?: string;
  readonly source: SourceDetails;
  readonly type: 'TransactionProcessed';
}

export interface TransactionRejectedEvent extends DomainEvent {
  readonly importSessionId?: string;
  readonly reason: string;
  readonly sessionId?: string;
  readonly source: SourceDetails;
  readonly type: 'TransactionRejected';
}
