import { randomUUID } from 'node:crypto';

import { CloudEvent } from 'cloudevents';

// Unified options interface for all CloudEvent creation
export interface CloudEventOptions {
  readonly causationId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly id?: string | undefined;
  readonly source?: string | undefined;
  readonly subject?: string | undefined;
  readonly time?: Date | undefined;
  readonly userId?: string | undefined;
}

// Full initialization interface
export interface CloudEventInit<T = unknown> extends CloudEventOptions {
  readonly data: T;
  readonly type: string;
}

// Convenient factory function - handles all the CloudEvents complexity
export function toCloudEvent<T>(init: CloudEventInit<T>): CloudEvent<T>;
export function toCloudEvent<T>(type: string, data: T, options?: CloudEventOptions): CloudEvent<T>;
export function toCloudEvent<T>(
  initOrType: CloudEventInit<T> | string,
  data?: T,
  options?: CloudEventOptions,
): CloudEvent<T> {
  // Normalize to single format
  const params: CloudEventInit<T> =
    typeof initOrType === 'string' ? { data: data!, type: initOrType, ...options } : initOrType;

  // Single CloudEvent creation logic
  const ce = new CloudEvent<T>({
    data: params.data,
    datacontenttype: 'application/json',
    id: params.id ?? randomUUID(),
    source: params.source ?? 'urn:svc:app',
    time: (params.time ?? new Date()).toISOString(),
    type: params.type,
    ...(params.subject && { subject: params.subject }),
    ...(params.correlationId && { correlationid: params.correlationId }),
    ...(params.causationId && { causationid: params.causationId }),
    ...(params.userId && { userid: params.userId }),
  });

  return ce;
}

// Domain-specific CloudEvent type
export type DomainCloudEvent<T = unknown> = CloudEvent<T>;

// Extract tracking information from CloudEvent
export function getTracking(event: CloudEvent): {
  causationId?: string | undefined;
  correlationId?: string | undefined;
  userId?: string | undefined;
} {
  return {
    causationId: event['causationid'] as string | undefined,
    correlationId: event['correlationid'] as string | undefined,
    userId: event['userid'] as string | undefined,
  };
}

// Convenience helpers for internal use only
export const CloudEvents = {
  // Simple CloudEvent creation - used by message bus producer
  create: <T>(type: string, data: T, options?: CloudEventOptions) =>
    toCloudEvent(type, data, options),
} as const;
