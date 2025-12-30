import { describe, it, expect } from 'vitest';

import {
  NearAccountIdSchema,
  NearActionSchema,
  NearBalanceChangeSchema,
  NearReceiptOutcomeSchema,
  NearReceiptSchema,
  NearTokenTransferSchema,
  NearTransactionSchema,
  NearReceiptEventSchema,
} from '../schemas.v2.js';

describe('NEAR V2 Schemas', () => {
  describe('NearAccountIdSchema', () => {
    it('should accept valid named accounts', () => {
      expect(NearAccountIdSchema.parse('alice.near')).toBe('alice.near');
      expect(NearAccountIdSchema.parse('sub.alice.near')).toBe('sub.alice.near');
    });

    it('should accept valid implicit accounts', () => {
      const implicitAccount = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(NearAccountIdSchema.parse(implicitAccount)).toBe(implicitAccount);
    });

    it('should accept system accounts', () => {
      expect(NearAccountIdSchema.parse('system')).toBe('system');
      expect(NearAccountIdSchema.parse('near')).toBe('near');
    });

    it('should reject empty strings', () => {
      expect(() => NearAccountIdSchema.parse('')).toThrow();
    });
  });

  describe('NearActionSchema', () => {
    it('should parse a transfer action', () => {
      const action = {
        actionType: 'transfer',
        attachedDeposit: '1000000000000000000000000',
      };

      const result = NearActionSchema.parse(action);
      expect(result.actionType).toBe('transfer');
      expect(result.attachedDeposit).toBe('1000000000000000000000000');
    });

    it('should parse a function call action', () => {
      const action = {
        actionType: 'function_call',
        methodName: 'ft_transfer',
        args: { receiver_id: 'bob.near', amount: '1000' },
        attachedDeposit: '1',
        gas: '30000000000000',
      };

      const result = NearActionSchema.parse(action);
      expect(result.actionType).toBe('function_call');
      expect(result.methodName).toBe('ft_transfer');
      expect(result.args).toEqual({ receiver_id: 'bob.near', amount: '1000' });
      expect(result.gas).toBe('30000000000000');
    });

    it('should parse a create account action', () => {
      const action = {
        actionType: 'create_account',
      };

      const result = NearActionSchema.parse(action);
      expect(result.actionType).toBe('create_account');
      expect(result.attachedDeposit).toBeUndefined();
    });

    it('should parse an add key action', () => {
      const action = {
        actionType: 'add_key',
        publicKey: 'ed25519:ABC123',
      };

      const result = NearActionSchema.parse(action);
      expect(result.actionType).toBe('add_key');
      expect(result.publicKey).toBe('ed25519:ABC123');
    });

    it('should parse a delete account action', () => {
      const action = {
        actionType: 'delete_account',
        beneficiaryId: 'alice.near',
      };

      const result = NearActionSchema.parse(action);
      expect(result.actionType).toBe('delete_account');
      expect(result.beneficiaryId).toBe('alice.near');
    });
  });

  describe('NearReceiptOutcomeSchema', () => {
    it('should parse a successful outcome', () => {
      const outcome = {
        status: true,
        gasBurnt: '2428000000000',
        tokensBurntYocto: '242800000000000000000',
        executorAccountId: 'alice.near',
        logs: ['Log message 1', 'Log message 2'],
      };

      const result = NearReceiptOutcomeSchema.parse(outcome);
      expect(result.status).toBe(true);
      expect(result.gasBurnt).toBe('2428000000000');
      expect(result.tokensBurntYocto).toBe('242800000000000000000');
      expect(result.executorAccountId).toBe('alice.near');
      expect(result.logs).toEqual(['Log message 1', 'Log message 2']);
    });

    it('should parse a failed outcome', () => {
      const outcome = {
        status: false,
        gasBurnt: '2428000000000',
        tokensBurntYocto: '242800000000000000000',
        executorAccountId: 'alice.near',
      };

      const result = NearReceiptOutcomeSchema.parse(outcome);
      expect(result.status).toBe(false);
      expect(result.logs).toBeUndefined();
    });

    it('should parse outcome without logs', () => {
      const outcome = {
        status: true,
        gasBurnt: '2428000000000',
        tokensBurntYocto: '242800000000000000000',
        executorAccountId: 'alice.near',
      };

      const result = NearReceiptOutcomeSchema.parse(outcome);
      expect(result.logs).toBeUndefined();
    });
  });

  describe('NearBalanceChangeSchema', () => {
    it('should parse a balance change with receipt ID', () => {
      const change = {
        accountId: 'alice.near',
        preBalance: '100000000000000000000000000',
        postBalance: '99000000000000000000000000',
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        blockTimestamp: 1234567890000,
      };

      const result = NearBalanceChangeSchema.parse(change);
      expect(result.accountId).toBe('alice.near');
      expect(result.preBalance).toBe('100000000000000000000000000');
      expect(result.postBalance).toBe('99000000000000000000000000');
      expect(result.receiptId).toBe('ABC123');
    });

    it('should parse a balance change without receipt ID', () => {
      const change = {
        accountId: 'alice.near',
        preBalance: '100000000000000000000000000',
        postBalance: '99000000000000000000000000',
        transactionHash: 'TX123',
        blockTimestamp: 1234567890000,
      };

      const result = NearBalanceChangeSchema.parse(change);
      expect(result.accountId).toBe('alice.near');
      expect(result.receiptId).toBeUndefined();
    });
  });

  describe('NearTokenTransferSchema', () => {
    it('should parse a token transfer', () => {
      const transfer = {
        contractId: 'usdt.tether-token.near',
        from: 'alice.near',
        to: 'bob.near',
        amount: '1000.50',
        decimals: 6,
        symbol: 'USDT',
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        blockTimestamp: 1234567890000,
      };

      const result = NearTokenTransferSchema.parse(transfer);
      expect(result.contractId).toBe('usdt.tether-token.near');
      expect(result.from).toBe('alice.near');
      expect(result.to).toBe('bob.near');
      expect(result.amount).toBe('1000.5');
      expect(result.decimals).toBe(6);
      expect(result.symbol).toBe('USDT');
    });

    it('should parse a token transfer without symbol', () => {
      const transfer = {
        contractId: 'token.near',
        from: 'alice.near',
        to: 'bob.near',
        amount: '1000',
        decimals: 18,
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        blockTimestamp: 1234567890000,
      };

      const result = NearTokenTransferSchema.parse(transfer);
      expect(result.symbol).toBeUndefined();
    });
  });

  describe('NearReceiptSchema', () => {
    it('should parse an ACTION receipt with actions and outcome', () => {
      const receipt = {
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        predecessorId: 'alice.near',
        receiverId: 'bob.near',
        receiptKind: 'ACTION' as const,
        blockHeight: 123456,
        blockHash: 'BLOCK123',
        blockTimestamp: 1234567890000,
        actions: [
          {
            actionType: 'transfer',
            attachedDeposit: '1000000000000000000000000',
          },
        ],
        outcome: {
          status: true,
          gasBurnt: '2428000000000',
          tokensBurntYocto: '242800000000000000000',
          executorAccountId: 'bob.near',
        },
      };

      const result = NearReceiptSchema.parse(receipt);
      expect(result.receiptId).toBe('ABC123');
      expect(result.receiptKind).toBe('ACTION');
      expect(result.actions).toHaveLength(1);
      expect(result.outcome?.status).toBe(true);
    });

    it('should parse a DATA receipt', () => {
      const receipt = {
        receiptId: 'DATA123',
        transactionHash: 'TX123',
        predecessorId: 'alice.near',
        receiverId: 'bob.near',
        receiptKind: 'DATA' as const,
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
      };

      const result = NearReceiptSchema.parse(receipt);
      expect(result.receiptKind).toBe('DATA');
      expect(result.actions).toBeUndefined();
    });

    it('should parse a REFUND receipt', () => {
      const receipt = {
        receiptId: 'REFUND123',
        transactionHash: 'TX123',
        predecessorId: 'system',
        receiverId: 'alice.near',
        receiptKind: 'REFUND' as const,
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
      };

      const result = NearReceiptSchema.parse(receipt);
      expect(result.receiptKind).toBe('REFUND');
    });

    it('should parse a receipt with balance changes', () => {
      const receipt = {
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        predecessorId: 'alice.near',
        receiverId: 'bob.near',
        receiptKind: 'ACTION' as const,
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
        balanceChanges: [
          {
            accountId: 'alice.near',
            preBalance: '100000000000000000000000000',
            postBalance: '99000000000000000000000000',
            blockTimestamp: 1234567890000,
          },
        ],
      };

      const result = NearReceiptSchema.parse(receipt);
      expect(result.balanceChanges).toHaveLength(1);
    });

    it('should parse a receipt with token transfers', () => {
      const receipt = {
        receiptId: 'ABC123',
        transactionHash: 'TX123',
        predecessorId: 'alice.near',
        receiverId: 'token.near',
        receiptKind: 'ACTION' as const,
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
        tokenTransfers: [
          {
            contractId: 'token.near',
            from: 'alice.near',
            to: 'bob.near',
            amount: '1000',
            decimals: 18,
            receiptId: 'ABC123',
            transactionHash: 'TX123',
            blockTimestamp: 1234567890000,
          },
        ],
      };

      const result = NearReceiptSchema.parse(receipt);
      expect(result.tokenTransfers).toHaveLength(1);
    });
  });

  describe('NearTransactionSchema', () => {
    it('should parse a transaction with single receipt', () => {
      const transaction = {
        transactionHash: 'TX123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        blockHeight: 123456,
        blockHash: 'BLOCK123',
        blockTimestamp: 1234567890000,
        actions: [
          {
            actionType: 'transfer',
            attachedDeposit: '1000000000000000000000000',
          },
        ],
        status: 'success' as const,
        receipts: [
          {
            receiptId: 'ABC123',
            transactionHash: 'TX123',
            predecessorId: 'alice.near',
            receiverId: 'bob.near',
            receiptKind: 'ACTION' as const,
            blockHeight: 123456,
            blockTimestamp: 1234567890000,
          },
        ],
        providerName: 'nearblocks',
      };

      const result = NearTransactionSchema.parse(transaction);
      expect(result.transactionHash).toBe('TX123');
      expect(result.signerId).toBe('alice.near');
      expect(result.status).toBe('success');
      expect(result.receipts).toHaveLength(1);
    });

    it('should parse a transaction with multiple receipts', () => {
      const transaction = {
        transactionHash: 'TX123',
        signerId: 'alice.near',
        receiverId: 'contract.near',
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
        actions: [
          {
            actionType: 'function_call',
            methodName: 'swap',
          },
        ],
        status: 'success' as const,
        receipts: [
          {
            receiptId: 'ABC123',
            transactionHash: 'TX123',
            predecessorId: 'alice.near',
            receiverId: 'contract.near',
            receiptKind: 'ACTION' as const,
            blockHeight: 123456,
            blockTimestamp: 1234567890000,
          },
          {
            receiptId: 'ABC124',
            transactionHash: 'TX123',
            predecessorId: 'contract.near',
            receiverId: 'token.near',
            receiptKind: 'ACTION' as const,
            blockHeight: 123456,
            blockTimestamp: 1234567890000,
          },
        ],
        providerName: 'nearblocks',
      };

      const result = NearTransactionSchema.parse(transaction);
      expect(result.receipts).toHaveLength(2);
    });

    it('should parse a failed transaction', () => {
      const transaction = {
        transactionHash: 'TX123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        blockHeight: 123456,
        blockTimestamp: 1234567890000,
        actions: [{ actionType: 'transfer' }],
        status: 'failed' as const,
        receipts: [],
        providerName: 'nearblocks',
      };

      const result = NearTransactionSchema.parse(transaction);
      expect(result.status).toBe('failed');
    });
  });

  describe('NearReceiptEventSchema', () => {
    it('should parse a receipt event with fee', () => {
      const event = {
        id: 'TX123',
        eventId: 'ABC123',
        receiptId: 'ABC123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        predecessorId: 'alice.near',
        receiptKind: 'ACTION' as const,
        actions: [
          {
            actionType: 'transfer',
            attachedDeposit: '1000000000000000000000000',
          },
        ],
        status: 'success' as const,
        gasBurnt: '2428000000000',
        tokensBurntYocto: '242800000000000000000',
        fee: {
          amountYocto: '242800000000000000000',
          payer: 'alice.near',
        },
        blockHeight: 123456,
        blockHash: 'BLOCK123',
        timestamp: 1234567890000,
        providerName: 'nearblocks',
      };

      const result = NearReceiptEventSchema.parse(event);
      expect(result.receiptId).toBe('ABC123');
      expect(result.fee?.amountYocto).toBe('242800000000000000000');
      expect(result.fee?.payer).toBe('alice.near');
    });

    it('should parse a receipt event without fee', () => {
      const event = {
        id: 'TX123',
        eventId: 'ABC123',
        receiptId: 'ABC123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        predecessorId: 'alice.near',
        receiptKind: 'ACTION' as const,
        status: 'success' as const,
        blockHeight: 123456,
        timestamp: 1234567890000,
        providerName: 'nearblocks',
      };

      const result = NearReceiptEventSchema.parse(event);
      expect(result.fee).toBeUndefined();
    });

    it('should parse a receipt event with balance changes', () => {
      const event = {
        id: 'TX123',
        eventId: 'ABC123',
        receiptId: 'ABC123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        predecessorId: 'alice.near',
        receiptKind: 'ACTION' as const,
        status: 'success' as const,
        blockHeight: 123456,
        timestamp: 1234567890000,
        balanceChanges: [
          {
            accountId: 'alice.near',
            preBalance: '100000000000000000000000000',
            postBalance: '99000000000000000000000000',
            blockTimestamp: 1234567890000,
          },
          {
            accountId: 'bob.near',
            preBalance: '50000000000000000000000000',
            postBalance: '51000000000000000000000000',
            blockTimestamp: 1234567890000,
          },
        ],
        providerName: 'nearblocks',
      };

      const result = NearReceiptEventSchema.parse(event);
      expect(result.balanceChanges).toHaveLength(2);
    });

    it('should parse a receipt event with token transfers', () => {
      const event = {
        id: 'TX123',
        eventId: 'ABC123',
        receiptId: 'ABC123',
        signerId: 'alice.near',
        receiverId: 'token.near',
        predecessorId: 'alice.near',
        receiptKind: 'ACTION' as const,
        status: 'success' as const,
        blockHeight: 123456,
        timestamp: 1234567890000,
        tokenTransfers: [
          {
            contractId: 'token.near',
            from: 'alice.near',
            to: 'bob.near',
            amount: '1000',
            decimals: 18,
            receiptId: 'ABC123',
            transactionHash: 'TX123',
            blockTimestamp: 1234567890000,
          },
        ],
        providerName: 'nearblocks',
      };

      const result = NearReceiptEventSchema.parse(event);
      expect(result.tokenTransfers).toHaveLength(1);
    });

    it('should parse a failed receipt event', () => {
      const event = {
        id: 'TX123',
        eventId: 'ABC123',
        receiptId: 'ABC123',
        signerId: 'alice.near',
        receiverId: 'bob.near',
        predecessorId: 'alice.near',
        receiptKind: 'ACTION' as const,
        status: 'failed' as const,
        tokensBurntYocto: '242800000000000000000',
        fee: {
          amountYocto: '242800000000000000000',
          payer: 'alice.near',
        },
        blockHeight: 123456,
        timestamp: 1234567890000,
        providerName: 'nearblocks',
      };

      const result = NearReceiptEventSchema.parse(event);
      expect(result.status).toBe('failed');
      expect(result.fee?.amountYocto).toBe('242800000000000000000');
    });
  });
});
