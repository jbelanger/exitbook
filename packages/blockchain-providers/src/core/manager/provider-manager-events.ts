/**
 * Event emission helpers for BlockchainProviderManager
 * Centralizes event construction and emission logic
 */

import type { CursorState } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';

import type { ProviderEvent } from '../../events.js';
import type { StreamingOperation } from '../types/operations.js';
import type { IBlockchainProvider } from '../types/provider.js';

// Event reason constants
export const SELECTION_REASON = {
  INITIAL: 'initial',
  PRIORITY: 'priority',
  FAILOVER: 'failover',
} as const;

export const CURSOR_ADJUSTMENT_REASON = {
  REPLAY_WINDOW: 'replay_window',
  FAILOVER: 'failover',
} as const;

/**
 * Provider state transition context
 */
export interface ProviderTransitionContext {
  blockchain: string;
  operation: StreamingOperation;
  currentProvider: IBlockchainProvider;
  previousProvider?: string | undefined;
  currentCursor?: CursorState | undefined;
  adjustedCursor?: CursorState | undefined;
  failureReason?: string | undefined;
}

/**
 * Emit events for provider state transition
 * Handles all event emission logic for a single provider transition
 */
export function emitProviderTransition(
  eventBus: EventBus<ProviderEvent> | undefined,
  context: ProviderTransitionContext
): void {
  if (!eventBus) return;

  const { blockchain, operation, currentProvider, previousProvider, currentCursor, adjustedCursor, failureReason } =
    context;

  const isDifferentProvider = currentCursor?.metadata?.providerName !== currentProvider.name;
  const isFailover = previousProvider !== undefined && previousProvider !== currentProvider.name;
  const isResume = currentCursor !== undefined;
  const cursorAdjusted =
    currentCursor && adjustedCursor && currentCursor.primary.value !== adjustedCursor.primary.value;

  // 1. Emit failover event if switching from failed provider
  if (isFailover) {
    eventBus.emit({
      type: 'provider.failover',
      from: previousProvider,
      to: currentProvider.name,
      blockchain,
      operation: operation.type,
      streamType: operation.type === 'getAddressTransactions' ? operation.streamType : undefined,
      reason: failureReason || 'provider failed',
    });
  }

  // 2. Emit selection event for fresh start or re-selection (not failover)
  if (!isFailover && (!isResume || isDifferentProvider)) {
    const reason = !isResume ? SELECTION_REASON.INITIAL : SELECTION_REASON.PRIORITY;
    eventBus.emit({
      type: 'provider.selection',
      blockchain,
      operation: operation.type,
      providers: [{ name: currentProvider.name, score: 0, reason }],
      selected: currentProvider.name,
    });
  }

  // 3. Emit resume event if resuming from cursor (same provider only)
  if (isResume && !isFailover && !isDifferentProvider) {
    eventBus.emit({
      type: 'provider.resume',
      provider: currentProvider.name,
      blockchain,
      operation: operation.type,
      cursor: currentCursor.primary.value,
      cursorType: currentCursor.primary.type,
      streamType: operation.type === 'getAddressTransactions' ? operation.streamType : undefined,
    });
  }

  // 4. Emit cursor adjustment event (independent of failover)
  if (cursorAdjusted) {
    eventBus.emit({
      type: 'provider.cursor.adjusted',
      provider: currentProvider.name,
      blockchain,
      originalCursor: currentCursor.primary.value,
      adjustedCursor: adjustedCursor.primary.value,
      cursorType: currentCursor.primary.type,
      reason: isFailover ? CURSOR_ADJUSTMENT_REASON.FAILOVER : CURSOR_ADJUSTMENT_REASON.REPLAY_WINDOW,
    });
  }
}
