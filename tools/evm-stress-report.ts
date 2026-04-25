import * as path from 'node:path';

import Database from 'better-sqlite3';

type Row = Record<string, unknown>;

interface QuerySection {
  name: string;
  rows: Row[];
}

interface StressReport {
  generatedAt: string;
  databasePath: string;
  sections: QuerySection[];
}

interface CliOptions {
  databasePath: string;
  json: boolean;
}

const DEFAULT_DATABASE_PATH = 'apps/cli/data/transactions.db';

const QUERIES: readonly { name: string; sql: string }[] = [
  {
    name: 'core_counts',
    sql: `
      SELECT 'accounts' AS surface, count(*) AS rows FROM accounts
      UNION ALL SELECT 'raw_transactions', count(*) FROM raw_transactions
      UNION ALL SELECT 'transactions', count(*) FROM transactions
      UNION ALL SELECT 'transaction_movements', count(*) FROM transaction_movements
      UNION ALL SELECT 'source_activities', count(*) FROM source_activities
      UNION ALL SELECT 'accounting_journals', count(*) FROM accounting_journals
      UNION ALL SELECT 'accounting_postings', count(*) FROM accounting_postings
      UNION ALL SELECT 'posting_source_components', count(*) FROM accounting_posting_source_components
      UNION ALL SELECT 'journal_relationships', count(*) FROM accounting_journal_relationships
      UNION ALL SELECT 'journal_diagnostics', count(*) FROM accounting_journal_diagnostics
      UNION ALL SELECT 'raw_assignments', count(*) FROM raw_transaction_source_activity_assignments
      UNION ALL SELECT 'asset_review_state', count(*) FROM asset_review_state
    `,
  },
  {
    name: 'raw_processing_status',
    sql: `
      SELECT processing_status, count(*) AS rows
      FROM raw_transactions
      GROUP BY processing_status
      ORDER BY rows DESC
    `,
  },
  {
    name: 'raw_streams',
    sql: `
      SELECT provider_name, transaction_type_hint, count(*) AS rows
      FROM raw_transactions
      GROUP BY provider_name, transaction_type_hint
      ORDER BY rows DESC
    `,
  },
  {
    name: 'decoded_method_coverage',
    sql: `
      SELECT
        count(*) AS raw_rows,
        sum(CASE WHEN json_extract(provider_data, '$.methodId') IS NOT NULL AND json_extract(provider_data, '$.methodId') NOT IN ('', '0x') THEN 1 ELSE 0 END) AS provider_selector_rows,
        sum(CASE WHEN json_extract(normalized_data, '$.methodId') IS NOT NULL AND json_extract(normalized_data, '$.methodId') NOT IN ('', '0x') THEN 1 ELSE 0 END) AS normalized_selector_rows,
        sum(CASE WHEN json_extract(provider_data, '$.functionName') IS NOT NULL AND trim(json_extract(provider_data, '$.functionName')) <> '' THEN 1 ELSE 0 END) AS provider_function_rows,
        sum(CASE WHEN json_extract(normalized_data, '$.functionName') IS NOT NULL AND trim(json_extract(normalized_data, '$.functionName')) <> '' THEN 1 ELSE 0 END) AS normalized_function_rows
      FROM raw_transactions
    `,
  },
  {
    name: 'top_provider_method_cues',
    sql: `
      SELECT
        json_extract(provider_data, '$.methodId') AS method_id,
        json_extract(provider_data, '$.functionName') AS function_name,
        transaction_type_hint,
        count(*) AS rows
      FROM raw_transactions
      WHERE json_extract(provider_data, '$.methodId') IS NOT NULL
        AND json_extract(provider_data, '$.methodId') NOT IN ('', '0x')
      GROUP BY method_id, function_name, transaction_type_hint
      ORDER BY rows DESC
      LIMIT 40
    `,
  },
  {
    name: 'wrap_unwrap_method_cues',
    sql: `
      SELECT
        json_extract(provider_data, '$.methodId') AS method_id,
        json_extract(provider_data, '$.functionName') AS function_name,
        transaction_type_hint,
        count(*) AS rows
      FROM raw_transactions
      WHERE json_extract(provider_data, '$.methodId') IN ('0xd0e30db0', '0x2e1a7d4d')
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) IN ('deposit()', 'withdraw(uint256 amount)')
      GROUP BY method_id, function_name, transaction_type_hint
      ORDER BY rows DESC
    `,
  },
  {
    name: 'canonical_weth_activity',
    sql: `
      SELECT
        transaction_type_hint,
        json_extract(provider_data, '$.methodId') AS method_id,
        json_extract(provider_data, '$.functionName') AS function_name,
        json_extract(provider_data, '$.tokenSymbol') AS token_symbol,
        count(*) AS rows
      FROM raw_transactions
      WHERE lower(coalesce(json_extract(provider_data, '$.contractAddress'), '')) = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
        OR lower(coalesce(json_extract(provider_data, '$.to'), '')) = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
      GROUP BY transaction_type_hint, method_id, function_name, token_symbol
      ORDER BY rows DESC
      LIMIT 40
    `,
  },
  {
    name: 'bridge_method_cues',
    sql: `
      SELECT
        json_extract(provider_data, '$.methodId') AS method_id,
        json_extract(provider_data, '$.functionName') AS function_name,
        transaction_type_hint,
        count(*) AS rows
      FROM raw_transactions
      WHERE lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*bridge*'
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*depositforburn*'
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*outboundtransfer*'
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*sendtoinjective*'
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*transfertokenswithpayload*'
        OR json_extract(provider_data, '$.methodId') IN ('0x6fd3504e', '0x4d9f9b9b', '0x1e4e1e41')
      GROUP BY method_id, function_name, transaction_type_hint
      ORDER BY rows DESC
      LIMIT 40
    `,
  },
  {
    name: 'approval_method_cues',
    sql: `
      WITH decoded_methods AS (
        SELECT
          json_extract(provider_data, '$.methodId') AS method_id,
          json_extract(provider_data, '$.functionName') AS function_name,
          lower(coalesce(json_extract(provider_data, '$.functionName'), '')) AS normalized_function_name,
          transaction_type_hint
        FROM raw_transactions
      )
      SELECT
        method_id,
        function_name,
        transaction_type_hint,
        count(*) AS rows
      FROM decoded_methods
      WHERE normalized_function_name GLOB 'approve(*'
        OR normalized_function_name GLOB 'setapprovalforall(*'
        OR normalized_function_name GLOB 'increaseallowance(*'
        OR normalized_function_name GLOB 'decreaseallowance(*'
        OR normalized_function_name GLOB 'permit(*'
        OR method_id IN ('0x095ea7b3', '0xa22cb465', '0x39509351', '0xa457c2d7', '0xd505accf')
      GROUP BY method_id, function_name, transaction_type_hint
      ORDER BY rows DESC
      LIMIT 40
    `,
  },
  {
    name: 'liquidity_method_cues',
    sql: `
      SELECT
        json_extract(provider_data, '$.methodId') AS method_id,
        json_extract(provider_data, '$.functionName') AS function_name,
        transaction_type_hint,
        count(*) AS rows
      FROM raw_transactions
      WHERE lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*addliquidity*'
        OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*removeliquidity*'
      GROUP BY method_id, function_name, transaction_type_hint
      ORDER BY rows DESC
      LIMIT 40
    `,
  },
  {
    name: 'liquidity_group_shapes',
    sql: `
      WITH lp_hashes AS (
        SELECT DISTINCT blockchain_transaction_hash AS hash
        FROM raw_transactions
        WHERE lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*addliquidity*'
          OR lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*removeliquidity*'
      ),
      grouped AS (
        SELECT
          lp_hashes.hash,
          SUM(CASE WHEN rt.transaction_type_hint = 'normal' THEN 1 ELSE 0 END) AS normal_rows,
          SUM(CASE WHEN rt.transaction_type_hint = 'internal' THEN 1 ELSE 0 END) AS internal_rows,
          SUM(CASE WHEN rt.transaction_type_hint = 'token' THEN 1 ELSE 0 END) AS token_rows,
          GROUP_CONCAT(DISTINCT json_extract(rt.provider_data, '$.functionName')) AS functions
        FROM lp_hashes
        JOIN raw_transactions rt ON rt.blockchain_transaction_hash = lp_hashes.hash
        GROUP BY lp_hashes.hash
      )
      SELECT
        CASE WHEN lower(functions) LIKE '%addliquidity%' THEN 'add' ELSE 'remove' END AS liquidity_action,
        normal_rows,
        internal_rows,
        token_rows,
        COUNT(*) AS transactions
      FROM grouped
      GROUP BY liquidity_action, normal_rows, internal_rows, token_rows
      ORDER BY liquidity_action, transactions DESC
    `,
  },
  {
    name: 'liquidity_complete_samples',
    sql: `
      WITH lp_hashes AS (
        SELECT blockchain_transaction_hash AS hash
        FROM raw_transactions
        WHERE lower(coalesce(json_extract(provider_data, '$.functionName'), '')) GLOB '*removeliquidity*'
        GROUP BY blockchain_transaction_hash
      ),
      grouped AS (
        SELECT
          rt.blockchain_transaction_hash,
          SUM(CASE WHEN rt.transaction_type_hint = 'normal' THEN 1 ELSE 0 END) AS normal_rows,
          SUM(CASE WHEN rt.transaction_type_hint = 'internal' THEN 1 ELSE 0 END) AS internal_rows,
          SUM(CASE WHEN rt.transaction_type_hint = 'token' THEN 1 ELSE 0 END) AS token_rows,
          GROUP_CONCAT(json_extract(rt.provider_data, '$.tokenSymbol') || ':' || json_extract(rt.normalized_data, '$.amount'), '; ') AS token_amounts
        FROM raw_transactions rt
        JOIN lp_hashes ON lp_hashes.hash = rt.blockchain_transaction_hash
        GROUP BY rt.blockchain_transaction_hash
      )
      SELECT blockchain_transaction_hash, normal_rows, internal_rows, token_rows, token_amounts
      FROM grouped
      WHERE normal_rows > 0 AND internal_rows > 0 AND token_rows > 1
      ORDER BY blockchain_transaction_hash
      LIMIT 20
    `,
  },
  {
    name: 'unassigned_raw_rows',
    sql: `
      SELECT
        rt.transaction_type_hint,
        json_extract(rt.normalized_data, '$.type') AS normalized_type,
        json_extract(rt.normalized_data, '$.status') AS normalized_status,
        count(*) AS rows
      FROM raw_transactions rt
      LEFT JOIN raw_transaction_source_activity_assignments a ON a.raw_transaction_id = rt.id
      WHERE a.raw_transaction_id IS NULL
      GROUP BY rt.transaction_type_hint, normalized_type, normalized_status
      ORDER BY rows DESC
      LIMIT 25
    `,
  },
  {
    name: 'assignments_per_raw_row',
    sql: `
      SELECT assignments_per_raw, count(*) AS raw_rows
      FROM (
        SELECT rt.id, count(a.raw_transaction_id) AS assignments_per_raw
        FROM raw_transactions rt
        LEFT JOIN raw_transaction_source_activity_assignments a ON a.raw_transaction_id = rt.id
        GROUP BY rt.id
      )
      GROUP BY assignments_per_raw
      ORDER BY assignments_per_raw
    `,
  },
  {
    name: 'raw_rows_per_source_activity',
    sql: `
      SELECT raw_rows_per_activity, count(*) AS source_activities
      FROM (
        SELECT sa.id, count(a.raw_transaction_id) AS raw_rows_per_activity
        FROM source_activities sa
        LEFT JOIN raw_transaction_source_activity_assignments a ON a.source_activity_id = sa.id
        GROUP BY sa.id
      )
      GROUP BY raw_rows_per_activity
      ORDER BY raw_rows_per_activity DESC
      LIMIT 20
    `,
  },
  {
    name: 'journal_kinds',
    sql: `
      SELECT journal_kind, count(*) AS journals
      FROM accounting_journals
      GROUP BY journal_kind
      ORDER BY journals DESC
    `,
  },
  {
    name: 'posting_roles',
    sql: `
      SELECT posting_role, coalesce(settlement, '') AS settlement, count(*) AS postings
      FROM accounting_postings
      GROUP BY posting_role, settlement
      ORDER BY postings DESC
    `,
  },
  {
    name: 'source_component_kinds',
    sql: `
      SELECT component_kind, count(*) AS components
      FROM accounting_posting_source_components
      GROUP BY component_kind
      ORDER BY components DESC
    `,
  },
  {
    name: 'diagnostics',
    sql: `
      SELECT diagnostic_code, coalesce(severity, '') AS severity, count(*) AS rows
      FROM accounting_journal_diagnostics
      GROUP BY diagnostic_code, severity
      ORDER BY rows DESC
    `,
  },
  {
    name: 'diagnostic_samples',
    sql: `
      SELECT
        ajd.diagnostic_code,
        coalesce(ajd.severity, '') AS severity,
        aj.journal_kind,
        sa.blockchain_transaction_hash,
        ajd.diagnostic_message
      FROM accounting_journal_diagnostics ajd
      JOIN accounting_journals aj ON aj.id = ajd.journal_id
      JOIN source_activities sa ON sa.id = aj.source_activity_id
      ORDER BY ajd.id
      LIMIT 15
    `,
  },
  {
    name: 'asset_review_summary',
    sql: `
      SELECT review_status, accounting_blocked, count(*) AS assets
      FROM asset_review_state
      GROUP BY review_status, accounting_blocked
      ORDER BY assets DESC
    `,
  },
  {
    name: 'blocked_assets_by_posting_count',
    sql: `
      SELECT
        ap.asset_symbol,
        ars.asset_id,
        ars.review_status,
        ars.accounting_blocked,
        count(ap.id) AS postings,
        ars.warning_summary
      FROM asset_review_state ars
      LEFT JOIN accounting_postings ap ON ap.asset_id = ars.asset_id
      WHERE ars.accounting_blocked = 1
      GROUP BY ars.asset_id
      ORDER BY postings DESC, ars.asset_id
      LIMIT 25
    `,
  },
  {
    name: 'asset_balance_shape',
    sql: `
      WITH balances AS (
        SELECT asset_id, min(asset_symbol) AS asset_symbol, sum(cast(quantity AS real)) AS quantity, count(*) AS postings
        FROM accounting_postings
        GROUP BY asset_id
      )
      SELECT
        count(*) AS asset_balances,
        sum(CASE WHEN abs(quantity) < 1e-18 THEN 1 ELSE 0 END) AS zero_balances,
        sum(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS positive_balances,
        sum(CASE WHEN quantity < 0 THEN 1 ELSE 0 END) AS negative_balances
      FROM balances
    `,
  },
  {
    name: 'symbol_ambiguity',
    sql: `
      SELECT asset_symbol, count(DISTINCT asset_id) AS asset_count, count(*) AS postings
      FROM accounting_postings
      GROUP BY asset_symbol
      HAVING count(DISTINCT asset_id) > 1
      ORDER BY asset_count DESC, postings DESC
      LIMIT 30
    `,
  },
  {
    name: 'extreme_quantity_postings',
    sql: `
      SELECT
        asset_symbol,
        asset_id,
        posting_role,
        quantity,
        length(replace(replace(quantity, '-', ''), '.', '')) AS digit_count
      FROM accounting_postings
      ORDER BY digit_count DESC, asset_id
      LIMIT 25
    `,
  },
  {
    name: 'transfer_journals_that_look_like_trades',
    sql: `
      WITH journal_shape AS (
        SELECT
          aj.id,
          aj.journal_kind,
          sa.blockchain_transaction_hash,
          count(ap.id) AS posting_count,
          count(DISTINCT ap.asset_id) AS asset_count,
          count(DISTINCT CASE WHEN ap.posting_role = 'principal' AND cast(ap.quantity AS real) > 0 THEN ap.asset_id END) AS positive_principal_assets,
          count(DISTINCT CASE WHEN ap.posting_role = 'principal' AND cast(ap.quantity AS real) < 0 THEN ap.asset_id END) AS negative_principal_assets,
          group_concat(CASE WHEN ap.posting_role = 'principal' THEN ap.asset_symbol || ':' || ap.quantity END, '; ') AS principal_postings
        FROM accounting_journals aj
        JOIN source_activities sa ON sa.id = aj.source_activity_id
        JOIN accounting_postings ap ON ap.journal_id = aj.id
        GROUP BY aj.id
      )
      SELECT
        journal_kind,
        blockchain_transaction_hash,
        posting_count,
        asset_count,
        positive_principal_assets,
        negative_principal_assets,
        principal_postings
      FROM journal_shape
      WHERE journal_kind = 'transfer'
        AND positive_principal_assets > 0
        AND negative_principal_assets > 0
        AND asset_count > 1
      ORDER BY asset_count DESC, posting_count DESC
      LIMIT 25
    `,
  },
  {
    name: 'journal_shape_distribution',
    sql: `
      WITH journal_shape AS (
        SELECT
          aj.id,
          aj.journal_kind,
          count(ap.id) AS posting_count,
          count(DISTINCT ap.asset_id) AS asset_count
        FROM accounting_journals aj
        JOIN accounting_postings ap ON ap.journal_id = aj.id
        GROUP BY aj.id
      )
      SELECT journal_kind, posting_count, asset_count, count(*) AS journals
      FROM journal_shape
      GROUP BY journal_kind, posting_count, asset_count
      ORDER BY journals DESC
      LIMIT 40
    `,
  },
];

function parseOptions(argv: readonly string[]): CliOptions {
  let databasePath = DEFAULT_DATABASE_PATH;
  let json = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--db') {
      const value = argv[index + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error('--db requires a database path');
      }

      databasePath = value;
      index++;
      continue;
    }

    if (arg !== undefined && arg.trim().length > 0) {
      databasePath = arg;
    }
  }

  return {
    databasePath: path.resolve(process.cwd(), databasePath),
    json,
  };
}

function runReport(options: CliOptions): StressReport {
  const db = new Database(options.databasePath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    return {
      databasePath: options.databasePath,
      generatedAt: new Date().toISOString(),
      sections: QUERIES.map((query) => ({
        name: query.name,
        rows: db.prepare(query.sql).all() as Row[],
      })),
    };
  } finally {
    db.close();
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replaceAll('\n', ' ');
}

function formatSection(section: QuerySection): string {
  if (section.rows.length === 0) {
    return `## ${section.name}\n\n(no rows)\n`;
  }

  const columns = Object.keys(section.rows[0] ?? {});
  const header = `| ${columns.join(' |')} |`;
  const separator = `| ${columns.map(() => '---').join(' |')} |`;
  const rows = section.rows.map((row) => `| ${columns.map((column) => formatValue(row[column])).join(' |')} |`);

  return [`## ${section.name}`, '', header, separator, ...rows, ''].join('\n');
}

function formatMarkdown(report: StressReport): string {
  return [
    '# EVM Stress Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Database: ${report.databasePath}`,
    '',
    ...report.sections.map(formatSection),
  ].join('\n');
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const report = runReport(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatMarkdown(report));
}

main();
