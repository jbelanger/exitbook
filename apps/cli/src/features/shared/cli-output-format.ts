export type CliOutputFormat = 'json' | 'text';

function hasBooleanJsonFlag(value: unknown): value is { json?: boolean | undefined } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('json' in value)) {
    return true;
  }

  return typeof (value as { json: unknown }).json === 'boolean';
}

export function detectCliOutputFormat(rawOptions: unknown): CliOutputFormat {
  return hasBooleanJsonFlag(rawOptions) && rawOptions.json === true ? 'json' : 'text';
}
