import { AsyncLocalStorage } from 'node:async_hooks';

// Create async storage for correlation ID
const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Gets the current correlation ID from async storage
 */
export function getCurrentCorrelationId(): string | undefined {
    return correlationStorage.getStore();
}

/**
 * Helper to wrap a function or promise to run within a correlation context.
 * Preserves the existing call stack and properly handles async operations.
 */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
    // If we're already in a context with this correlation ID, just run the function
    if (getCurrentCorrelationId() === correlationId) {
        return fn();
    }

    // Create new context with the correlation ID
    return correlationStorage.run(correlationId, fn);
}

/**
 * Sets the correlation ID for the current async context.
 * Should only be used at the entry point of requests.
 */
export function setCorrelationContext<T>(correlationId: string, fn: () => T): T {
    return withCorrelationId(correlationId, fn);
}