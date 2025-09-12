import { Effect, Ref } from 'effect';

import type { MessageTransport, MessageHeaders } from '../../port';

// ✅ factory returns a resolved MessageTransport (R = never)
export const makeFakeMessageTransport = (): Effect.Effect<MessageTransport, never, never> =>
  Effect.gen(function* () {
    // Store messages in memory
    const messages = yield* Ref.make<
      {
        headers?: Record<string, string>;
        key?: string;
        offset: string;
        payload: unknown;
        timestamp: Date;
        topic: string;
      }[]
    >([]);

    // Track subscribers
    const subscribers = yield* Ref.make<
      {
        groupId: string;
        handler: (message: {
          headers: MessageHeaders;
          key?: string;
          offset?: unknown;
          payload: unknown;
        }) => Effect.Effect<void, unknown>;
        topic: string;
      }[]
    >([]);

    let offsetCounter = 0;

    return {
      healthCheck: () => Effect.void,

      publish: (topic: string, payload: unknown, options) =>
        Effect.gen(function* () {
          const message: {
            headers?: Record<string, string>;
            key?: string;
            offset: string;
            payload: unknown;
            timestamp: Date;
            topic: string;
          } = {
            ...(options?.headers && { headers: options.headers }),
            ...(options?.key && { key: options.key }),
            offset: String(++offsetCounter),
            payload,
            timestamp: new Date(),
            topic,
          };

          yield* Ref.update(messages, (msgs) => [...msgs, message]);

          // Notify subscribers
          const subs = yield* Ref.get(subscribers);
          const relevantSubs = subs.filter((s) => s.topic === topic);

          yield* Effect.forEach(relevantSubs, (sub) =>
            sub
              .handler({
                headers: message.headers || {},
                ...(message.key && { key: message.key }),
                offset: message.offset,
                payload: message.payload,
              })
              .pipe(
                Effect.catchAll(() => Effect.void), // Ignore handler errors
              ),
          );
        }),

      publishBatch: (topic: string, messagesData) =>
        Effect.forEach(messagesData, (msg) => {
          const message: {
            headers?: Record<string, string>;
            key?: string;
            offset: string;
            payload: unknown;
            timestamp: Date;
            topic: string;
          } = {
            ...(msg.headers && { headers: msg.headers }),
            ...(msg.key && { key: msg.key }),
            offset: String(++offsetCounter),
            payload: msg.payload,
            timestamp: new Date(),
            topic,
          };

          return Ref.update(messages, (msgs) => [...msgs, message]);
        }).pipe(Effect.asVoid),

      subscribe: (topic: string, groupId: string, handler) =>
        Effect.gen(function* () {
          yield* Ref.update(subscribers, (subs) => [...subs, { groupId, handler, topic }]);

          // Send existing messages to new subscriber
          const msgs = yield* Ref.get(messages);
          const topicMessages = msgs.filter((m) => m.topic === topic);

          yield* Effect.forEach(topicMessages, (msg) =>
            handler({
              headers: msg.headers || {},
              ...(msg.key && { key: msg.key }),
              offset: msg.offset,
              payload: msg.payload,
            }).pipe(Effect.catchAll(() => Effect.void)),
          );
        }),

      unsubscribe: (topic: string, groupId: string) =>
        Ref.update(subscribers, (subs) =>
          subs.filter((s) => !(s.topic === topic && s.groupId === groupId)),
        ).pipe(Effect.asVoid),
    };
  });
