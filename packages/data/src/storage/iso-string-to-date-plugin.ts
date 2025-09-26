import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';

/**
 * Kysely plugin that automatically converts ISO string date fields to Date objects
 *
 * This plugin detects datetime fields by naming convention and converts them from
 * ISO 8601 strings (stored in SQLite) to JavaScript Date objects for better DX.
 */

/**
 * Detect if a field key looks like a datetime field based on naming conventions
 */
const looksLikeDateKey = (key: string): boolean => {
  return (
    key.endsWith('_at') ||
    key.endsWith('_datetime') ||
    key === 'createdAt' ||
    key === 'updatedAt' ||
    key.includes('date') ||
    key.includes('time')
  );
};

/**
 * Check if a string value is a valid ISO 8601 datetime
 */
const isValidIsoString = (value: string): boolean => {
  // Basic ISO 8601 format check
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
  if (!isoRegex.test(value)) return false;

  // Verify it's actually a valid date
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export class IsoStringToDatePlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    // No query transformation needed - we only transform results
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const result = args.result;

    // Only process results with rows
    if (!result.rows?.length) {
      return result;
    }

    const transformedRows = result.rows.map((row) => {
      const transformedRow: Record<string, unknown> = { ...row };

      for (const [key, value] of Object.entries(row)) {
        // Only convert strings that look like datetime fields
        if (value != undefined && typeof value === 'string' && looksLikeDateKey(key) && isValidIsoString(value)) {
          transformedRow[key] = new Date(value);
        }
      }

      return transformedRow as UnknownRow;
    });

    return Promise.resolve({
      ...result,
      rows: transformedRows,
    });
  }
}
