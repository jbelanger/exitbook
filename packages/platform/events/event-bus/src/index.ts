// Core interfaces and types
export { UnifiedEventBus, makeUnifiedEventBus } from './event-bus';
export type { UnifiedEventBus as IUnifiedEventBus } from './event-bus';
export { CheckpointStore } from './checkpoint-store';
export type { CheckpointStore as ICheckpointStore } from './checkpoint-store';

// Errors and patterns
export * from './errors';
export * from './pattern';

// Compose layers (main integration points)
export {
  UnifiedEventBusDefault,
  UnifiedEventBusLive,
  CheckpointStoreLive,
} from './compose/default';
