import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import { SpanContext, trace } from '@opentelemetry/api';

export interface TraceContext {
  parentSpanId?: string;
  spanId: string;
  traceId: string;
}

export interface CorrelationContext {
  correlationId: string;
  traceContext?: TraceContext;
}

@Injectable()
export class CorrelationService {
  private readonly storage = new AsyncLocalStorage<CorrelationContext>();

  /**
   * Gets the current correlation ID from async storage
   */
  getId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  /**
   * Gets the current trace context from async storage
   */
  getTraceContext(): TraceContext | undefined {
    return this.storage.getStore()?.traceContext;
  }

  /**
   * Gets the complete correlation context
   */
  getContext(): CorrelationContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Sets the correlation context for the current async context.
   * Should only be used at the entry point of requests.
   */
  setContext<T>(correlationId: string, function_: () => T): T {
    return this.withContext({ correlationId }, function_);
  }

  /**
   * Sets the correlation context with trace information.
   */
  setContextWithTrace<T>(correlationId: string, traceContext: TraceContext, function_: () => T): T {
    return this.withContext({ correlationId, traceContext }, function_);
  }

  /**
   * Automatically extracts trace context from OpenTelemetry active span
   */
  setContextFromActiveSpan<T>(correlationId: string, function_: () => T): T {
    const activeSpan = trace.getActiveSpan();
    const context: CorrelationContext = { correlationId };

    if (activeSpan) {
      context.traceContext = this.extractTraceContext(activeSpan.spanContext());
    }

    return this.withContext(context, function_);
  }

  /**
   * Helper to wrap a function or promise to run within a correlation context.
   * Preserves the existing call stack and properly handles async operations.
   */
  withId<T>(correlationId: string, function_: () => T): T {
    return this.withContext({ correlationId }, function_);
  }

  /**
   * Helper to wrap a function or promise to run within a full correlation context.
   */
  withContext<T>(context: CorrelationContext, function_: () => T): T {
    const currentContext = this.getContext();

    // If we're already in a context with the same correlation ID, just run the function
    if (currentContext?.correlationId === context.correlationId) {
      return function_();
    }

    // Create new context
    return this.storage.run(context, function_);
  }

  /**
   * Extracts trace context from OpenTelemetry span context
   */
  private extractTraceContext(spanContext: SpanContext): TraceContext {
    return {
      spanId: spanContext.spanId,
      traceId: spanContext.traceId,
      // Note: parentSpanId is not available in SpanContext, would need to be tracked separately
    };
  }
}
