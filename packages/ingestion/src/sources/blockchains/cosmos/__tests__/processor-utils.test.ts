import type { CosmosChainConfig, CosmosTransaction } from '@exitbook/blockchain-providers';
import { describe, expect, it } from 'vitest';

import {
  isZero,
  toDecimal,
  deduplicateByEventId,
  analyzeFundFlowFromNormalized,
  determineOperationFromFundFlow,
} from '../processor-utils.js';
import type { CosmosFundFlow } from '../types.js';

const INJECTIVE_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ',
  nativeDecimals: 18,
};

const OSMOSIS_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'osmo',
  chainId: 'osmosis-1',
  chainName: 'osmosis',
  displayName: 'Osmosis',
  nativeCurrency: 'OSMO',
  nativeDecimals: 6,
};

const USER_ADDRESS = 'inj1user000000000000000000000000000000000';
const EXTERNAL_ADDRESS = 'inj1external0000000000000000000000000000';
const CONTRACT_ADDRESS = 'inj1contract0000000000000000000000000000';

describe('Cosmos Processor Utils', () => {
  const createTransaction = (overrides: Partial<CosmosTransaction> = {}): CosmosTransaction => ({
    amount: '0',
    currency: 'INJ',
    eventId: 'event1',
    from: USER_ADDRESS,
    id: 'tx1',
    providerName: 'injective-explorer',
    status: 'success' as const,
    timestamp: Date.now(),
    to: EXTERNAL_ADDRESS,
    ...overrides,
  });

  describe('isZero', () => {
    it('should return true for zero string', () => {
      expect(isZero('0')).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(isZero('')).toBe(true);
    });

    it('should return false for non-zero string', () => {
      expect(isZero('1000000000000000000')).toBe(false);
    });

    it('should return true for decimal zero', () => {
      expect(isZero('0.0')).toBe(true);
    });

    it('should return true for very small number', () => {
      expect(isZero('0.00000000000000000000000001')).toBe(false);
    });

    it('should handle malformed input gracefully', () => {
      expect(isZero('invalid')).toBe(true);
    });
  });

  describe('toDecimal', () => {
    it('should convert string to Decimal', () => {
      const result = toDecimal('1000000000000000000');
      expect(result.toFixed()).toBe('1000000000000000000');
    });

    it('should handle zero', () => {
      const result = toDecimal('0');
      expect(result.isZero()).toBe(true);
    });

    it('should handle empty string as zero', () => {
      const result = toDecimal('');
      expect(result.isZero()).toBe(true);
    });

    it('should handle decimal values', () => {
      const result = toDecimal('1.5');
      expect(result.toFixed()).toBe('1.5');
    });
  });

  describe('deduplicateByEventId', () => {
    it('should keep first occurrence of duplicate eventIds', () => {
      const transactions: CosmosTransaction[] = [
        createTransaction({
          amount: '1000',
          eventId: 'event1',
          id: 'tx1',
          providerName: 'provider1',
        }),
        createTransaction({
          amount: '2000',
          eventId: 'event1', // Duplicate
          id: 'tx2',
          providerName: 'provider2',
        }),
        createTransaction({
          amount: '3000',
          eventId: 'event2',
          id: 'tx2',
          providerName: 'provider3',
        }),
      ];

      const result = deduplicateByEventId(transactions);

      expect(result).toHaveLength(2);
      expect(result[0]?.eventId).toBe('event1');
      expect(result[0]?.amount).toBe('1000'); // First occurrence kept
      expect(result[1]?.eventId).toBe('event2');
    });

    it('should handle empty array', () => {
      const result = deduplicateByEventId([]);
      expect(result).toHaveLength(0);
    });

    it('should handle array with no duplicates', () => {
      const transactions: CosmosTransaction[] = [
        createTransaction({
          amount: '1000',
          eventId: 'event1',
          id: 'tx1',
          providerName: 'provider1',
        }),
        createTransaction({
          amount: '2000',
          eventId: 'event2',
          id: 'tx2',
          providerName: 'provider2',
        }),
      ];

      const result = deduplicateByEventId(transactions);
      expect(result).toHaveLength(2);
    });
  });

  describe('analyzeFundFlowFromNormalized', () => {
    it('should analyze incoming native transfer', () => {
      const transaction = createTransaction({
        amount: '1500000000000000000', // 1.5 INJ
        blockHeight: 100,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx123',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        to: USER_ADDRESS,
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.fromAddress).toBe(EXTERNAL_ADDRESS);
      expect(fundFlow.toAddress).toBe(USER_ADDRESS);
      expect(fundFlow.inflows).toHaveLength(1);
      expect(fundFlow.inflows[0]?.amount).toBe('1500000000000000000');
      expect(fundFlow.inflows[0]?.asset).toBe('INJ');
      expect(fundFlow.outflows).toHaveLength(0);
      expect(fundFlow.primary.amount).toBe('1500000000000000000');
      expect(fundFlow.primary.asset).toBe('INJ');
      expect(fundFlow.feeAmount).toBe('500000000000000');
      expect(fundFlow.feeCurrency).toBe('INJ');
      expect(fundFlow.hasBridgeTransfer).toBe(false);
      expect(fundFlow.hasIbcTransfer).toBe(false);
      expect(fundFlow.hasContractInteraction).toBe(false);
    });

    it('should analyze outgoing native transfer', () => {
      const transaction = createTransaction({
        amount: '2000000000000000000', // 2 INJ
        blockHeight: 101,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        id: 'tx456',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.fromAddress).toBe(USER_ADDRESS);
      expect(fundFlow.toAddress).toBe(EXTERNAL_ADDRESS);
      expect(fundFlow.inflows).toHaveLength(0);
      expect(fundFlow.outflows).toHaveLength(1);
      expect(fundFlow.outflows[0]?.amount).toBe('2000000000000000000');
      expect(fundFlow.outflows[0]?.asset).toBe('INJ');
    });

    it('should analyze self-transfer with both inflows and outflows', () => {
      const transaction = createTransaction({
        amount: '500000000000000000', // 0.5 INJ
        blockHeight: 102,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        id: 'tx789',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        to: USER_ADDRESS,
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.fromAddress).toBe(USER_ADDRESS);
      expect(fundFlow.toAddress).toBe(USER_ADDRESS);
      expect(fundFlow.inflows).toHaveLength(1);
      expect(fundFlow.outflows).toHaveLength(1);
      expect(fundFlow.inflows[0]?.amount).toBe('500000000000000000');
      expect(fundFlow.outflows[0]?.amount).toBe('500000000000000000');
    });

    it('should handle token transfers with metadata', () => {
      const transaction = createTransaction({
        amount: '1000000000', // 1000 USDT (normalized, 6 decimals)
        blockHeight: 103,
        currency: 'USDT',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx101',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: USER_ADDRESS,
        tokenAddress: 'inj1usdt000000000000000000000000000000000',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        tokenType: 'cw20',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.inflows).toHaveLength(1);
      expect(fundFlow.inflows[0]?.asset).toBe('USDT');
      expect(fundFlow.inflows[0]?.tokenAddress).toBe('inj1usdt000000000000000000000000000000000');
      expect(fundFlow.inflows[0]?.tokenDecimals).toBe(6);
      expect(fundFlow.hasContractInteraction).toBe(true);
    });

    it('should detect Peggy bridge transfer', () => {
      const transaction = createTransaction({
        amount: '1000000000000000000', // 1 INJ
        blockHeight: 200,
        bridgeType: 'peggy',
        ethereumReceiver: '0xuser000000000000000000000000000000000000',
        ethereumSender: '0xexternal00000000000000000000000000000000',
        eventNonce: '12345',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx301',
        messageType: '/injective.peggy.v1.MsgSendToInjective',
        to: USER_ADDRESS,
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.hasBridgeTransfer).toBe(true);
      expect(fundFlow.hasIbcTransfer).toBe(false);
      expect(fundFlow.bridgeType).toBe('peggy');
    });

    it('should detect IBC transfer', () => {
      const transaction = createTransaction({
        amount: '5000000', // 5 OSMO
        blockHeight: 202,
        bridgeType: 'ibc',
        currency: 'OSMO',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        from: EXTERNAL_ADDRESS,
        id: 'tx303',
        messageType: '/ibc.applications.transfer.v1.MsgTransfer',
        sourceChannel: 'channel-8',
        sourcePort: 'transfer',
        to: USER_ADDRESS,
        tokenType: 'ibc',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.hasBridgeTransfer).toBe(true);
      expect(fundFlow.hasIbcTransfer).toBe(true);
      expect(fundFlow.bridgeType).toBe('ibc');
      expect(fundFlow.sourceChain).toBe('ibc');
      expect(fundFlow.destinationChain).toBe('injective');
    });

    it('should handle zero amount transactions', () => {
      const transaction = createTransaction({
        amount: '0',
        blockHeight: 105,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        id: 'tx201',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        to: EXTERNAL_ADDRESS,
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.inflows).toHaveLength(0);
      expect(fundFlow.outflows).toHaveLength(0);
      expect(fundFlow.primary.amount).toBe('0');
    });

    it('should use native currency from chain config when currency is undefined', () => {
      const transaction = createTransaction({
        amount: '5000000', // 5 OSMO
        blockHeight: 301,
        currency: 'OSMO',
        feeAmount: '1000',
        feeCurrency: 'OSMO',
        from: EXTERNAL_ADDRESS,
        id: 'tx402',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        providerName: 'mintscan',
        to: 'osmo1user000000000000000000000000000000000',
        tokenType: 'native',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        {
          primaryAddress: 'osmo1user000000000000000000000000000000000',
          userAddresses: ['osmo1user000000000000000000000000000000000'],
        },
        OSMOSIS_CONFIG
      );

      expect(fundFlow.primary.asset).toBe('OSMO');
      expect(fundFlow.feeCurrency).toBe('OSMO');
    });

    it('should handle contract interaction', () => {
      const transaction = createTransaction({
        amount: '0',
        blockHeight: 107,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        id: 'tx203',
        messageType: '/cosmwasm.wasm.v1.MsgExecuteContract',
        to: CONTRACT_ADDRESS,
        tokenAddress: 'inj1contract0000000000000000000000000000',
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.hasContractInteraction).toBe(true);
    });

    it('should handle missing fee data gracefully', () => {
      const transaction = createTransaction({
        amount: '1000000000000000000',
        blockHeight: 402,
        from: EXTERNAL_ADDRESS,
        id: 'tx503',
        messageType: '/cosmos.bank.v1beta1.MsgSend',
        to: USER_ADDRESS,
        tokenType: 'native',
        // No feeAmount field
      });

      const fundFlow = analyzeFundFlowFromNormalized(
        transaction,
        { primaryAddress: USER_ADDRESS, userAddresses: [USER_ADDRESS] },
        INJECTIVE_CONFIG
      );

      expect(fundFlow.feeAmount).toBe('0');
      expect(fundFlow.feeCurrency).toBe('INJ');
    });
  });

  describe('determineOperationFromFundFlow', () => {
    it('should classify simple deposit', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: EXTERNAL_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [{ amount: '1500000000000000000', asset: 'INJ' }],
        outflows: [],
        primary: { amount: '1500000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('deposit');
      expect(classification.notes).toBeUndefined();
    });

    it('should classify simple withdrawal', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [],
        outflows: [{ amount: '2000000000000000000', asset: 'INJ' }],
        primary: { amount: '2000000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: EXTERNAL_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('withdrawal');
      expect(classification.notes).toBeUndefined();
    });

    it('should classify self-transfer', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [{ amount: '500000000000000000', asset: 'INJ' }],
        outflows: [{ amount: '500000000000000000', asset: 'INJ' }],
        primary: { amount: '500000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('transfer');
      expect(classification.notes).toBeUndefined();
    });

    it('should classify fee-only transaction', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [],
        outflows: [],
        primary: { amount: '0', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: EXTERNAL_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('fee');
      expect(classification.operation.type).toBe('fee');
    });

    it('should classify contract interaction with zero value', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: true,
        hasIbcTransfer: false,
        inflows: [],
        outflows: [],
        primary: { amount: '0', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: CONTRACT_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('transfer');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('contract_interaction');
      expect(classification.notes?.[0]?.message).toContain('Contract interaction');
      expect(classification.notes?.[0]?.message).toContain('zero value');
    });

    it('should classify Peggy bridge deposit', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: 'peggy',
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: EXTERNAL_ADDRESS,
        hasBridgeTransfer: true,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [{ amount: '1000000000000000000', asset: 'INJ' }],
        outflows: [],
        primary: { amount: '1000000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('deposit');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('bridge_transfer');
      expect(classification.notes?.[0]?.message).toContain('Peggy bridge from Ethereum');
    });

    it('should classify Peggy bridge withdrawal', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: 'peggy',
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: true,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [],
        outflows: [{ amount: '2000000000000000000', asset: 'INJ' }],
        primary: { amount: '2000000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: EXTERNAL_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('withdrawal');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('bridge_transfer');
      expect(classification.notes?.[0]?.message).toContain('Peggy bridge to Ethereum');
    });

    it('should classify IBC transfer deposit', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: 'ibc',
        destinationChain: 'injective',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: EXTERNAL_ADDRESS,
        hasBridgeTransfer: true,
        hasContractInteraction: false,
        hasIbcTransfer: true,
        inflows: [{ amount: '5000000', asset: 'OSMO' }],
        outflows: [],
        primary: { amount: '5000000', asset: 'OSMO' },
        sourceChain: 'ibc',
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('deposit');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('bridge_transfer');
      expect(classification.notes?.[0]?.message).toContain('IBC transfer from another chain');
    });

    it('should classify IBC transfer withdrawal', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: 'ibc',
        destinationChain: 'injective',
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: true,
        hasContractInteraction: false,
        hasIbcTransfer: true,
        inflows: [],
        outflows: [{ amount: '3000000', asset: 'OSMO' }],
        primary: { amount: '3000000', asset: 'OSMO' },
        sourceChain: 'ibc',
        toAddress: EXTERNAL_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('withdrawal');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('bridge_transfer');
      expect(classification.notes?.[0]?.message).toContain('IBC transfer to another chain');
    });

    it('should classify single asset swap', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [{ amount: '1000000000', asset: 'USDT' }],
        outflows: [{ amount: '500000000000000000', asset: 'INJ' }],
        primary: { amount: '500000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('trade');
      expect(classification.operation.type).toBe('swap');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('swap');
      expect(classification.notes?.[0]?.message).toContain('Asset swap');
      expect(classification.notes?.[0]?.message).toContain('INJ');
      expect(classification.notes?.[0]?.message).toContain('USDT');
    });

    it('should handle complex multi-asset transaction with uncertainty', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        classificationUncertainty:
          'Complex transaction with 2 outflow(s) and 2 inflow(s). May be multi-asset operation.',
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [
          { amount: '1000000000', asset: 'USDT' },
          { amount: '2000000000', asset: 'USDC' },
        ],
        outflows: [
          { amount: '500000000000000000', asset: 'INJ' },
          { amount: '3000000000', asset: 'ATOM' },
        ],
        primary: { amount: '500000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('transfer');
      expect(classification.notes).toBeDefined();
      expect(classification.notes?.[0]?.type).toBe('classification_uncertain');
      expect(classification.notes?.[0]?.message).toContain('Complex transaction');
      expect(classification.notes?.[0]?.metadata).toHaveProperty('inflows');
      expect(classification.notes?.[0]?.metadata).toHaveProperty('outflows');
    });

    it('should fallback to transfer for unmatched patterns', () => {
      const fundFlow: CosmosFundFlow = {
        bridgeType: undefined,
        destinationChain: undefined,
        feeAmount: '500000000000000',
        feeCurrency: 'INJ',
        fromAddress: USER_ADDRESS,
        hasBridgeTransfer: false,
        hasContractInteraction: false,
        hasIbcTransfer: false,
        inflows: [
          { amount: '1000000000', asset: 'USDT' },
          { amount: '2000000000', asset: 'USDT' },
        ],
        outflows: [{ amount: '500000000000000000', asset: 'INJ' }],
        primary: { amount: '500000000000000000', asset: 'INJ' },
        sourceChain: undefined,
        toAddress: USER_ADDRESS,
      };

      const classification = determineOperationFromFundFlow(fundFlow);

      expect(classification.operation.category).toBe('transfer');
      expect(classification.operation.type).toBe('transfer');
    });
  });
});
