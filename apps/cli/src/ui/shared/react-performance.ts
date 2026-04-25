import { performance } from 'node:perf_hooks';

import { useEffect } from 'react';

/**
 * React's development reconciler records performance measures on every Ink render.
 * Long-running CLI monitors clear those global entries so perf_hooks does not warn.
 */
export function useClearReactPerformanceMeasures(): void {
  useEffect(() => {
    performance.clearMeasures();
  });
}
