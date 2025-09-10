import { Effect } from 'effect';

import type { MessageBusConsumer, MessageTransport, Subscription, IncomingMessage } from '../port';

// ✅ factory takes transport and closes over it
export const makeMessageBusConsumer = (transport: MessageTransport): MessageBusConsumer => ({
  subscribe: (topic: string, groupId: string, handler) =>
    Effect.map(
      transport.subscribe(topic, groupId, (message) => {
        // Convert transport message to ADR-spec IncomingMessage
        const incomingMessage: IncomingMessage = {
          headers: message.headers,
          key: message.key,
          offset: message.offset,
          payload: message.payload,
        };
        return handler(incomingMessage);
      }),
      (): Subscription => ({
        stop: () => Effect.orDie(transport.unsubscribe(topic, groupId)),
      }),
    ),
});
