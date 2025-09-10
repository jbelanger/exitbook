import { Layer } from 'effect';

import { MessageBusProducerLive, MessageBusConsumerLive } from '../index';
// TODO: Import actual transport adapters like KafkaTransportLive, RabbitMQTransportLive, etc.
// For now, this would be provided by the system that uses the messaging package

// Default production composition - MessageBus layers that depend on transport
export const MessageBusDefault = Layer.mergeAll(MessageBusProducerLive, MessageBusConsumerLive);

// Individual exports for selective usage
export { MessageBusProducerLive, MessageBusConsumerLive };
