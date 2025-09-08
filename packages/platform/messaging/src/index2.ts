// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access -- sd  */
// /* eslint-disable @typescript-eslint/no-unsafe-call -- d*/
// import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
// // packages/platform/messaging/message-bus.service.ts
// import type { OnModuleInit } from '@nestjs/common';
// import { Injectable } from '@nestjs/common';
// import { Logger } from '@nestjs/common';
// import type { ConfigService } from '@nestjs/config';
// import { Effect, Data, Schema, pipe } from 'effect';
// import { v4 as uuidv4 } from 'uuid';

// // Message schema for validation
// const MessageMetadataSchema = Schema.struct({
//   causationId: Schema.optional(Schema.string),
//   correlationId: Schema.string,
//   source: Schema.string,
//   timestamp: Schema.Date,
//   userId: Schema.optional(Schema.string),
//   version: Schema.string,
// });

// const MessageSchema = Schema.struct({
//   data: Schema.unknown,
//   id: Schema.string,
//   metadata: MessageMetadataSchema,
//   type: Schema.string,
// });

// export type Message = Schema.Schema.Type<typeof MessageSchema>;
// export type MessageMetadata = Schema.Schema.Type<typeof MessageMetadataSchema>;

// export class MessageBusError extends Data.TaggedError('MessageBusError')<{
//   readonly reason: string;
// }> {}

// @Injectable()
// export class MessageBus implements OnModuleInit {
//   private readonly logger = new Logger(MessageBus.name);

//   constructor(
//     private readonly amqpConnection: AmqpConnection,
//     private readonly configService: ConfigService,
//   ) {}

//   async onModuleInit() {
//     // Handle unroutable messages with correlation ID logging
//     this.amqpConnection.channel.on('return', (msg) => {
//       const cid = msg.properties.headers?.['x-correlation-id'];
//       this.logger.error(`Unroutable ${msg.properties.messageId} (${cid})`, {
//         exchange: msg.fields.exchange,
//         routingKey: msg.fields.routingKey,
//       });
//     });

//     // Setup DLQ manually since queues array isn't used by golevelup
//     await this.setupDeadLetterQueue();

//     this.logger.log('Message bus initialized with golevelup/nestjs-rabbitmq');
//   }

//   publish(
//     exchange: string,
//     routingKey: string,
//     message: unknown,
//     options?: PublishOptions,
//   ): Effect.Effect<void, MessageBusError> {
//     return pipe(
//       Effect.sync(() => {
//         const messageId = uuidv4();
//         const envelope: Message = {
//           data: message,
//           id: messageId,
//           metadata: {
//             causationId: options?.causationId,
//             correlationId: options?.correlationId || uuidv4(),
//             source: this.configService.get('SERVICE_NAME') ?? 'crypto-portfolio',
//             timestamp: new Date(),
//             userId: options?.userId,
//             version: '1.0',
//           },
//           type: routingKey,
//         };
//         return envelope;
//       }),
//       Effect.flatMap((envelope) =>
//         pipe(
//           // Validate message schema
//           Schema.decodeUnknown(MessageSchema)(envelope),
//           Effect.mapError((e) => new MessageBusError({ reason: `Invalid message format: ${e}` })),
//         ),
//       ),
//       Effect.flatMap((validEnvelope) =>
//         Effect.tryPromise({
//           catch: (error) =>
//             new MessageBusError({
//               reason: `Failed to publish message: ${error}`,
//             }),
//           try: async () => {
//             // Build headers, only including defined values
//             const headers: Record<string, unknown> = {
//               'x-correlation-id': validEnvelope.metadata.correlationId,
//             };

//             if (validEnvelope.metadata.causationId) {
//               headers['x-causation-id'] = validEnvelope.metadata.causationId;
//             }

//             if (validEnvelope.metadata.userId) {
//               headers['x-user-id'] = validEnvelope.metadata.userId;
//             }

//             await this.amqpConnection.publish(exchange, routingKey, validEnvelope, {
//               contentType: 'application/json',
//               headers,
//               mandatory: true, // Ensure message is routable
//               messageId: validEnvelope.id,
//               persistent: true,
//               timestamp: Math.floor(Date.now() / 1000),
//             });
//           },
//         }),
//       ),
//       Effect.asVoid,
//     );
//   }

//   private async setupDeadLetterQueue(): Promise<void> {
//     try {
//       await this.amqpConnection.channel.assertQueue('dead.letter.queue', {
//         arguments: {
//           'x-max-length': 10000,
//           'x-message-ttl': 86400000, // 24 hours
//           'x-queue-mode': 'lazy', // 👈 tiny but helpful in prod
//         },
//         durable: true,
//       });

//       await this.amqpConnection.channel.bindQueue('dead.letter.queue', 'dlx', '');

//       this.logger.log('Dead letter queue configured');
//     } catch (error) {
//       this.logger.error('Failed to setup dead letter queue', error);
//     }
//   }
// }

// export interface PublishOptions {
//   causationId?: string;
//   correlationId?: string;
//   userId?: string;
// }
