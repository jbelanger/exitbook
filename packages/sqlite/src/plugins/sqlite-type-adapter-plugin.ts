/* eslint-disable unicorn/no-null -- null is required for db */

import {
  OperationNodeTransformer,
  type KyselyPlugin,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
  type PrimitiveValueListNode,
  type ValueNode,
} from 'kysely';

/**
 * Recursively converts values for SQLite compatibility
 * - undefined -> null
 * - boolean -> 0 or 1
 * - Keeps all other types unchanged
 */
export function convertValueForSqlite(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (Array.isArray(value)) {
    return value.map(convertValueForSqlite);
  }

  if (value && typeof value === 'object' && value.constructor === Object) {
    const converted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      converted[key] = convertValueForSqlite(val);
    }
    return converted;
  }

  return value;
}

/**
 * Kysely plugin that adapts JavaScript parameter values to SQLite-friendly values.
 */
export class SqliteTypeAdapterPlugin implements KyselyPlugin {
  readonly #transformer = new SqliteTypeAdapterTransformer();

  transformQuery(args: PluginTransformQueryArgs): PluginTransformQueryArgs['node'] {
    return this.#transformer.transformNode(args.node, args.queryId);
  }

  transformResult(args: PluginTransformResultArgs): Promise<PluginTransformResultArgs['result']> {
    return Promise.resolve(args.result);
  }
}

class SqliteTypeAdapterTransformer extends OperationNodeTransformer {
  protected override transformValue(node: ValueNode): ValueNode {
    node = super.transformValue(node);
    return {
      ...node,
      value: convertValueForSqlite(node.value),
    };
  }

  protected override transformPrimitiveValueList(node: PrimitiveValueListNode): PrimitiveValueListNode {
    node = super.transformPrimitiveValueList(node);
    return {
      ...node,
      values: node.values.map(convertValueForSqlite),
    };
  }
}

export const sqliteTypeAdapterPlugin = new SqliteTypeAdapterPlugin();
