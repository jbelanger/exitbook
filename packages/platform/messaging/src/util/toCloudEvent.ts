import { randomUUID } from 'node:crypto';

import { CloudEvent } from 'cloudevents';

// Our tracking extensions (standardized)
export interface TrackingExtensions {
  causationid?: string | undefined;
  correlationid?: string | undefined;
  userid?: string | undefined;
}

// Strongly typed CloudEvent for our domain
export type DomainCloudEvent<T = unknown> = CloudEvent<T> & {
  getExtensions(): TrackingExtensions;
};

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
export function toCloudEvent<T>(init: CloudEventInit<T>): DomainCloudEvent<T>;
export function toCloudEvent<T>(
  type: string,
  data: T,
  options?: CloudEventOptions,
): DomainCloudEvent<T>;
export function toCloudEvent<T>(
  initOrType: CloudEventInit<T> | string,
  data?: T,
  options?: CloudEventOptions,
): DomainCloudEvent<T> {
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

  return ce as DomainCloudEvent<T>;
}

// Helper to extract tracking info from any CloudEvent
export function getTracking(ce: CloudEvent): TrackingExtensions {
  const ceObj = ce as unknown as {
    causationid?: string;
    correlationid?: string;
    userid?: string;
  };

  return {
    causationid: ceObj.causationid,
    correlationid: ceObj.correlationid,
    userid: ceObj.userid,
  };
}

// Convenience helpers for common patterns
export const CloudEvents = {
  // Chain events: CloudEvents.causedBy('user.updated', userData, triggeringEvent)
  causedBy: <T>(type: string, data: T, triggeringEvent: CloudEvent) => {
    const tracking = getTracking(triggeringEvent);
    return toCloudEvent(type, data, {
      causationId: triggeringEvent.id,
      correlationId: tracking.correlationid,
      userId: tracking.userid,
    });
  },

  // With correlation: CloudEvents.correlate('user.created', userData, existingCorrelationId)
  correlate: <T>(type: string, data: T, correlationId: string) =>
    toCloudEvent(type, data, { correlationId }),

  // Ultra-simple: CloudEvents.create('user.created', userData)
  create: <T>(type: string, data: T, options?: CloudEventOptions) =>
    toCloudEvent(type, data, options),

  // From existing event: CloudEvents.from(existingEvent).create('derived.event', newData)
  from: (sourceEvent: CloudEvent) => {
    const tracking = getTracking(sourceEvent);
    return {
      create: <T>(type: string, data: T) =>
        toCloudEvent(type, data, {
          causationId: sourceEvent.id,
          correlationId: tracking.correlationid,
          userId: tracking.userid,
        }),
    };
  },
} as const;
