import path from 'node:path';

import { err, ok, resultDo, resultTry, type Result } from '../packages/foundation/src/index.ts';
import { getLogger } from '../packages/logger/src/index.ts';
import Database from 'better-sqlite3';

const logger = getLogger('RepairAccountingIssueSchema');

const ACCOUNTING_ISSUE_ROWS_TABLE = 'accounting_issue_rows';
const ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE = 'accounting_issue_rows__repair_old';

const REQUIRED_FAMILY_FRAGMENTS = ["'missing_price'", "'execution_failure'"] as const;
const REQUIRED_CODE_FRAGMENT = "'WORKFLOW_EXECUTION_FAILED'";

const CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS = [
  'id',
  'scope_key',
  'issue_key',
  'family',
  'code',
  'severity',
  'status',
  'summary',
  'first_seen_at',
  'last_seen_at',
  'closed_at',
  'closed_reason',
  'detail_json',
  'evidence_json',
  'next_actions_json',
] as const;

const LEGACY_ACCOUNTING_ISSUE_ROW_COLUMNS = [
  ...CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS.slice(0, 8),
  'acknowledged_at',
  ...CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS.slice(8),
] as const;

type AccountingIssueTableSchema = {
  columns: string[];
  createTableSql: string;
  indexStatements: string[];
};

type RepairResult = {
  dbPath: string;
  repaired: boolean;
};

function main(): void {
  const dbPath = resolveDbPath(process.argv[2]);
  const repairResult = repairAccountingIssueSchema(dbPath);

  if (repairResult.isErr()) {
    logger.error({ error: repairResult.error, dbPath }, 'Failed to repair accounting issue schema');
    process.exitCode = 1;
    return;
  }

  const summary = repairResult.value;
  const action = summary.repaired ? 'repaired' : 'already current';
  logger.info({ dbPath: summary.dbPath, action }, 'Accounting issue schema check completed');
}

function resolveDbPath(explicitDbPath: string | undefined): string {
  if (explicitDbPath) {
    return path.resolve(process.cwd(), explicitDbPath);
  }

  const dataDir = process.env.EXITBOOK_DATA_DIR
    ? path.resolve(process.cwd(), process.env.EXITBOOK_DATA_DIR)
    : path.join(process.cwd(), 'apps/cli/data');

  return path.join(dataDir, 'transactions.db');
}

function repairAccountingIssueSchema(dbPath: string): Result<RepairResult, Error> {
  return resultDo(function* () {
    const db = yield* openDatabase(dbPath);

    try {
      const schema = yield* loadAccountingIssueTableSchema(db);
      yield* assertSupportedAccountingIssueRowColumns(schema.columns);

      if (isAccountingIssueSchemaCurrent(schema.createTableSql)) {
        return {
          dbPath,
          repaired: false,
        };
      }

      const repairedCreateTableSql = yield* buildRepairedCreateTableSql(schema.createTableSql);
      yield* rebuildAccountingIssueRowsTable(db, repairedCreateTableSql, schema.indexStatements);

      const repairedSchema = yield* loadAccountingIssueTableSchema(db);
      if (!isAccountingIssueSchemaCurrent(repairedSchema.createTableSql)) {
        return yield* err(
          `Accounting issue schema repair did not apply the expected family/code constraints in ${dbPath}`
        );
      }

      return {
        dbPath,
        repaired: true,
      };
    } finally {
      closeDatabaseQuietly(db, dbPath);
    }
  });
}

function openDatabase(dbPath: string): Result<Database.Database, Error> {
  return resultTry(
    function* () {
      const db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      return db;
    },
    (cause) => wrapCause(`Failed to open SQLite database at ${dbPath}`, cause)
  );
}

function loadAccountingIssueTableSchema(db: Database.Database): Result<AccountingIssueTableSchema, Error> {
  return resultTry(
    function* () {
      const repairTableExists = db
        .prepare(
          `SELECT 1
           FROM sqlite_master
           WHERE type = 'table' AND name = ?`
        )
        .get(ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE);

      if (repairTableExists) {
        return yield* err(
          `Found stale ${ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE}. Recreate the local database instead of running this repair on a half-repaired schema.`
        );
      }

      const tableRow = db
        .prepare(
          `SELECT sql
         FROM sqlite_master
         WHERE type = 'table' AND name = ?`
        )
        .get(ACCOUNTING_ISSUE_ROWS_TABLE) as { sql: string | null } | undefined;

      if (!tableRow?.sql) {
        return yield* err(`Table ${ACCOUNTING_ISSUE_ROWS_TABLE} does not exist in the target database`);
      }

      const columns = db
        .prepare(`PRAGMA table_info(${ACCOUNTING_ISSUE_ROWS_TABLE})`)
        .all()
        .map((row) => (row as { name: string }).name);

      const indexStatements = db
        .prepare(
          `SELECT sql
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = ?
           AND sql IS NOT NULL
         ORDER BY name`
        )
        .all(ACCOUNTING_ISSUE_ROWS_TABLE)
        .flatMap((row) => {
          const indexStatement = (row as { sql: string | null }).sql;
          return indexStatement ? [indexStatement] : [];
        });

      return {
        columns,
        createTableSql: tableRow.sql,
        indexStatements,
      };
    },
    (cause) => wrapCause(`Failed to inspect ${ACCOUNTING_ISSUE_ROWS_TABLE} schema`, cause)
  );
}

function assertSupportedAccountingIssueRowColumns(columns: string[]): Result<void, Error> {
  const actualColumns = [...columns].sort();
  const supportedShapes = [CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS, LEGACY_ACCOUNTING_ISSUE_ROW_COLUMNS];

  for (const supportedColumns of supportedShapes) {
    const expectedColumns = [...supportedColumns].sort();
    if (expectedColumns.length !== actualColumns.length) {
      continue;
    }

    let matches = true;
    for (let index = 0; index < expectedColumns.length; index += 1) {
      if (expectedColumns[index] !== actualColumns[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return ok(undefined);
    }
  }

  return err(
    `Unsupported ${ACCOUNTING_ISSUE_ROWS_TABLE} column shape. Expected one of: ${supportedShapes.map((shape) => shape.join(', ')).join(' | ')} but found ${actualColumns.join(', ')}. Recreate the local database instead of running this repair.`
  );
}

function isAccountingIssueSchemaCurrent(createTableSql: string): boolean {
  return (
    REQUIRED_FAMILY_FRAGMENTS.every((fragment) => createTableSql.includes(fragment)) &&
    createTableSql.includes(REQUIRED_CODE_FRAGMENT) &&
    !createTableSql.includes('"acknowledged_at"')
  );
}

function buildRepairedCreateTableSql(createTableSql: string): Result<string, Error> {
  return resultDo(function* () {
    const withoutAcknowledgedAt = removeColumnDefinition(createTableSql, 'acknowledged_at');
    const withCurrentFamilyConstraint = yield* replaceCheckConstraint(
      withoutAcknowledgedAt,
      'accounting_issue_rows_family_valid',
      `family IN ('transfer_gap', 'asset_review_blocker', 'missing_price', 'tax_readiness', 'execution_failure')`
    );

    return yield* replaceCheckConstraint(
      withCurrentFamilyConstraint,
      'accounting_issue_rows_code_valid',
      `code IN (
        'LINK_GAP',
        'ASSET_REVIEW_BLOCKER',
        'MISSING_PRICE_DATA',
        'FX_FALLBACK_USED',
        'UNRESOLVED_ASSET_REVIEW',
        'UNKNOWN_TRANSACTION_CLASSIFICATION',
        'UNCERTAIN_PROCEEDS_ALLOCATION',
        'INCOMPLETE_TRANSFER_LINKING',
        'WORKFLOW_EXECUTION_FAILED'
      )`
    );
  });
}

function removeColumnDefinition(createTableSql: string, columnName: string): string {
  return createTableSql
    .replace(new RegExp(`,\\s*"${columnName}"\\s+text`, 'i'), '')
    .replace(new RegExp(`"${columnName}"\\s+text,\\s*`, 'i'), '');
}

function replaceCheckConstraint(
  createTableSql: string,
  constraintName: string,
  nextExpression: string
): Result<string, Error> {
  const marker = `constraint "${constraintName}" check (`;
  const markerStart = createTableSql.indexOf(marker);
  if (markerStart === -1) {
    return err(`Could not find ${constraintName} in ${ACCOUNTING_ISSUE_ROWS_TABLE} schema`);
  }

  const expressionStart = markerStart + marker.length;
  let depth = 1;
  let expressionEnd = expressionStart;

  while (expressionEnd < createTableSql.length && depth > 0) {
    const character = createTableSql[expressionEnd];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }
    expressionEnd += 1;
  }

  if (depth !== 0) {
    return err(`Could not parse ${constraintName} in ${ACCOUNTING_ISSUE_ROWS_TABLE} schema`);
  }

  return ok(`${createTableSql.slice(0, expressionStart)}${nextExpression}${createTableSql.slice(expressionEnd - 1)}`);
}

function rebuildAccountingIssueRowsTable(
  db: Database.Database,
  repairedCreateTableSql: string,
  indexStatements: string[]
): Result<void, Error> {
  return resultTry(
    function* () {
      const targetColumnList = CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS.join(', ');
      const sourceColumnList = CURRENT_ACCOUNTING_ISSUE_ROW_COLUMNS.join(', ');

      db.transaction(() => {
        db.exec(`ALTER TABLE ${ACCOUNTING_ISSUE_ROWS_TABLE} RENAME TO ${ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE}`);
        db.exec(repairedCreateTableSql);
        db.exec(
          `INSERT INTO ${ACCOUNTING_ISSUE_ROWS_TABLE} (${targetColumnList})
         SELECT ${sourceColumnList}
         FROM ${ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE}`
        );
        db.exec(`DROP TABLE ${ACCOUNTING_ISSUE_ROWS_REPAIR_TABLE}`);

        for (const indexStatement of indexStatements) {
          db.exec(indexStatement);
        }
      })();

      return undefined;
    },
    (cause) => wrapCause(`Failed to rebuild ${ACCOUNTING_ISSUE_ROWS_TABLE} with current issue constraints`, cause)
  );
}

function closeDatabaseQuietly(db: Database.Database, dbPath: string): void {
  try {
    db.close();
  } catch (error) {
    logger.warn({ error, dbPath }, 'Failed to close SQLite database after accounting issue schema repair');
  }
}

function wrapCause(message: string, cause: unknown): Error {
  if (cause instanceof Error) {
    return new Error(message, { cause });
  }

  return new Error(`${message}: ${String(cause)}`);
}

main();
