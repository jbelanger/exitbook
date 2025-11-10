import { getErrorMessage, parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { ProviderConfig, ProviderOperation } from '../../../../core/index.js';
import { BaseApiClient, RegisterApiClient } from '../../../../core/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../core/types/index.js';
import { maskAddress } from '../../../../core/utils/address-utils.js';
import type { EvmTransaction } from '../../types.js';

import { mapThetaScanTransaction } from './thetascan.mapper-utils.js';
import type { ThetaScanTransaction, ThetaScanBalanceResponse, ThetaScanTokenBalance } from './thetascan.schemas.js';

@RegisterApiClient({
  apiKeyEnvVar: undefined,
  baseUrl: 'http://www.thetascan.io/api',
  blockchain: 'theta',
  capabilities: {
    supportedOperations: ['getAddressBalances', 'getAddressTransactions', 'getAddressTokenBalances'],
  },
  defaultConfig: {
    rateLimit: {
      burstLimit: 2,
      requestsPerHour: 3600,
      requestsPerMinute: 60,
      requestsPerSecond: 1.5,
    },
    retries: 3,
    timeout: 15000,
  },
  description: 'ThetaScan API for Theta blockchain transaction and balance data',
  displayName: 'ThetaScan',
  name: 'thetascan',
  requiresApiKey: false,
  supportedChains: ['theta'],
})
export class ThetaScanApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super(config);
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
      case 'getAddressTokenBalances':
        return (await this.getAddressTokenBalances({
          address: operation.address,
          contractAddresses: operation.contractAddresses,
        })) as Result<T, Error>;
      default:
        return err(new Error(`Unsupported operation: ${operation.type}`));
    }
  }

  getHealthCheckConfig() {
    return {
      endpoint: '/transactions/?address=0x0000000000000000000000000000000000000000',
      validate: (response: unknown) => {
        // ThetaScan should return some response structure even for empty address
        return response !== null && response !== undefined;
      },
    };
  }

  private async getNormalTransactions(address: string): Promise<Result<ThetaScanTransaction[], Error>> {
    const params = new URLSearchParams({
      address: address,
    });

    const url = `/transactions/?${params.toString()}`;
    this.logger.info(`ThetaScan API Request: ${this.baseUrl}${url}`);

    const result = await this.httpClient.get(url);

    if (result.isErr()) {
      this.logger.error(
        `Failed to fetch transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    // ThetaScan returns a direct array of transactions
    const transactions = result.value as ThetaScanTransaction[];

    this.logger.info(`Fetched ${Array.isArray(transactions) ? transactions.length : 0} transactions from ThetaScan`);

    return ok(Array.isArray(transactions) ? transactions : []);
  }

  private async getAddressBalances(params: { address: string }): Promise<Result<RawBalanceData, Error>> {
    const { address } = params;

    if (!this.isValidEthAddress(address)) {
      return err(new Error(`Invalid Theta address: ${address}`));
    }

    this.logger.debug(`Fetching raw address balance - Address: ${maskAddress(address)}`);

    const urlParams = new URLSearchParams({
      address: address,
    });

    const result = await this.httpClient.get(`/balance/?${urlParams.toString()}`);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address balance - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const balanceData = result.value as ThetaScanBalanceResponse;

    this.logger.debug(`Retrieved balance for ${maskAddress(address)}: ${balanceData.tfuel} TFUEL`);

    // ThetaScan API may return numbers instead of strings, ensure conversion
    const total = String(balanceData.tfuel || '0');

    return ok({
      rawAmount: total,
      decimals: 18,
      symbol: 'TFUEL',
    } as RawBalanceData);
  }

  private async getAddressTransactions(params: {
    address: string;
  }): Promise<Result<TransactionWithRawData<EvmTransaction>[], Error>> {
    const { address } = params;

    if (!this.isValidEthAddress(address)) {
      return err(new Error(`Invalid Theta address: ${address}`));
    }

    this.logger.debug(`Fetching raw address transactions - Address: ${maskAddress(address)}`);

    const result = await this.getNormalTransactions(address);

    if (result.isErr()) {
      this.logger.error(
        `Failed to get raw address transactions - Address: ${maskAddress(address)}, Error: ${getErrorMessage(result.error)}`
      );
      return err(result.error);
    }

    const rawTransactions = result.value;

    if (!Array.isArray(rawTransactions) || rawTransactions.length === 0) {
      this.logger.debug(`No raw transactions found - Address: ${maskAddress(address)}`);
      return ok([]);
    }

    const transactions: TransactionWithRawData<EvmTransaction>[] = [];
    for (const rawTx of rawTransactions) {
      const mapResult = mapThetaScanTransaction(rawTx, {});

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
      `Successfully retrieved and normalized transactions - Address: ${maskAddress(address)}, Count: ${transactions.length}`
    );
    return ok(transactions);
  }

  private async getAddressTokenBalances(params: {
    address: string;
    contractAddresses?: string[] | undefined;
  }): Promise<Result<RawBalanceData[], Error>> {
    const { address, contractAddresses } = params;

    if (!this.isValidEthAddress(address)) {
      return err(new Error(`Invalid Theta address: ${address}`));
    }

    this.logger.debug(`Fetching token balances - Address: ${maskAddress(address)}`);

    // If no contract addresses specified, we can't fetch balances (ThetaScan requires contract address)
    if (!contractAddresses || contractAddresses.length === 0) {
      this.logger.debug('No contract addresses provided, skipping token balance fetch');
      return ok([]);
    }

    const balances: RawBalanceData[] = [];

    // Fetch balance for each contract
    for (const contractAddress of contractAddresses) {
      const urlParams = new URLSearchParams({
        address: address,
        contract: contractAddress,
      });

      const result = await this.httpClient.get(`/contract/?${urlParams.toString()}`);

      if (result.isErr()) {
        this.logger.warn(
          `Failed to fetch balance for contract ${contractAddress} - Error: ${getErrorMessage(result.error)}`
        );
        // Continue with other contracts
        continue;
      }

      const balanceData = result.value as ThetaScanTokenBalance;

      if (balanceData) {
        // Convert to RawBalanceData format
        let balanceDecimal: string;
        if (balanceData.token_decimals !== undefined) {
          // Convert from smallest units to decimal
          balanceDecimal = parseDecimal(balanceData.balance?.toString() || '0')
            .div(parseDecimal('10').pow(balanceData.token_decimals))
            .toFixed();
        } else {
          // No decimals available, keep in smallest units
          balanceDecimal = String(balanceData.balance || '0');
        }

        balances.push({
          rawAmount: String(balanceData.balance || '0'),
          decimals: balanceData.token_decimals,
          decimalAmount: balanceDecimal,
          symbol: balanceData.token_symbol ?? undefined,
          contractAddress: balanceData.contract_address,
        });
      }
    }

    this.logger.debug(`Retrieved ${balances.length} token balances for ${maskAddress(address)}`);
    return ok(balances);
  }

  // Theta uses Ethereum-style addresses
  private isValidEthAddress(address: string): boolean {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
  }
}
