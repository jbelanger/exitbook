import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { BlockchainViewItem, ProviderViewItem } from '../blockchains-view-model.js';

import {
  buildBlockchainDetailFields,
  buildBlockchainTitleParts,
  buildBlockchainsEmptyStateMessage,
  buildBlockchainsFilterLabel,
  buildCategoryParts,
  formatBlockchainLayer,
  formatProviderApiKeyStatus,
  formatProviderCapabilities,
  getBlockchainKeyStatusDisplay,
} from './blockchains-view-formatters.js';
import type { BlockchainsViewState } from './blockchains-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const BLOCKCHAIN_LIST_COLUMN_ORDER = ['displayName', 'key', 'category', 'layer', 'providers', 'apiKeys'] as const;
const PROVIDER_ROW_ORDER = ['name', 'capabilities', 'rateLimit', 'apiKey'] as const;

export function outputBlockchainsStaticList(state: BlockchainsViewState): void {
  process.stdout.write(buildBlockchainsStaticList(state));
}

export function buildBlockchainsStaticList(state: BlockchainsViewState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.blockchains.length === 0) {
    lines.push(...buildEmptyStateLines(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.blockchains, {
    displayName: { format: (item) => item.displayName, minWidth: 'NAME'.length },
    key: { format: (item) => item.name, minWidth: 'KEY'.length },
    category: { format: (item) => item.category, minWidth: 'CATEGORY'.length },
    layer: { format: (item) => formatBlockchainLayer(item.layer), minWidth: 'LAYER'.length },
    providers: {
      align: 'right',
      format: (item) => String(item.providerCount),
      minWidth: 'PROVIDERS'.length,
    },
    apiKeys: {
      format: (item) => getBlockchainKeyStatusDisplay(item.keyStatus, item.missingKeyCount).label,
      minWidth: 'API KEYS'.length,
    },
  });

  lines.push(buildListColumnHeader(columns));
  for (const item of state.blockchains) {
    lines.push(buildBlockchainRow(item, columns));
  }

  return `${lines.join('\n')}\n`;
}

export function outputBlockchainStaticDetail(blockchain: BlockchainViewItem): void {
  process.stdout.write(buildBlockchainStaticDetail(blockchain));
}

export function buildBlockchainStaticDetail(blockchain: BlockchainViewItem): string {
  const title = buildBlockchainTitleParts(blockchain);
  const lines: string[] = [
    `${pc.bold(title.displayName)} ${pc.dim(title.key)} ${pc.cyan(title.category)}${title.layerLabel ? ` ${pc.dim(title.layerLabel)}` : ''}`,
    '',
    ...buildBlockchainDetailFields(blockchain, { includeRepeatedTitleFields: true }).map((field) =>
      buildDetailLine(field.label, field.value)
    ),
    '',
    ...buildProviderLines(blockchain.providers),
  ];

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: BlockchainsViewState): string {
  const filterLabel = buildBlockchainsFilterLabel({
    categoryFilter: state.categoryFilter,
    requiresApiKeyFilter: state.requiresApiKeyFilter,
  });
  const categoryParts = !state.categoryFilter
    ? buildCategoryParts(state.categoryCounts).map((part) => `${part.count} ${part.label}`)
    : [];
  const metadata = [`${state.totalCount} total`, ...categoryParts, `${state.totalProviders} providers`];

  return `${pc.bold(`Blockchains${filterLabel}`)} ${pc.dim(metadata.join(' · '))}`;
}

function buildEmptyStateLines(state: BlockchainsViewState): string[] {
  return [
    buildBlockchainsEmptyStateMessage({
      categoryFilter: state.categoryFilter,
      requiresApiKeyFilter: state.requiresApiKeyFilter,
    }),
  ];
}

function buildListColumnHeader(
  columns: ReturnType<
    typeof createColumns<BlockchainViewItem, 'displayName' | 'key' | 'category' | 'layer' | 'providers' | 'apiKeys'>
  >
): string {
  return pc.dim(
    buildTextTableHeader(
      columns.widths,
      {
        displayName: 'NAME',
        key: 'KEY',
        category: 'CATEGORY',
        layer: 'LAYER',
        providers: 'PROVIDERS',
        apiKeys: 'API KEYS',
      },
      BLOCKCHAIN_LIST_COLUMN_ORDER,
      { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
    )
  );
}

function buildBlockchainRow(
  blockchain: BlockchainViewItem,
  columns: ReturnType<
    typeof createColumns<BlockchainViewItem, 'displayName' | 'key' | 'category' | 'layer' | 'providers' | 'apiKeys'>
  >
): string {
  const formatted = columns.format(blockchain);

  return buildTextTableRow(
    {
      ...formatted,
      displayName: pc.bold(formatted.displayName),
      key: pc.dim(formatted.key),
      category: pc.cyan(formatted.category),
      layer: pc.dim(formatted.layer),
      apiKeys: colorKeyStatusText(blockchain, formatted.apiKeys),
      providers: formatted.providers,
    },
    BLOCKCHAIN_LIST_COLUMN_ORDER,
    { gap: STATIC_LIST_COLUMN_GAP }
  );
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildProviderLines(providers: ProviderViewItem[]): string[] {
  const lines = [pc.dim('Providers')];

  if (providers.length === 0) {
    lines.push('No providers registered for this blockchain.');
    return lines;
  }

  const columns = createColumns(providers, {
    name: { format: (provider) => provider.displayName, minWidth: 12 },
    capabilities: {
      format: (provider) => formatProviderCapabilities(provider),
      minWidth: 'CAPABILITIES'.length,
    },
    rateLimit: { format: (provider) => provider.rateLimit ?? '—', minWidth: 'RATE'.length },
    apiKey: { format: (provider) => formatProviderApiKeyStatus(provider), minWidth: 'API KEY'.length },
  });

  for (const provider of providers) {
    const formatted = columns.format(provider);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          name: pc.cyan(formatted.name),
          rateLimit: pc.dim(formatted.rateLimit),
          apiKey: colorProviderApiKeyText(provider, formatted.apiKey),
        },
        PROVIDER_ROW_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return lines;
}

function colorKeyStatusText(blockchain: BlockchainViewItem, value: string): string {
  return colorStatus(getBlockchainKeyStatusDisplay(blockchain.keyStatus, blockchain.missingKeyCount).color, value);
}

function colorProviderApiKeyText(provider: ProviderViewItem, value: string): string {
  if (!provider.requiresApiKey) {
    return pc.dim(value);
  }

  return provider.apiKeyConfigured ? pc.green(value) : pc.yellow(value);
}

function colorStatus(color: 'dim' | 'green' | 'yellow', value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'dim':
      return pc.dim(value);
  }
}
