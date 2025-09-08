import { Layer, Effect, Context } from 'effect';

import type { Clock } from './clock.js';
import { SystemClockLayer } from './clock.js';

// Common services that all contexts need
export interface CoreServices {
  readonly clock: Clock;
}

export const CoreServices = Context.GenericTag<CoreServices>('CoreServices');

// Base runtime layer with core services
export const CoreLayer = Layer.mergeAll(SystemClockLayer);

// Create runtime with core services
export const createRuntime = <R, E, A>(
  program: Effect.Effect<A, E, R>,
  contextLayer?: Layer.Layer<R, never, never>,
) => {
  const fullLayer = contextLayer ? Layer.merge(CoreLayer, contextLayer) : CoreLayer;

  return Effect.provide(program, fullLayer);
};
