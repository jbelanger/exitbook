import { getErrorMessage } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../shared/blockchain/index.ts';
import { BaseApiClient, RegisterApiClient } from '../../../../shared/blockchain/index.ts';
import type { RawBalanceData, TransactionWithRawData } from '../../../../shared/blockchain/types/index.ts';
import { maskAddress } from '../../../../shared/blockchain/utils/address-utils.ts';
import { convertToMainUnit, createRawBalanceData } from '../../balance-utils.ts';
import type { SubstrateChainConfig } from '../../chain-config.interface.ts';
import { getSubstrateChainConfig } from '../../chain-registry.ts';
import { augmentWithChainConfig } from '../../transaction-utils.ts';
import type { SubstrateTransaction } from '../../types.ts';
import { isValidSS58Address } from '../../utils.ts';

import { SubscanTransactionMapper } from './subscan.mapper.ts';
import type { SubscanAccountResponse, SubscanTransferAugmented, SubscanTransfersResponse } from './subscan.schemas.js';

/**
 * Maps blockchain names to Subscan-specific subdomain identifiers
 * Generated from Subscan network list - mainnet chains only
 */
const CHAIN_SUBDOMAIN_MAP: Record<string, string> = {
  acala: 'acala',
  'aleph-zero': 'alephzero',
  altair: 'altair',
  'assethub-kusama': 'assethub-kusama',
  'assethub-paseo': 'assethub-paseo',
  'assethub-polkadot': 'assethub-polkadot',
  'assethub-westend': 'assethub-westend',
  astar: 'astar',
  'autonomys-chronos': 'autonomys-chronos',
  autonomys: 'autonomys',
  'avail-turing': 'avail-turing',
  avail: 'avail',
  basilisk: 'basilisk',
  bifrost: 'bifrost',
  'bifrost-kusama': 'bifrost-kusama',
  'bridgehub-kusama': 'bridgehub-kusama',
  'bridgehub-paseo': 'bridgehub-paseo',
  'bridgehub-polkadot': 'bridgehub-polkadot',
  'bridgehub-westend': 'bridgehub-westend',
  calamari: 'calamari',
  canary: 'canary',
  'canary-matrix': 'canary-matrix',
  'cc-enterprise': 'cc-enterprise',
  centrifuge: 'centrifuge',
  clover: 'clover',
  'collectives-polkadot': 'collectives-polkadot',
  'coretime-kusama': 'coretime-kusama',
  'coretime-paseo': 'coretime-paseo',
  'coretime-polkadot': 'coretime-polkadot',
  'coretime-westend': 'coretime-westend',
  creditcoin: 'creditcoin',
  crust: 'crust',
  'crust-parachain': 'crust-parachain',
  dancelight: 'dancelight',
  darwinia: 'darwinia',
  dbc: 'dbc',
  dock: 'dock',
  energywebx: 'energywebx',
  enjin: 'enjin',
  gasp: 'gasp',
  heima: 'heima',
  humanode: 'humanode',
  hydradx: 'hydration',
  hydration: 'hydration',
  integritee: 'integritee',
  karura: 'karura',
  khala: 'khala',
  kilt: 'spiritnet',
  krest: 'krest',
  kusama: 'kusama',
  manta: 'manta',
  matrix: 'matrix',
  moonbase: 'moonbase',
  moonbeam: 'moonbeam',
  moonriver: 'moonriver',
  mythos: 'mythos',
  neuroweb: 'neuroweb',
  nodle: 'nodle',
  opal: 'opal',
  paseo: 'paseo',
  peaq: 'peaq',
  pendulum: 'pendulum',
  'people-kusama': 'people-kusama',
  'people-paseo': 'people-paseo',
  'people-polkadot': 'people-polkadot',
  'people-westend': 'people-westend',
  phala: 'phala',
  polkadot: 'polkadot',
  polymesh: 'polymesh',
  pro: 'pro',
  reef: 'reef',
  robonomics: 'robonomics',
  'robonomics-freemium': 'robonomics-freemium',
  shibuya: 'shibuya',
  shiden: 'shiden',
  sora: 'sora',
  spiritnet: 'spiritnet',
  stafi: 'stafi',
  statemine: 'assethub-kusama',
  statemint: 'assethub-polkadot',
  sxt: 'sxt',
  tanssi: 'tanssi',
  unique: 'unique',
  vara: 'vara',
  vflow: 'vflow',
  westend: 'westend',
  zkverify: 'zkverify',
};

@RegisterApiClient({
  baseUrl: 'https://polkadot.api.subscan.io',
  blockchain: 'polkadot',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 4,
      requestsPerHour: 500,
      requestsPerMinute: 120,
      requestsPerSecond: 2,
    },
    retries: 3,
    timeout: 10000,
  },
  description: 'Polkadot and Kusama networks provider with Subscan API integration',
  displayName: 'Subscan',
  name: 'subscan',
  requiresApiKey: false,
  supportedChains: Object.keys(CHAIN_SUBDOMAIN_MAP),
})
export class SubscanApiClient extends BaseApiClient {
  private readonly chainConfig: SubstrateChainConfig;
  private readonly subscanSubdomain: string;
  private mapper: SubscanTransactionMapper;

  constructor(config: ProviderConfig) {
    super(config);

    // Get chain config
    const chainConfig = getSubstrateChainConfig(config.blockchain);
    if (!chainConfig) {
      throw new Error(`Unsupported blockchain for Subscan provider: ${config.blockchain}`);
    }
    this.chainConfig = chainConfig;

    // Map to Subscan subdomain
    const mappedSubdomain = CHAIN_SUBDOMAIN_MAP[config.blockchain];
    if (!mappedSubdomain) {
      throw new Error(`No Subscan subdomain mapping for blockchain: ${config.blockchain}`);
    }
    this.subscanSubdomain = mappedSubdomain;

    // Override base URL with chain-specific subdomain
    this.reinitializeHttpClient({
      baseUrl: `https://${this.subscanSubdomain}.api.subscan.io`,
    });

    // Initialize mapper
    this.mapper = new SubscanTransactionMapper();

    this.logger.debug(
      `Initialized SubscanApiClient for ${config.blockchain} - Subdomain: ${this.subscanSubdomain}, BaseUrl: ${this.baseUrl}, TokenSymbol: ${this.chainConfig.nativeCurrency}`
    );
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    this.logger.debug(
      `Executing operation - Type: ${operation.type}, Address: ${'address' in operation ? maskAddress(operation.address) : 'N/A'}`
    );

    switch (operation.type) {
      case 'getAddressTransactions':
        return (await this.getAddressTransactions({
          address: operation.address,
        })) as Result<T, Error>;
      case 'getAddressBalances':
        return (await this.getAddressBalances({
          address: operation.address,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/api/scan/metadata',
      method: 'POST' as const,
      body: {},
      validate: (response: unknown) => {
        const data = response as { code?: number };
        return data && data.code === 0;
      },
    };
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const result = await this.httpClient.post<SubscanAccountResponse>('/api/scan/account', {
      key: address,
    });

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const response = result.value;

    // Check for API errors
    if (response.code !== 0) {
      const error = new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
      this.logger.error(
        `Failed to fetch raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
      );
      return err(error);
    }

    // Convert from smallest unit to main unit
    const balanceSmallest = response.data?.balance || '0';
    const balanceDecimal = convertToMainUnit(balanceSmallest, this.chainConfig.nativeDecimals);

    this.logger.debug(
      `Found raw balance for ${maskAddress(address)}: ${balanceDecimal} ${this.chainConfig.nativeCurrency}`
    );

    return ok(
      createRawBalanceData(
        balanceSmallest,
        balanceDecimal,
        this.chainConfig.nativeDecimals,
        this.chainConfig.nativeCurrency
      )
    );
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<SubstrateTransaction>[], Error>> {
    const { address } = params;

    // Validate address format
    if (!isValidSS58Address(address)) {
      return err(new Error(`Invalid SS58 address for ${this.blockchain}: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const transfers: SubscanTransferAugmented[] = [];
    let page = 0;
    const maxPages = 100; // Safety limit to prevent infinite loops
    const rowsPerPage = 100;
    let hasMorePages = true;

    while (hasMorePages && page < maxPages) {
      const body: Record<string, unknown> = {
        address: address,
        page: page,
        row: rowsPerPage,
      };

      const result = await this.httpClient.post<SubscanTransfersResponse>('/api/v2/scan/transfers', body);

      if (result.isErr()) {
        this.logger.error(
          `Failed to fetch raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
        );
        return err(result.error);
      }

      const response = result.value;

      // Check for API errors
      if (response.code !== 0) {
        const error = new Error(`Subscan API error: ${response.message || `Code ${response.code}`}`);
        this.logger.error(
          `Failed to fetch raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(error)}`
        );
        return err(error);
      }

      const pageTransfers = response.data?.transfers || [];

      // Augment transfers with chain config data
      const augmentedTransfers = augmentWithChainConfig(pageTransfers, this.chainConfig);

      transfers.push(...augmentedTransfers);
      page++;

      // Check if there are more pages
      // Subscan doesn't return a cursor, so we check if we got a full page
      hasMorePages = pageTransfers.length === rowsPerPage;

      this.logger.debug(
        `Fetched page ${page}: ${pageTransfers.length} transfers${hasMorePages ? ' (more pages available)' : ' (last page)'}`
      );

      // Safety check to prevent infinite pagination
      if (page >= maxPages) {
        this.logger.warn(`Reached maximum page limit (${maxPages}), stopping pagination`);
        break;
      }
    }

    // Normalize transactions using mapper
    const transactions: TransactionWithRawData<SubstrateTransaction>[] = [];
    for (const rawTx of transfers) {
      const mapResult = this.mapper.map(rawTx, { address });

      if (mapResult.isErr()) {
        const errorMessage = mapResult.error.type === 'error' ? mapResult.error.message : mapResult.error.reason;
        this.logger.error(`Provider data validation failed - Address: ${maskAddress(address)}, Error: ${errorMessage}`);
        return err(new Error(`Provider data validation failed: ${errorMessage}`));
      }

      transactions.push({
        raw: rawTx,
        normalized: mapResult.value,
      });
    }

    this.logger.debug(
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}, PagesProcessed: ${page}`
    );

    return ok(transactions);
  }
}
