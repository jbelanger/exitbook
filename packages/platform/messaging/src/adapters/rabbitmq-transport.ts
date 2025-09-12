import { createHash } from 'node:crypto';

import { connect } from 'amqp-connection-manager';
import type { AmqpConnectionManager, ChannelWrapper, Options } from 'amqp-connection-manager';
import type { ConsumeMessage, ConfirmChannel, Channel } from 'amqplib';
import { Effect, Layer } from 'effect';

import { MessageTransportTag, PublishError, SubscribeError, MessageBusError } from '../port';
import type { MessageTransport, MessageHeaders } from '../port';

export interface RabbitMQConfig {
  readonly durable?: boolean | undefined;
  readonly exchangeName?: string | undefined;
  readonly exchangeType?: 'topic' | 'direct' | 'fanout' | 'headers' | undefined;
  readonly maxRetries?: number | undefined;
  readonly publishTimeoutMs?: number | undefined;
  readonly retryDelays?: readonly number[] | undefined;
  readonly url: string;
}

export const makeRabbitMQTransport = (
  config: RabbitMQConfig,
): Effect.Effect<MessageTransport & { cleanup: () => Promise<void> }, MessageBusError, never> =>
  Effect.sync(() => {
    const subscribers = new Map<
      string,
      Map<string, { setupFn: (ch: Channel | ConfirmChannel) => Promise<unknown>; tag: string }>
    >(); // topic -> (groupId -> { tag, setupFn })

    const exchangeName = config.exchangeName || 'events';
    const exchangeType = config.exchangeType || 'topic';
    const durable = config.durable ?? true;
    const publishTimeout = config.publishTimeoutMs || 5000;
    const maxRetries = config.maxRetries ?? 3;
    const retryDelays = config.retryDelays ?? [5000, 30000, 120000]; // 5s, 30s, 2m

    // Helper functions
    const safeName = (s: string) =>
      s.length <= 200 ? s : createHash('sha1').update(s).digest('hex');
    const normalizeHeaders = (h?: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k, String(v)]));

    // Extract retry count from RabbitMQ's x-death header
    const getRetryCount = (headers?: Record<string, unknown>): number => {
      if (!headers?.['x-death']) return 0;
      const xDeath = Array.isArray(headers['x-death']) ? headers['x-death'][0] : headers['x-death'];
      return Number(xDeath?.count) || 0;
    };

    // Setup DLQ topology: DLX exchange, retry queues with TTL, DLQ
    const setupDLQTopology = async (channel: Channel | ConfirmChannel) => {
      // Dead letter exchange for routing failed messages
      await channel.assertExchange('dlx', 'direct', { durable });

      // Final DLQ for messages that exceeded max retries
      await channel.assertQueue('dlq', { durable });
      await channel.bindQueue('dlq', 'dlx', 'dlq');

      // Retry queues with TTL that dead-letter back to main exchange
      for (let i = 0; i < retryDelays.length; i++) {
        const retryQueue = `retry-${i + 1}`;
        await channel.assertQueue(retryQueue, {
          arguments: {
            'x-dead-letter-exchange': exchangeName,
            'x-message-ttl': retryDelays[i],
          },
          durable,
        });
        await channel.bindQueue(retryQueue, 'dlx', `retry-${i + 1}`);
      }
    };

    // Create connection manager
    const connectionManager: AmqpConnectionManager = connect([config.url]);

    // Publisher channel with confirm mode and timeout
    const publisherChannel: ChannelWrapper = connectionManager.createChannel({
      confirm: true,
      json: false,
      publishTimeout,
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(exchangeName, exchangeType, {
          autoDelete: false,
          durable,
          internal: false,
        });
        await setupDLQTopology(channel);
      },
    });

    // Consumer channel with prefetch and setup
    const consumerChannel: ChannelWrapper = connectionManager.createChannel({
      json: false,
      setup: (channel: Channel | ConfirmChannel) => {
        return channel.prefetch(50);
      },
    });

    return {
      // Cleanup function for proper resource management
      cleanup: async () => {
        try {
          await publisherChannel.close();
        } catch {
          /* empty */
        }
        try {
          await consumerChannel.close();
        } catch {
          /* empty */
        }
        try {
          await connectionManager.close();
        } catch {
          /* empty */
        }
      },

      healthCheck: () =>
        // Readiness: publisher AND consumer channels available
        Effect.all(
          [
            Effect.tryPromise({
              catch: (e) =>
                new MessageBusError({ reason: `Publisher channel not connected: ${String(e)}` }),
              try: () => publisherChannel.waitForConnect(),
            }),
            Effect.tryPromise({
              catch: (e) =>
                new MessageBusError({ reason: `Consumer channel not connected: ${String(e)}` }),
              try: () => consumerChannel.waitForConnect(),
            }),
          ],
          { concurrency: 1 },
        )
          // optional timeout so health doesn't hang forever
          .pipe(
            Effect.timeoutFail({
              duration: 3000,
              onTimeout: () =>
                new MessageBusError({ reason: 'RabbitMQ health timeout waiting for channel(s)' }),
            }),
            Effect.asVoid,
          ),

      publish: (topic: string, payload: unknown, options) =>
        Effect.gen(function* () {
          const message = Buffer.from(JSON.stringify(payload));
          const headers = normalizeHeaders(options?.headers);

          const publishEffect = Effect.tryPromise({
            catch: (error) =>
              new PublishError({
                reason: `Publish error: ${String(error)}`,
              }),
            try: () =>
              publisherChannel.publish(exchangeName, topic, message, {
                appId: String(headers['x-service'] ?? 'unknown'),
                contentType: headers['content-type'] ?? 'application/json',
                headers,
                persistent: true,
                timestamp: Math.floor(Date.now() / 1000),
                ...(options?.key && { messageId: options.key }),
              }),
          });

          // Apply per-call timeout if specified (must be <= channel publishTimeout)
          if (options?.timeoutMs && options.timeoutMs < publishTimeout) {
            yield* publishEffect.pipe(
              Effect.timeoutFail({
                duration: options.timeoutMs,
                onTimeout: () =>
                  new PublishError({
                    reason: `Publish timeout after ${options.timeoutMs}ms`,
                  }),
              }),
            );
          } else {
            yield* publishEffect;
          }
        }),

      publishBatch: (topic: string, messages) =>
        Effect.gen(function* () {
          // Publish all messages
          yield* Effect.forEach(
            messages,
            (msg) => {
              const headers = normalizeHeaders(msg.headers);
              const message = Buffer.from(JSON.stringify(msg.payload));

              const publishEffect = Effect.tryPromise({
                catch: (error) =>
                  new PublishError({
                    reason: `Batch publish error: ${String(error)}`,
                  }),
                try: () =>
                  publisherChannel.publish(exchangeName, topic, message, {
                    appId: String(headers['x-service'] ?? 'unknown'),
                    contentType: headers['content-type'] ?? 'application/json',
                    headers,
                    persistent: true,
                    timestamp: Math.floor(Date.now() / 1000),
                    ...(msg.key && { messageId: msg.key }),
                  }),
              });

              // Apply per-message timeout if specified (must be <= channel publishTimeout)
              if (msg.timeoutMs && msg.timeoutMs < publishTimeout) {
                return publishEffect.pipe(
                  Effect.timeoutFail({
                    duration: msg.timeoutMs,
                    onTimeout: () =>
                      new PublishError({
                        reason: `Batch publish timeout after ${msg.timeoutMs}ms`,
                      }),
                  }),
                );
              } else {
                return publishEffect;
              }
            },
            { concurrency: 1 },
          );
        }),

      subscribe: (topic: string, groupId: string, handler) =>
        Effect.gen(function* () {
          // Guard against duplicate subscribes
          if (subscribers.get(topic)?.has(groupId)) {
            return Effect.fail(
              new SubscribeError({ reason: `Already subscribed: ${groupId}/${topic}` }),
            );
          }

          const queueName = safeName(`${groupId}::${topic}`);

          const setupFn = async (channel: Channel | ConfirmChannel) => {
            // Assert exchange in consumer setup
            await channel.assertExchange(exchangeName, exchangeType, {
              autoDelete: false,
              durable,
              internal: false,
            });

            // Setup DLQ topology in consumer as well
            await setupDLQTopology(channel);

            const queue = await channel.assertQueue(queueName, {
              arguments: {
                'x-dead-letter-exchange': 'dlx',
                'x-queue-type': 'quorum',
              },
              durable,
            });
            await channel.bindQueue(queue.queue, exchangeName, topic);

            const consumer = await channel.consume(
              queue.queue,
              (msg: ConsumeMessage | null) => {
                if (msg) {
                  // Safe JSON parse
                  let payload: unknown;
                  try {
                    payload = JSON.parse(msg.content.toString());
                  } catch (e) {
                    console.error(
                      'Bad payload on queue',
                      queueName,
                      'routing key',
                      msg.fields.routingKey,
                      ':',
                      e,
                    );
                    channel.nack(msg, false, false); // No requeue for bad JSON
                    return;
                  }

                  const headers: MessageHeaders = normalizeHeaders(msg.properties.headers);
                  const key = msg.properties.messageId as string | undefined;
                  const offset = msg.fields.deliveryTag;

                  // Run handler in Effect context
                  Effect.runPromiseExit(
                    handler({
                      headers,
                      ...(key && { key }),
                      offset,
                      payload,
                    }),
                  )
                    .then((exit) => {
                      if (exit._tag === 'Success') {
                        channel.ack(msg);
                      } else {
                        console.error('Handler error:', exit.cause);

                        // Check retry count from x-death header
                        const retryCount = getRetryCount(msg.properties.headers);

                        const nextRoute =
                          retryCount >= maxRetries
                            ? 'dlq'
                            : retryCount < retryDelays.length
                              ? `retry-${retryCount + 1}`
                              : 'dlq';
                        // Republish the original content to DLX with the desired route, then ack the original
                        channel.publish('dlx', nextRoute, msg.content, {
                          headers: msg.properties.headers as Record<string, unknown>,
                          persistent: true,
                          timestamp: Math.floor(Date.now() / 1000),
                          ...(msg.properties.messageId && { messageId: msg.properties.messageId }),
                          appId: String(msg.properties.appId || 'unknown'),
                          contentType: msg.properties.contentType || 'application/json',
                        } as Options.Publish | undefined);
                        channel.ack(msg);
                      }
                    })
                    .catch((error) => {
                      console.error('Effect runtime error:', error);
                      const retryCount = getRetryCount(msg.properties.headers);
                      const nextRoute =
                        retryCount >= maxRetries
                          ? 'dlq'
                          : retryCount < retryDelays.length
                            ? `retry-${retryCount + 1}`
                            : 'dlq';

                      channel.publish('dlx', nextRoute, msg.content, {
                        headers: msg.properties.headers as Record<string, unknown>,
                        persistent: true,
                        timestamp: Math.floor(Date.now() / 1000),
                        ...(msg.properties.messageId && { messageId: msg.properties.messageId }),
                        appId: String(msg.properties.appId || 'unknown'),
                        contentType: msg.properties.contentType || 'application/json',
                      } as Options.Publish | undefined);
                      channel.ack(msg);
                    });
                }
              },
              { noAck: false },
            );

            // Track subscriber with setupFn
            let topicMap = subscribers.get(topic);
            if (!topicMap) {
              topicMap = new Map();
              subscribers.set(topic, topicMap);
            }
            topicMap.set(groupId, { setupFn, tag: consumer.consumerTag });

            return consumer;
          };

          // Set up consumer with channel wrapper
          yield* Effect.tryPromise({
            catch: (error) =>
              new SubscribeError({
                reason: `Failed to set up consumer: ${String(error)}`,
              }),
            try: () => consumerChannel.addSetup(setupFn),
          });
        }),

      unsubscribe: (topic: string, groupId: string) =>
        Effect.gen(function* () {
          const topicMap = subscribers.get(topic);
          if (topicMap?.has(groupId)) {
            const meta = topicMap.get(groupId)!;

            yield* Effect.tryPromise({
              catch: (error) =>
                new MessageBusError({
                  reason: `Failed to cancel consumer: ${String(error)}`,
                }),
              try: async () => {
                // Remove setup function first to prevent reconnect race
                await consumerChannel.removeSetup(meta.setupFn);
                // If connected, cancel the consumer directly
                if (connectionManager.isConnected()) {
                  await consumerChannel.addSetup(async (ch: Channel | ConfirmChannel) => {
                    try {
                      await (ch as Channel).cancel(meta.tag);
                    } catch {
                      /* ignore cancel errors */
                    }
                  });
                }
                // Remove from tracking
                topicMap.delete(groupId);
              },
            });
          }

          // Clean up empty topic maps
          if (topicMap && topicMap.size === 0) {
            subscribers.delete(topic);
          }
        }),
    };
  });

// Layer factory for RabbitMQ transport with proper resource management
export const makeRabbitMQTransportLive = (config: RabbitMQConfig) =>
  Layer.scoped(
    MessageTransportTag,
    Effect.acquireRelease(makeRabbitMQTransport(config), (transport) =>
      Effect.tryPromise(() => transport.cleanup()).pipe(
        Effect.catchAll(() => Effect.void), // Graceful cleanup on error
      ),
    ),
  );
