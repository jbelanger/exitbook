// Environment-based composition (recommended default)
export {
  createEnvironmentMessageBus,
  MessageBusProduction,
  MessageBusDevelopment,
} from './compose/environment';

// Alternative compositions for specific use cases
export { MessageBusDefault } from './compose/default';
export { MessageBusTest } from './compose/test';

// Re-exporting main interfaces and errors from the port for convenience
export * from './port';
