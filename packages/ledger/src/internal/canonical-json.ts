import { err, ok, type Result } from '@exitbook/foundation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

export function canonicalStringify(value: unknown): Result<string, Error> {
  if (value === null) {
    return ok('null');
  }

  switch (typeof value) {
    case 'boolean':
      return ok(value ? 'true' : 'false');
    case 'number':
      if (!Number.isFinite(value)) {
        return err(new Error('Canonical JSON does not allow non-finite numbers'));
      }
      return ok(JSON.stringify(value));
    case 'string':
      return ok(JSON.stringify(value));
    case 'undefined':
      return ok('null');
    case 'object':
      break;
    default:
      return err(new Error(`Canonical JSON does not allow values of type ${typeof value}`));
  }

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) {
      const itemResult = canonicalStringify(item);
      if (itemResult.isErr()) {
        return err(itemResult.error);
      }

      items.push(itemResult.value);
    }

    return ok(`[${items.join(',')}]`);
  }

  if (!isPlainObject(value)) {
    return err(new Error('Canonical JSON only allows plain objects and arrays'));
  }

  const entries = Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const parts: string[] = [];

  for (const [key, nestedValue] of entries) {
    const nestedResult = canonicalStringify(nestedValue);
    if (nestedResult.isErr()) {
      return err(nestedResult.error);
    }

    parts.push(`${JSON.stringify(key)}:${nestedResult.value}`);
  }

  return ok(`{${parts.join(',')}}`);
}
