// Central place to expose Effect runtime/layers (Clock, Config, UUID, etc.)
// Keep imports framework-free; adapters provide concrete implementations.
export interface Clock { now(): Date }
export const DefaultClock: Clock = { now: () => new Date() };
