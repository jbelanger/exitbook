import type { MessageBusConsumer, MessageTransport } from '../port';

// ✅ factory takes transport and closes over it
export const makeMessageBusConsumer = (transport: MessageTransport): MessageBusConsumer => ({
  subscribe: (topic: string, groupId: string, handler) =>
    transport.subscribe(topic, groupId, handler),

  unsubscribe: (topic: string, groupId: string) => transport.unsubscribe(topic, groupId),
});
