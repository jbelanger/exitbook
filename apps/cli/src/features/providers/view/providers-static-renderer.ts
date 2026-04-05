import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { ProviderBlockchainItem, ProviderViewItem } from '../providers-view-model.js';

import {
  buildProviderHealthParts,
  buildProvidersEmptyStateMessage,
  buildProvidersFilterLabel,
  formatProviderApiKeyDetailStatus,
  formatProviderApiKeyListStatus,
  formatProviderAverageResponse,
  formatProviderBlockchainAverageResponse,
  formatProviderBlockchainErrorRate,
  formatProviderBlockchainRequestCount,
  formatProviderChainCount,
  formatProviderErrorRate,
  formatProviderRequestCount,
  getProviderBlockchainAlert,
  getProviderHealthDisplay,
} from './providers-view-formatters.js';
import { formatTimeAgo } from './providers-view-formatting.js';
import type { ProvidersViewState } from './providers-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const PROVIDER_LIST_COLUMN_ORDER = [
  'name',
  'chains',
  'health',
  'avgResponse',
  'errorRate',
  'totalReqs',
  'apiKey',
] as const;
const PROVIDER_BLOCKCHAIN_COLUMN_ORDER = [
  'name',
  'capabilities',
  'rateLimit',
  'totalReqs',
  'errorRate',
  'avgResponse',
  'alert',
] as const;

export function outputProvidersStaticList(state: ProvidersViewState): void {
  process.stdout.write(buildProvidersStaticList(state));
}

export function buildProvidersStaticList(state: ProvidersViewState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.providers.length === 0) {
    lines.push(buildProvidersEmptyStateMessage(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.providers, {
    name: { format: (item) => item.name, minWidth: 'NAME'.length },
    chains: { format: (item) => formatProviderChainCount(item.chainCount), minWidth: 'CHAINS'.length },
    health: { format: (item) => getProviderHealthDisplay(item.healthStatus).label, minWidth: 'HEALTH'.length },
    avgResponse: {
      format: (item) => formatProviderAverageResponse(item.stats),
      align: 'right',
      minWidth: 'AVG RESP'.length,
    },
    errorRate: {
      format: (item) => formatProviderErrorRate(item.stats),
      align: 'right',
      minWidth: 'ERR RATE'.length,
    },
    totalReqs: {
      format: (item) => formatProviderRequestCount(item.stats),
      align: 'right',
      minWidth: 'TOTAL REQS'.length,
    },
    apiKey: {
      format: (item) => formatProviderApiKeyListStatus(item),
      minWidth: 'API KEY'.length,
    },
  });

  lines.push(buildListColumnHeader(columns));
  for (const provider of state.providers) {
    lines.push(buildProviderRow(provider, columns));
  }

  return `${lines.join('\n')}\n`;
}

export function outputProviderStaticDetail(provider: ProviderViewItem): void {
  process.stdout.write(buildProviderStaticDetail(provider));
}

export function buildProviderStaticDetail(provider: ProviderViewItem): string {
  const health = getProviderHealthDisplay(provider.healthStatus);
  const lines: string[] = [
    `${pc.bold(provider.displayName)} ${colorStatusText(health.color, health.label)}`,
    '',
    buildDetailLine('Name', provider.name),
    buildDetailLine('Chains', formatProviderChainCount(provider.chainCount)),
    buildDetailLine('Health', health.label),
    buildDetailLine('Total requests', formatProviderRequestCount(provider.stats)),
    buildDetailLine('Avg response', formatProviderAverageResponse(provider.stats)),
    buildDetailLine('Error rate', formatProviderErrorRate(provider.stats)),
  ];

  if (provider.rateLimit) {
    lines.push(buildDetailLine('Config', `${provider.rateLimit} (${provider.configSource})`));
  }

  lines.push(buildDetailLine('API key', formatProviderApiKeyDetailStatus(provider)));

  if (provider.lastError) {
    const lastError = provider.lastErrorTime
      ? `${provider.lastError} (${formatTimeAgo(provider.lastErrorTime)})`
      : provider.lastError;
    lines.push(buildDetailLine('Last error', lastError));
  }

  lines.push('', ...buildProviderBlockchainLines(provider.blockchains));

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: ProvidersViewState): string {
  const filterLabel = buildProvidersFilterLabel({
    blockchainFilter: state.blockchainFilter,
    healthFilter: state.healthFilter,
    missingApiKeyFilter: state.missingApiKeyFilter,
  });
  const healthParts = buildProviderHealthParts(state.healthCounts);
  const metadata = [
    `${state.totalCount} total`,
    ...healthParts.map((part) => `${part.count} ${part.label}`),
    `${state.apiKeyRequiredCount} require API key`,
  ];

  return `${pc.bold(`Providers${filterLabel}`)} ${pc.dim(metadata.join(' · '))}`;
}

function buildListColumnHeader(
  columns: ReturnType<
    typeof createColumns<
      ProviderViewItem,
      'name' | 'chains' | 'health' | 'avgResponse' | 'errorRate' | 'totalReqs' | 'apiKey'
    >
  >
): string {
  return pc.dim(
    buildTextTableHeader(
      columns.widths,
      {
        name: 'NAME',
        chains: 'CHAINS',
        health: 'HEALTH',
        avgResponse: 'AVG RESP',
        errorRate: 'ERR RATE',
        totalReqs: 'TOTAL REQS',
        apiKey: 'API KEY',
      },
      PROVIDER_LIST_COLUMN_ORDER,
      { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
    )
  );
}

function buildProviderRow(
  provider: ProviderViewItem,
  columns: ReturnType<
    typeof createColumns<
      ProviderViewItem,
      'name' | 'chains' | 'health' | 'avgResponse' | 'errorRate' | 'totalReqs' | 'apiKey'
    >
  >
): string {
  const health = getProviderHealthDisplay(provider.healthStatus);
  const formatted = columns.format(provider);

  return buildTextTableRow(
    {
      ...formatted,
      health: colorStatusText(health.color, formatted.health),
      apiKey: colorApiKeyText(provider, formatted.apiKey),
      avgResponse: colorAverageResponseText(provider, formatted.avgResponse),
      errorRate: colorErrorRateText(provider, formatted.errorRate),
      name: pc.bold(formatted.name),
    },
    PROVIDER_LIST_COLUMN_ORDER,
    { gap: STATIC_LIST_COLUMN_GAP }
  );
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildProviderBlockchainLines(blockchains: ProviderBlockchainItem[]): string[] {
  const lines = [pc.dim('Blockchains')];

  if (blockchains.length === 0) {
    lines.push('No blockchains registered for this provider.');
    return lines;
  }

  const columns = createColumns(blockchains, {
    name: { format: (item) => item.name, minWidth: 12 },
    capabilities: {
      format: (item) => item.capabilities.join(' · '),
      minWidth: 'CAPABILITIES'.length,
    },
    rateLimit: { format: (item) => item.rateLimit ?? '—', minWidth: 'RATE'.length },
    totalReqs: {
      format: (item) => formatProviderBlockchainRequestCount(item),
      align: 'right',
      minWidth: 'TOTAL'.length,
    },
    errorRate: {
      format: (item) => formatProviderBlockchainErrorRate(item),
      align: 'right',
      minWidth: 'ERROR'.length,
    },
    avgResponse: {
      format: (item) => formatProviderBlockchainAverageResponse(item),
      align: 'right',
      minWidth: 'AVG'.length,
    },
    alert: {
      format: (item) => getProviderBlockchainAlert(item) ?? '',
      minWidth: 0,
    },
  });

  for (const blockchain of blockchains) {
    const formatted = columns.format(blockchain);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          name: pc.cyan(formatted.name),
          rateLimit: pc.dim(formatted.rateLimit),
          errorRate: colorBlockchainErrorRateText(blockchain, formatted.errorRate),
          avgResponse: colorBlockchainAverageResponseText(blockchain, formatted.avgResponse),
          alert: blockchain.stats ? pc.yellow(formatted.alert) : formatted.alert,
        },
        PROVIDER_BLOCKCHAIN_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return lines;
}

function colorAverageResponseText(provider: ProviderViewItem, value: string): string {
  if (!provider.stats) {
    return pc.dim(value);
  }

  if (provider.stats.avgResponseTime < 200) {
    return pc.green(value);
  }

  if (provider.stats.avgResponseTime <= 500) {
    return pc.yellow(value);
  }

  return pc.red(value);
}

function colorErrorRateText(provider: ProviderViewItem, value: string): string {
  if (!provider.stats) {
    return pc.dim(value);
  }

  if (provider.stats.errorRate < 2) {
    return pc.green(value);
  }

  if (provider.stats.errorRate < 10) {
    return pc.yellow(value);
  }

  return pc.red(value);
}

function colorApiKeyText(provider: ProviderViewItem, value: string): string {
  if (!provider.requiresApiKey) {
    return pc.dim(value);
  }

  return provider.apiKeyConfigured ? pc.green(value) : pc.yellow(value);
}

function colorBlockchainErrorRateText(blockchain: ProviderBlockchainItem, value: string): string {
  if (!blockchain.stats) {
    return pc.dim(value);
  }

  if (blockchain.stats.errorRate < 2) {
    return pc.green(value);
  }

  if (blockchain.stats.errorRate < 10) {
    return pc.yellow(value);
  }

  return pc.red(value);
}

function colorBlockchainAverageResponseText(blockchain: ProviderBlockchainItem, value: string): string {
  if (!blockchain.stats) {
    return pc.dim(value);
  }

  if (blockchain.stats.avgResponseTime < 200) {
    return pc.green(value);
  }

  if (blockchain.stats.avgResponseTime <= 500) {
    return pc.yellow(value);
  }

  return pc.red(value);
}

function colorStatusText(color: ProviderHealthDisplay['color'], value: string): string {
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
}

type ProviderHealthDisplay = ReturnType<typeof getProviderHealthDisplay>;
