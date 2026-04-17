import { formatMovementFingerprintRef } from '@exitbook/core';
import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { TransactionViewItem } from '../transactions-view-model.js';

import { buildTransactionRelatedContextLines } from './transaction-related-context-static-renderer.js';
import {
  buildCategoryParts,
  formatTransactionBalanceSummary,
  formatTransactionDirection,
  formatTransactionFingerprintRef,
  formatTransactionFlags,
  formatTransactionOperation,
  formatTransactionTimestamp,
  getTransactionPriceStatusDisplay,
  type TransactionsStatusColor,
} from './transactions-view-formatters.js';
import type { TransactionsViewState } from './transactions-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const TRANSACTION_REF_COLUMN_LABEL = 'TX-REF';
const TRANSACTION_LIST_COLUMN_ORDER = [
  'transactionRef',
  'datetime',
  'platform',
  'operation',
  'debit',
  'credit',
  'fees',
  'flags',
] as const;

export function outputTransactionsStaticList(state: TransactionsViewState): void {
  process.stdout.write(buildTransactionsStaticList(state));
}

export function buildTransactionsStaticList(state: TransactionsViewState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.transactions.length === 0) {
    lines.push(...buildEmptyStateLines(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.transactions, {
    credit: {
      format: (item) => formatTransactionBalanceSummary(item.creditSummary),
      minWidth: 10,
    },
    debit: {
      format: (item) => formatTransactionBalanceSummary(item.debitSummary),
      minWidth: 10,
    },
    datetime: {
      format: (item) => formatTransactionTimestamp(item.datetime).slice(0, 16),
      minWidth: 'DATE'.length,
    },
    flags: {
      format: (item) => formatTransactionFlags(item),
      minWidth: 8,
    },
    fees: {
      format: (item) => formatTransactionBalanceSummary(item.feeSummary),
      minWidth: 'FEES'.length,
    },
    operation: {
      format: (item) => formatTransactionOperation(item.operationCategory, item.operationType),
      minWidth: 18,
    },
    platform: { format: (item) => item.platformKey, minWidth: 10 },
    transactionRef: {
      format: (item) => formatTransactionFingerprintRef(item.txFingerprint),
      minWidth: TRANSACTION_REF_COLUMN_LABEL.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          credit: 'CREDIT',
          debit: 'DEBIT',
          datetime: 'DATE',
          flags: 'FLAGS',
          fees: 'FEES',
          operation: 'OPERATION',
          platform: 'PLATFORM',
          transactionRef: TRANSACTION_REF_COLUMN_LABEL,
        },
        TRANSACTION_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const item of state.transactions) {
    const formatted = columns.format(item);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          credit: formatted.credit === '—' ? pc.dim(formatted.credit) : pc.green(formatted.credit),
          debit: formatted.debit === '—' ? pc.dim(formatted.debit) : pc.yellow(formatted.debit),
          datetime: pc.dim(formatted.datetime),
          flags: formatted.flags === '—' ? pc.dim(formatted.flags) : pc.yellow(formatted.flags),
          fees: formatted.fees === '—' ? pc.dim(formatted.fees) : pc.red(formatted.fees),
          operation: pc.dim(formatted.operation),
          platform: pc.cyan(formatted.platform),
        },
        TRANSACTION_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function outputTransactionStaticDetail(transaction: TransactionViewItem): void {
  process.stdout.write(buildTransactionStaticDetail(transaction));
}

export function buildTransactionStaticDetail(transaction: TransactionViewItem): string {
  const priceStatus = getTransactionPriceStatusDisplay(transaction.priceStatus);
  const flags = formatTransactionFlags(transaction);
  const lines = [
    `${pc.bold(`Transaction #${transaction.id}`)} ${pc.dim(formatTransactionFingerprintRef(transaction.txFingerprint))} ${pc.cyan(transaction.platformKey)} ${pc.dim(formatTransactionOperation(transaction.operationCategory, transaction.operationType))}`,
    '',
    buildDetailLine('Transaction ref', formatTransactionFingerprintRef(transaction.txFingerprint)),
    buildDetailLine('Fingerprint', transaction.txFingerprint),
    buildDetailLine('Date', formatTransactionTimestamp(transaction.datetime)),
    buildDetailLine('Platform', transaction.platformKey),
    buildDetailLine('Operation', `${transaction.operationCategory}/${transaction.operationType}`),
    buildDetailLine('Debit', formatTransactionBalanceSummary(transaction.debitSummary)),
    buildDetailLine('Credit', formatTransactionBalanceSummary(transaction.creditSummary)),
    buildDetailLine('Fees', formatTransactionBalanceSummary(transaction.feeSummary)),
    buildDetailLine('Primary movement', buildPrimaryMovementSummary(transaction)),
    buildDetailLine('Price', colorizeStatusLabel(priceStatus.iconColor, priceStatus.label)),
    buildDetailLine('Flags', flags === '—' ? pc.dim(flags) : flags),
  ];

  if (transaction.from) {
    lines.push(buildDetailLine('From', buildEndpointSummary(transaction.from, transaction.fromOwnership)));
  }
  if (transaction.to) {
    lines.push(buildDetailLine('To', buildEndpointSummary(transaction.to, transaction.toOwnership)));
  }
  if (transaction.blockchain) {
    lines.push(buildDetailLine('Chain', transaction.blockchain.name));
    lines.push(buildDetailLine('Tx hash', transaction.blockchain.transactionHash));
    if (transaction.blockchain.blockHeight !== undefined) {
      lines.push(buildDetailLine('Block', `${transaction.blockchain.blockHeight}`));
    }
    lines.push(buildDetailLine('Confirmed', transaction.blockchain.isConfirmed ? 'yes' : 'no'));
  }
  if (transaction.relatedContext) {
    lines.push('', ...buildTransactionRelatedContextLines(transaction.relatedContext));
  }
  if (transaction.inflows.length > 0) {
    lines.push('', ...buildMovementLines('Inflows', '+', transaction.inflows));
  }
  if (transaction.outflows.length > 0) {
    lines.push('', ...buildMovementLines('Outflows', '-', transaction.outflows));
  }
  if (transaction.fees.length > 0) {
    lines.push('', pc.dim(`Fees (${transaction.fees.length})`));
    lines.push(
      ...transaction.fees.map((fee) => {
        const priceSuffix = fee.priceAtTxTime ? ` @ ${fee.priceAtTxTime.price} (${fee.priceAtTxTime.source})` : '';
        return `  ${fee.amount} ${fee.assetSymbol} ${pc.dim(`[${fee.scope}/${fee.settlement}]`)}${pc.dim(priceSuffix)}`;
      })
    );
  }
  if (transaction.diagnostics.length > 0) {
    lines.push('', pc.dim(`Diagnostics (${transaction.diagnostics.length})`));
    lines.push(
      ...transaction.diagnostics.map((diagnostic) => {
        const severitySuffix = diagnostic.severity ? ` ${pc.dim(`(${diagnostic.severity})`)}` : '';
        return `  [${diagnostic.code}] ${diagnostic.message}${severitySuffix}`;
      })
    );
  }
  if (transaction.userNotes.length > 0) {
    lines.push('', pc.dim(`User notes (${transaction.userNotes.length})`));
    lines.push(
      ...transaction.userNotes.map((userNote) => {
        const authorPrefix = userNote.author ? `${userNote.author} · ` : '';
        return `  ${pc.cyan(authorPrefix)}${userNote.message}${pc.dim(` (${formatTransactionTimestamp(userNote.createdAt)})`)}`;
      })
    );
  }
  if (transaction.rawSources && transaction.rawSources.length > 0) {
    lines.push('', ...buildRawSourceLines(transaction.rawSources));
  }

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: TransactionsViewState): string {
  const activeFilters = [
    state.filters.accountFilter,
    state.filters.platformFilter,
    state.filters.assetIdFilter,
    state.filters.assetFilter,
    state.filters.addressFilter ? `address=${state.filters.addressFilter}` : undefined,
    state.filters.fromFilter ? `from=${state.filters.fromFilter}` : undefined,
    state.filters.toFilter ? `to=${state.filters.toFilter}` : undefined,
    state.filters.operationTypeFilter,
    state.filters.noPriceFilter ? 'missing prices' : undefined,
  ].filter((value): value is string => value !== undefined);
  const filterLabel = activeFilters.length > 0 ? ` (${activeFilters.join(' · ')})` : '';
  const metadata = [
    `${state.totalCount} total`,
    ...buildCategoryParts(state.categoryCounts).map((part) => `${part.count} ${part.label}`),
  ];

  return `${pc.bold(`Transactions${filterLabel}`)} ${pc.dim(metadata.join(' · '))}`;
}

function buildEmptyStateLines(state: TransactionsViewState): string[] {
  if (
    state.filters.accountFilter === undefined &&
    state.filters.platformFilter === undefined &&
    state.filters.assetIdFilter === undefined &&
    state.filters.assetFilter === undefined &&
    state.filters.addressFilter === undefined &&
    state.filters.fromFilter === undefined &&
    state.filters.toFilter === undefined &&
    state.filters.operationTypeFilter === undefined &&
    state.filters.noPriceFilter !== true
  ) {
    return ['No transactions found.', '', pc.dim('Tip: exitbook import --help')];
  }

  return ['No transactions found for the requested filters.'];
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildEndpointSummary(endpoint: string, ownership: TransactionViewItem['fromOwnership']): string {
  if (ownership === undefined) {
    return endpoint;
  }

  return `${endpoint} ${pc.dim(`[${ownership}]`)}`;
}

function buildMovementLines(label: string, prefix: '+' | '-', movements: TransactionViewItem['inflows']): string[] {
  const lines = [pc.dim(`${label} (${movements.length})`)];
  lines.push(
    ...movements.map((movement) => {
      const roleSuffix = movement.movementRole === 'principal' ? '' : ` ${pc.dim(`[${movement.movementRole}]`)}`;
      const movementRef = formatMovementFingerprintRef(movement.movementFingerprint);
      const priceSuffix = movement.priceAtTxTime
        ? ` @ ${movement.priceAtTxTime.price} (${movement.priceAtTxTime.source})`
        : '';
      return `  ${prefix} ${movement.amount} ${movement.assetSymbol}${roleSuffix}${pc.dim(priceSuffix)} ${pc.dim(`· ${movementRef}`)}`;
    })
  );
  return lines;
}

function buildPrimaryMovementSummary(transaction: TransactionViewItem): string {
  if (!transaction.primaryMovementAsset || !transaction.primaryMovementAmount) {
    return pc.dim('—');
  }

  const direction = formatTransactionDirection(transaction.primaryMovementDirection);
  return `${transaction.primaryMovementAmount} ${transaction.primaryMovementAsset}${direction === '—' ? '' : ` ${direction}`}`;
}

function buildRawSourceLines(rawSources: NonNullable<TransactionViewItem['rawSources']>): string[] {
  const lines = [pc.dim(`Source data (${rawSources.length})`)];

  for (const rawSource of rawSources) {
    const metadata = [
      `provider=${rawSource.providerName}`,
      `event=${rawSource.eventId}`,
      `at=${formatTransactionTimestamp(new Date(rawSource.timestamp).toISOString())}`,
      rawSource.transactionTypeHint ? `hint=${rawSource.transactionTypeHint}` : undefined,
      rawSource.blockchainTransactionHash ? `hash=${rawSource.blockchainTransactionHash}` : undefined,
      rawSource.sourceAddress ? `source=${rawSource.sourceAddress}` : undefined,
    ].filter((value): value is string => value !== undefined);

    lines.push(`  Raw #${rawSource.id} ${pc.dim(metadata.join(' · '))}`);
    lines.push(...indentJsonBlock('providerData', rawSource.providerData));
    lines.push(...indentJsonBlock('normalizedData', rawSource.normalizedData));
  }

  return lines;
}

function indentJsonBlock(label: string, value: unknown): string[] {
  const rendered = JSON.stringify(value, undefined, 2) ?? 'null';
  const lines = rendered.split('\n');

  return [`    ${pc.dim(`${label}:`)}`, ...lines.map((line) => `      ${line}`)];
}

function colorizeStatusLabel(color: TransactionsStatusColor, value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'red':
      return pc.red(value);
    case 'dim':
      return pc.dim(value);
  }

  const exhaustiveCheck: never = color;
  return exhaustiveCheck;
}
