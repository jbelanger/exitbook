import { describe, expect, it } from 'vitest';

import {
  mapEtherscanNormalTransactionToEvmTransaction,
  mapEtherscanTokenTransactionToEvmTransaction,
  mapEtherscanWithdrawalToEvmTransaction,
  parseEtherscanWithdrawalResponse,
} from '../etherscan.mapper-utils.js';
import type {
  EtherscanBeaconWithdrawal,
  EtherscanNormalTransaction,
  EtherscanTokenTransaction,
} from '../etherscan.schemas.js';

const NORMAL_TX_BASE: EtherscanNormalTransaction = {
  blockNumber: '19000000',
  timeStamp: '1700000000',
  hash: '0xnormal',
  nonce: '1',
  blockHash: '0xblock',
  transactionIndex: '3',
  from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  value: '15500000000000000000',
  gas: '21000',
  gasPrice: '1000000000',
  isError: '0',
  txreceipt_status: '1',
  input: '0xd0e30db0',
  contractAddress: '',
  cumulativeGasUsed: '21000',
  gasUsed: '21000',
  confirmations: '10',
  methodId: '0xd0e30db0',
  functionName: 'deposit()',
};

const TOKEN_TX_BASE: EtherscanTokenTransaction = {
  blockNumber: '19000000',
  timeStamp: '1700000000',
  hash: '0xtoken',
  nonce: '1',
  blockHash: '0xblock',
  from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  to: '0x1111111111111111111111111111111111111111',
  value: '25000000',
  tokenName: 'USD Coin',
  tokenSymbol: 'USDC',
  tokenDecimal: '6',
  transactionIndex: '7',
  gas: '100000',
  gasPrice: '1000000000',
  gasUsed: '75000',
  cumulativeGasUsed: '75000',
  input: 'deprecated',
  methodId: '0x6fd3504e',
  functionName: 'depositForBurn(uint256 _amount,uint32 _destinationDomain,bytes32 _mintRecipient,address _burnToken)',
  confirmations: '10',
};

describe('etherscan/mapper-utils', () => {
  describe('mapEtherscanNormalTransactionToEvmTransaction', () => {
    it('preserves decoded method cues for contract calls', () => {
      const result = mapEtherscanNormalTransactionToEvmTransaction(NORMAL_TX_BASE);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.methodId).toBe('0xd0e30db0');
        expect(result.value.functionName).toBe('deposit()');
        expect(result.value.inputData).toBe('0xd0e30db0');
      }
    });

    it('does not preserve the 0x pseudo-method on plain transfers', () => {
      const result = mapEtherscanNormalTransactionToEvmTransaction({
        ...NORMAL_TX_BASE,
        input: '0x',
        methodId: '0x',
        functionName: '',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.methodId).toBeUndefined();
        expect(result.value.functionName).toBeUndefined();
        expect(result.value.inputData).toBeUndefined();
      }
    });
  });

  describe('mapEtherscanTokenTransactionToEvmTransaction', () => {
    it('preserves parent transaction method cues on token transfer rows', () => {
      const result = mapEtherscanTokenTransactionToEvmTransaction(TOKEN_TX_BASE);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.methodId).toBe('0x6fd3504e');
        expect(result.value.functionName).toBe(
          'depositForBurn(uint256 _amount,uint32 _destinationDomain,bytes32 _mintRecipient,address _burnToken)'
        );
        expect(result.value.inputData).toBeUndefined();
      }
    });
  });

  describe('mapEtherscanWithdrawalToEvmTransaction', () => {
    it('should convert Gwei to Wei correctly', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '12345',
        validatorIndex: '67890',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000', // 1 ETH in Gwei
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        // 1 ETH in Gwei = 1,000,000,000 Gwei
        // 1,000,000,000 Gwei * 10^9 = 1,000,000,000,000,000,000 Wei = 1 ETH
        expect(tx.amount).toBe('1000000000000000000');
      }
    });

    it('should preserve withdrawal metadata fields', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '98765',
        validatorIndex: '43210',
        address: '0xabc123def456789012345678901234567890abcd',
        amount: '500000000', // 0.5 ETH in Gwei
        blockNumber: '17600000',
        timestamp: '1681400000',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.withdrawalIndex).toBe('98765');
        expect(tx.validatorIndex).toBe('43210');
      }
    });

    it('should set correct transaction type and status', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '32000000000', // 32 ETH in Gwei
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.type).toBe('beacon_withdrawal');
        expect(tx.status).toBe('success');
        expect(tx.tokenType).toBe('native');
      }
    });

    it('should set fees to zero', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.feeAmount).toBe('0');
        expect(tx.gasPrice).toBe('0');
        expect(tx.gasUsed).toBe('0');
      }
    });

    it('should normalize recipient address to lowercase', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0xABC123DEF456789012345678901234567890ABCD',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.to).toBe('0xabc123def456789012345678901234567890abcd');
      }
    });

    it('should set from address to beacon chain address', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.from).toBe('0x0000000000000000000000000000000000000000');
      }
    });

    it('should convert timestamp from seconds to milliseconds', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479', // Unix timestamp in seconds
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.timestamp).toBe(1681338479000); // Should be in milliseconds
      }
    });

    it('should set blockHeight correctly', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.blockHeight).toBe(17500000);
      }
    });

    it('should create synthetic transaction ID with withdrawal index', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '99999',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.id).toBe('beacon-withdrawal-99999');
      }
    });

    it('should handle small withdrawal amounts correctly', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1', // 1 Gwei = 0.000000001 ETH
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.amount).toBe('1000000000'); // 1 Gwei = 1,000,000,000 Wei
      }
    });

    it('should handle large withdrawal amounts correctly', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '100000000000', // 100 ETH in Gwei
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        // 100 ETH in Gwei * 10^9 = 100 ETH in Wei
        expect(tx.amount).toBe('100000000000000000000');
      }
    });

    it('should set custom native currency', () => {
      const rawWithdrawal: EtherscanBeaconWithdrawal = {
        withdrawalIndex: '1',
        validatorIndex: '2',
        address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
        amount: '1000000000',
        blockNumber: '17500000',
        timestamp: '1681338479',
      };

      const result = mapEtherscanWithdrawalToEvmTransaction(rawWithdrawal, 'CUSTOM');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const tx = result.value;
        expect(tx.currency).toBe('CUSTOM');
        expect(tx.feeCurrency).toBe('CUSTOM');
      }
    });
  });

  describe('parseEtherscanWithdrawalResponse', () => {
    it('should parse successful response with withdrawals', () => {
      const response = {
        status: '1',
        message: 'OK',
        result: [
          {
            withdrawalIndex: '1',
            validatorIndex: '2',
            address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
            amount: '1000000000',
            blockNumber: '17500000',
            timestamp: '1681338479',
          },
          {
            withdrawalIndex: '2',
            validatorIndex: '3',
            address: '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913',
            amount: '2000000000',
            blockNumber: '17500100',
            timestamp: '1681339000',
          },
        ],
      };

      const result = parseEtherscanWithdrawalResponse(response);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.withdrawalIndex).toBe('1');
        expect(result.value[1]?.withdrawalIndex).toBe('2');
      }
    });

    it('should handle empty result array', () => {
      const response = {
        status: '1',
        message: 'OK',
        result: [],
      };

      const result = parseEtherscanWithdrawalResponse(response);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should handle "No transactions found" message', () => {
      const response = {
        status: '0',
        message: 'No transactions found',
        result: 'No transactions found',
      };

      const result = parseEtherscanWithdrawalResponse(response);

      // "No transactions found" should be treated as success with empty array
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should handle API errors', () => {
      const response = {
        status: '0',
        message: 'NOTOK',
        result: 'Invalid API Key',
      };

      const result = parseEtherscanWithdrawalResponse(response);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid API Key');
      }
    });

    it('should handle invalid response structure', () => {
      const response = {
        status: '1',
        message: 'OK',
        result: 'not an array',
      };

      const result = parseEtherscanWithdrawalResponse(response);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('array');
      }
    });

    it('should handle malformed JSON response', () => {
      const response = {
        invalidField: 'value',
      };

      const result = parseEtherscanWithdrawalResponse(response);

      expect(result.isErr()).toBe(true);
    });

    it('should handle null response', () => {
      // eslint-disable-next-line unicorn/no-null -- needed for test
      const result = parseEtherscanWithdrawalResponse(null);

      expect(result.isErr()).toBe(true);
    });

    it('should handle undefined response', () => {
      const result = parseEtherscanWithdrawalResponse(undefined);

      expect(result.isErr()).toBe(true);
    });
  });
});
