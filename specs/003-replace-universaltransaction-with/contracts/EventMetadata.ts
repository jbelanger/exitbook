/**
 * Standardized event metadata for all CQRS operations
 */
export interface BaseEventMetadata {
  readonly requestId: string; // Unique request identifier for idempotency/tracing
  readonly transactionId?: string; // Transaction ID when applicable
  readonly timestamp: string; // ISO timestamp when event occurred
  readonly sessionId?: string; // Import session context if applicable
  readonly userId?: string; // User context if applicable (future use)
}

/**
 * Helper to create consistent event metadata
 */
export function createEventMetadata(context: {
  requestId: string;
  transactionId?: string;
  sessionId?: string;
  userId?: string;
}): BaseEventMetadata {
  return {
    ...context,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Diagnostic metadata for MVP scope control
 *
 * Separates diagnostic information from core business data to prevent
 * accidental business logic branching on diagnostic-only fields.
 */
export interface DiagnosticMetadata {
  readonly confidence?: number; // 0-1 classification confidence (diagnostic only)
  readonly ruleVersion?: string; // Classification rule version
  readonly processingTime?: number; // Processing time in ms
  readonly debugInfo?: Record<string, unknown>; // Additional debug context
}
