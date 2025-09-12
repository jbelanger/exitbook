// Core interfaces and types
export { UnifiedEventBusTag, makeUnifiedEventBus } from './event-bus';
export type { UnifiedEventBus, UnifiedEventBus as IUnifiedEventBus } from './event-bus';
export type { CheckpointStore, CheckpointStore as ICheckpointStore } from './checkpoint-store';

// Errors and patterns
export * from './errors';
export { matchesPattern, type LivePattern } from './event-bus';

// Compose layers (main integration points)
export { UnifiedEventBusDefault, UnifiedEventBusLive, CheckpointStoreLive } from './compose/live';
