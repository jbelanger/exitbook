import { PROJECTION_DEFINITIONS, type ProjectionId } from './projection-definitions.js';

/**
 * Returns all projections that depend (directly or transitively) on `from`,
 * in topological order (immediate dependents first).
 *
 * Example: cascadeInvalidation('processed-transactions') => ['links']
 */
export function cascadeInvalidation(from: ProjectionId): ProjectionId[] {
  const result: ProjectionId[] = [];
  const visited = new Set<ProjectionId>();

  function walk(id: ProjectionId): void {
    for (const def of PROJECTION_DEFINITIONS) {
      if (def.dependsOn.includes(id) && !visited.has(def.id)) {
        visited.add(def.id);
        result.push(def.id);
        walk(def.id);
      }
    }
  }

  walk(from);
  return result;
}

/**
 * Returns the upstream projections that must be fresh before `target` can build,
 * in build order (deepest dependency first).
 *
 * Example: rebuildPlan('links') => ['processed-transactions']
 */
export function rebuildPlan(target: ProjectionId): ProjectionId[] {
  const result: ProjectionId[] = [];
  const visited = new Set<ProjectionId>();

  function walk(id: ProjectionId): void {
    const def = PROJECTION_DEFINITIONS.find((d) => d.id === id);
    if (!def) return;

    for (const dep of def.dependsOn) {
      if (!visited.has(dep)) {
        visited.add(dep);
        walk(dep);
        result.push(dep);
      }
    }
  }

  walk(target);
  return result;
}

/**
 * Returns the projections that must be reset when resetting `target`,
 * in reset order (downstream dependents first, then the target itself).
 *
 * Example: resetPlan('processed-transactions') => ['links', 'processed-transactions']
 */
export function resetPlan(target: ProjectionId): ProjectionId[] {
  const downstream = cascadeInvalidation(target).reverse();
  // Downstream in reverse topological order (leaf dependents first), then the target
  return [...downstream, target];
}
