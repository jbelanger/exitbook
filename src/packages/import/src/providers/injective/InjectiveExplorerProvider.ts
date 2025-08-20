
import { BlockchainTransaction, InjectiveApiResponse, InjectiveTransaction, ProviderOperation } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';
import { BaseRegistryProvider } from '../registry/base-registry-provider.js';
import { RegisterProvider } from '../registry/decorators.js';


@RegisterProvider({
  name: 'injective-explorer',
  blockchain: 'injective',
  displayName: 'Injective Explorer API',
  type: 'rest',
  requiresApiKey: false,
  description: 'Direct connection to Injective Protocol blockchain explorer with comprehensive transaction data',
  capabilities: {
    supportedOperations: ['getAddressTransactions', 'getRawAddressTransactions'],
    maxBatchSize: 1,
    providesHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true
  },
  networks: {
    mainnet: {
      baseUrl: 'https://sentry.exchange.grpc-web.injective.network'
    },
    testnet: {
      baseUrl: 'https://k8s.testnet.tm.injective.network'
    }
  },
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 2,
      requestsPerMinute: 60,
      requestsPerHour: 500,
      burstLimit: 5
    }
  }
})
export class InjectiveExplorerProvider extends BaseRegistryProvider {
  private readonly INJECTIVE_DENOM = 'inj';

  constructor() {
    super('injective', 'injective-explorer', 'mainnet');

    this.logger.info('Initialized InjectiveExplorerProvider from registry metadata', {
      network: this.network,
      baseUrl: this.baseUrl
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test with a known address to check if the API is responsive
      const testAddress = 'inj1qq6hgelyft8z5fnm6vyyn3ge3w2nway4ykdf6a'; // Injective Foundation address
      const endpoint = `/api/explorer/v1/accountTxs/${testAddress}`;

      const response = await this.httpClient.get(endpoint);
      return response && typeof response === 'object';
    } catch (error) {
      this.logger.warn('Health check failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.isHealthy();
      this.logger.info('Connection test result', { healthy: result });
      return result;
    } catch (error) {
      this.logger.error('Connection test failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    this.logger.debug('Executing operation', {
      type: operation.type,
      address: operation.params?.address ? this.maskAddress(operation.params.address) : 'N/A'
    });

    try {
      switch (operation.type) {
        case 'getAddressTransactions':
          return this.getAddressTransactions(operation.params as { address: string; since?: number }) as T;
        case 'getRawAddressTransactions':
          return this.getRawAddressTransactions(operation.params as { address: string; since?: number }) as T;
        default:
          throw new Error(`Unsupported operation: ${operation.type}`);
      }
    } catch (error) {
      this.logger.error('Operation execution failed', {
        type: operation.type,
        params: operation.params,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private async getAddressTransactions(params: { address: string; since?: number }): Promise<BlockchainTransaction[]> {
    const { address, since } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug('Fetching address transactions', {
      address: this.maskAddress(address),
      since,
      network: this.network
    });

    try {
      const endpoint = `/api/explorer/v1/accountTxs/${address}`;
      const data = await this.httpClient.get(endpoint) as InjectiveApiResponse;

      if (!data.data || !Array.isArray(data.data)) {
        this.logger.debug('No transactions found in API response', {
          address: this.maskAddress(address),
          hasData: !!data.data
        });
        return [];
      }

      const transactions: BlockchainTransaction[] = [];

      for (const tx of data.data) {
        try {
          const blockchainTx = this.parseInjectiveTransaction(tx, address);

          // Skip transactions that are not relevant to our wallet
          if (!blockchainTx) {
            continue;
          }

          // Apply time filter if specified
          if (since && blockchainTx.timestamp < since) {
            continue;
          }

          transactions.push(blockchainTx);
        } catch (error) {
          this.logger.warn('Failed to parse transaction', {
            txHash: tx.hash || tx.id,
            error: error instanceof Error ? error.message : error
          });
        }
      }

      this.logger.info('Successfully retrieved address transactions', {
        address: this.maskAddress(address),
        totalTransactions: transactions.length,
        network: this.network
      });

      return transactions;

    } catch (error) {
      this.logger.error('Failed to get address transactions', {
        address: this.maskAddress(address),
        network: this.network,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async getRawAddressTransactions(params: { address: string; since?: number }): Promise<InjectiveTransaction[]> {
    const { address, since } = params;

    if (!this.validateAddress(address)) {
      throw new Error(`Invalid Injective address: ${address}`);
    }

    this.logger.debug('Fetching raw address transactions', {
      address: this.maskAddress(address),
      since,
      network: this.network
    });

    try {
      const endpoint = `/api/explorer/v1/accountTxs/${address}`;
      const data = await this.httpClient.get(endpoint) as InjectiveApiResponse;

      if (!data.data || !Array.isArray(data.data)) {
        return [];
      }

      let transactions = data.data;

      // Apply time filter if specified
      if (since) {
        transactions = transactions.filter(tx => {
          const timestamp = new Date(tx.block_timestamp).getTime();
          return timestamp >= since;
        });
      }

      this.logger.info('Successfully retrieved raw address transactions', {
        address: this.maskAddress(address),
        totalTransactions: transactions.length,
        network: this.network
      });

      return transactions;
    } catch (error) {
      this.logger.error('Failed to get raw address transactions', {
        address: this.maskAddress(address),
        network: this.network,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private validateAddress(address: string): boolean {
    // Injective addresses start with 'inj' and are bech32 encoded
    const injectiveAddressRegex = /^inj1[a-z0-9]{38}$/;
    return injectiveAddressRegex.test(address);
  }

  private parseInjectiveTransaction(tx: InjectiveTransaction, relevantAddress: string): BlockchainTransaction | null {
    const timestamp = new Date(tx.block_timestamp).getTime();

    // Extract transaction details from properly typed Injective transaction
    let value = createMoney(0, this.INJECTIVE_DENOM);
    let fee = createMoney(0, this.INJECTIVE_DENOM);
    let from = '';
    let to = '';
    let tokenSymbol = this.INJECTIVE_DENOM;

    // Parse fee from gas_fee field
    if (tx.gas_fee && tx.gas_fee.amount && Array.isArray(tx.gas_fee.amount) && tx.gas_fee.amount.length > 0) {
      // gas_fee.amount is an array of {denom, amount} objects
      const firstFee = tx.gas_fee.amount[0];
      if (firstFee && firstFee.amount && firstFee.denom) {
        fee = createMoney(
          parseDecimal(firstFee.amount).div(Math.pow(10, 18)).toNumber(),
          this.formatDenom(firstFee.denom)
        );
      }
    }

    // Parse messages to extract transfer information and determine relevance
    let isRelevantTransaction = false;
    let transactionType: 'transfer_in' | 'transfer_out' | 'transfer' = 'transfer';

    for (const message of tx.messages) {
      // Handle bank transfer messages
      if (message.type === '/cosmos.bank.v1beta1.MsgSend') {
        from = message.value.from_address || '';
        to = message.value.to_address || '';

        if (message.value.amount && message.value.amount.length > 0) {
          const transferAmount = message.value.amount[0];
          if (transferAmount) {
            value = createMoney(
              parseDecimal(transferAmount.amount).div(Math.pow(10, 18)).toNumber(),
              this.formatDenom(transferAmount.denom)
            );
            tokenSymbol = this.formatDenom(transferAmount.denom);
          }
        }

        // Determine if this transaction is relevant to our wallet
        if (to === relevantAddress && value.amount.toNumber() > 0) {
          // We are receiving funds - this is a transfer in
          isRelevantTransaction = true;
          transactionType = 'transfer_in';
        } else if (from === relevantAddress && value.amount.toNumber() > 0) {
          // We are sending funds - this is a transfer out
          isRelevantTransaction = true;
          transactionType = 'transfer_out';
        }
        break; // Use first transfer message
      }

      // Handle IBC transfer messages
      else if (message.type === '/ibc.applications.transfer.v1.MsgTransfer') {
        from = message.value.sender || '';
        to = message.value.receiver || '';

        if (message.value.token) {
          value = createMoney(
            parseDecimal(message.value.token.amount).div(Math.pow(10, 18)).toNumber(),
            this.formatDenom(message.value.token.denom)
          );
          tokenSymbol = this.formatDenom(message.value.token.denom);
        }

        // Determine if this transaction is relevant to our wallet
        if (to === relevantAddress && value.amount.toNumber() > 0) {
          // We are receiving funds - this is a transfer in
          isRelevantTransaction = true;
          transactionType = 'transfer_in';
        } else if (from === relevantAddress && value.amount.toNumber() > 0) {
          // We are sending funds - this is a transfer out
          isRelevantTransaction = true;
          transactionType = 'transfer_out';
        }
        break;
      }

      // Handle Peggy bridge deposit messages (when funds come from Ethereum)
      else if (message.type === '/injective.peggy.v1.MsgDepositClaim') {
        // This is typically an inbound deposit from Ethereum bridge
        const messageValue = message.value as any; // Type assertion for bridge-specific properties
        if (messageValue.ethereum_receiver === relevantAddress ||
          messageValue.injective_receiver === relevantAddress) {
          isRelevantTransaction = true;
          transactionType = 'transfer_in'; // Bridge deposits are incoming
          to = relevantAddress;

          // Extract amount from the deposit claim if available
          if (messageValue.amount && messageValue.token_contract) {
            value = createMoney(
              parseDecimal(messageValue.amount).div(Math.pow(10, 18)).toNumber(),
              'INJ' // or determine from token_contract
            );
            tokenSymbol = 'INJ';
          }
        }
      }
    }

    // Only return transactions that are relevant to our wallet
    if (!isRelevantTransaction) {
      this.logger.debug('Skipping irrelevant transaction', {
        hash: tx.hash,
        from: this.maskAddress(from),
        to: this.maskAddress(to),
        relevantAddress: this.maskAddress(relevantAddress),
        value: value.amount.toNumber()
      });
      return null;
    }

    return {
      hash: tx.hash,
      blockNumber: tx.block_number,
      blockHash: '', // Not provided in the API response
      timestamp,
      from,
      to,
      value,
      fee,
      gasUsed: tx.gas_used,
      gasPrice: tx.gas_fee && Array.isArray(tx.gas_fee.amount) && tx.gas_fee.amount.length > 0 ? (() => {
        const firstFee = tx.gas_fee.amount[0];
        if (firstFee && firstFee.amount && firstFee.denom) {
          return parseDecimal(firstFee.amount).div(tx.gas_used || 1).toNumber();
        }
        return 0;
      })() : 0,
      status: tx.code === 0 ? 'success' : 'failed',
      type: transactionType,
      tokenSymbol,
      confirmations: 1 // Simplified - would need current block height to calculate
    };
  }

  private formatDenom(denom: string | undefined): string {
    // Handle undefined/null denom
    if (!denom) {
      return 'INJ'; // Default to INJ for undefined denoms
    }

    // Convert denom to readable token symbol
    if (denom === 'inj' || denom === 'uinj') {
      return 'INJ';
    }

    // Handle other token denoms as needed
    return denom.toUpperCase();
  }

  private maskAddress(address: string): string {
    if (!address || address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}