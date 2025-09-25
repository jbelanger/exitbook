import type { ClassifiedTransaction, DomainEvent } from '@crypto/core';

/**
 * Domain Events for Movement Classification
 */

export interface MovementsClassifiedEvent extends DomainEvent {
  readonly classificationResults: {
    readonly diagnostics: {
      readonly confidence: number; // DIAGNOSTIC ONLY - no business logic branching in MVP
    };
    readonly movementId: string;
    readonly purpose: 'PRINCIPAL' | 'FEE' | 'GAS';
    readonly ruleId: string;
  }[];
  readonly rulesetVersion: string;
  readonly type: 'MovementsClassified';
}

export interface ClassificationFailedEvent extends DomainEvent {
  readonly failedMovements: string[];
  readonly reason: string;
  readonly type: 'ClassificationFailed';
}
