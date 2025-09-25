import { Decimal } from 'decimal.js';

import type { UniversalBlockchainTransaction } from '../../../app/ports/raw-data-mappers.ts';

import type { ClassificationResult, ValueFlow } from './types.js';

// Avalanche address validation
export function isValidAvalancheAddress(address: string): boolean {
  // Avalanche C-Chain uses Ethereum-style addresses but they are case-sensitive
  const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
  return ethAddressRegex.test(address);
}

// Convert address to checksum (important for Avalanche case-sensitivity)
export function toChecksumAddress(address: string): string {
  // Basic implementation - in production you'd want to use a proper checksum library
  if (!isValidAvalancheAddress(address)) {
    throw new Error('Invalid Avalanche address format');
  }
  return address; // For now, return as-is, but in production implement proper checksumming
}

/**
 * Avalanche transaction utilities for correlation and smart classification
 */
export class AvalancheUtils {
  /**
   * Classifies a transaction group based on actual value flows
   */
  static classifyTransactionGroup(
    txGroup: UniversalBlockchainTransaction[],
    userAddress: string
  ): ClassificationResult {
    const userAddr = userAddress.toLowerCase();
    const valueFlows = new Map<string, ValueFlow>();

    // Analyze token transfers first (highest priority)
    const tokenTransfers = txGroup.filter((tx) => tx.type === 'token_transfer');
    if (tokenTransfers.length > 0) {
      for (const token of tokenTransfers) {
        // Only process tokens that directly involve the user
        const isUserSender = token.from.toLowerCase() === userAddr;
        const isUserReceiver = token.to.toLowerCase() === userAddr;

        if (!isUserSender && !isUserReceiver) {
          // Skip tokens that don't involve the user directly
          continue;
        }

        const symbol = token.tokenSymbol || token.currency || 'UNKNOWN';
        const decimals = token.tokenDecimals || 18;
        const amount = new Decimal(token.amount || '0').dividedBy(new Decimal(10).pow(decimals));

        // Skip zero amounts unless this is the only transaction
        if (amount.isZero() && tokenTransfers.length > 1) {
          continue;
        }

        if (!valueFlows.has(symbol)) {
          valueFlows.set(symbol, {
            amountIn: '0',
            amountOut: '0',
            netFlow: '0',
            symbol,
          });
        }

        const flow = valueFlows.get(symbol)!;
        if (isUserSender) {
          // User sending tokens
          flow.amountOut = new Decimal(flow.amountOut).plus(amount).toString();
        } else if (isUserReceiver) {
          // User receiving tokens
          flow.amountIn = new Decimal(flow.amountIn).plus(amount).toString();
        }

        // Update net flow
        const netFlow = new Decimal(flow.amountIn).minus(flow.amountOut);
        flow.netFlow = netFlow.toString();
      }
    }

    // Analyze internal transactions (medium priority)
    const internalTransfers = txGroup.filter((tx) => tx.type === 'internal');
    if (internalTransfers.length) {
      for (const internal of internalTransfers) {
        if (internal.amount === '0') continue;

        // Only process internal transactions that directly involve the user
        const isUserSender = internal.from.toLowerCase() === userAddr;
        const isUserReceiver = internal.to.toLowerCase() === userAddr;

        if (!isUserSender && !isUserReceiver) {
          // Skip internal transactions that don't involve the user directly
          continue;
        }

        const amount = new Decimal(internal.amount).dividedBy(new Decimal(10).pow(18));
        if (!valueFlows.has('AVAX')) {
          valueFlows.set('AVAX', {
            amountIn: '0',
            amountOut: '0',
            netFlow: '0',
            symbol: 'AVAX',
          });
        }

        const flow = valueFlows.get('AVAX')!;
        if (isUserSender) {
          flow.amountOut = new Decimal(flow.amountOut).plus(amount).toString();
        } else if (isUserReceiver) {
          flow.amountIn = new Decimal(flow.amountIn).plus(amount).toString();
        }

        const netFlow = new Decimal(flow.amountIn).minus(flow.amountOut);
        flow.netFlow = netFlow.toString();
      }
    }

    // Analyze normal transaction (lowest priority, only if no other flows)
    const normalTx = txGroup.find((tx) => tx.type === 'transfer');
    if (valueFlows.size === 0 && normalTx && normalTx.amount !== '0') {
      // Only process normal transactions that directly involve the user
      const isUserSender = normalTx.from.toLowerCase() === userAddr;
      const isUserReceiver = normalTx.to.toLowerCase() === userAddr;

      if (isUserSender || isUserReceiver) {
        const amount = new Decimal(normalTx.amount).dividedBy(new Decimal(10).pow(18));
        const flow: ValueFlow = {
          amountIn: '0',
          amountOut: '0',
          netFlow: '0',
          symbol: 'AVAX',
        };

        if (isUserSender) {
          flow.amountOut = amount.toString();
        } else if (isUserReceiver) {
          flow.amountIn = amount.toString();
        }

        flow.netFlow = new Decimal(flow.amountIn).minus(flow.amountOut).toString();
        valueFlows.set('AVAX', flow);
      }
    }

    // Determine overall classification based on value flows
    return this.determineClassificationFromFlows(Array.from(valueFlows.values()));
  }

  /**
   * Determines transaction type based on value flow analysis
   */
  private static determineClassificationFromFlows(flows: ValueFlow[]): ClassificationResult {
    if (flows.length === 0) {
      return {
        assets: [],
        primaryAmount: '0',
        primarySymbol: 'AVAX',
        reason: 'No value flows detected',
        type: 'fee',
      };
    }

    // Prefer non-AVAX tokens over AVAX (tokens are more important than gas)
    // Find the flow with the largest absolute net amount (primary asset)
    let primaryFlow = flows[0];
    if (!primaryFlow) {
      return {
        assets: [],
        primaryAmount: '0',
        primarySymbol: 'AVAX',
        reason: 'No primary flow available',
        type: 'fee',
      };
    }
    let maxAbsFlow = new Decimal(0);

    // First pass: look for non-AVAX flows with significant amounts
    for (const flow of flows) {
      const absFlow = new Decimal(flow.netFlow).abs();
      if (flow.symbol !== 'AVAX' && absFlow.greaterThan(0)) {
        if (absFlow.greaterThan(maxAbsFlow) || primaryFlow.symbol === 'AVAX') {
          maxAbsFlow = absFlow;
          primaryFlow = flow;
        }
      }
    }

    // Second pass: if no non-AVAX flows found, use AVAX flows
    if (primaryFlow.symbol === 'AVAX' || maxAbsFlow.isZero()) {
      for (const flow of flows) {
        const absFlow = new Decimal(flow.netFlow).abs();
        if (absFlow.greaterThan(maxAbsFlow)) {
          maxAbsFlow = absFlow;
          primaryFlow = flow;
        }
      }
    }

    // Determine type based on primary flow direction
    const primaryNetFlow = new Decimal(primaryFlow.netFlow);
    let type: 'deposit' | 'withdrawal' | 'trade' | 'fee';
    let reason: string;

    if (primaryNetFlow.greaterThan(0)) {
      type = 'deposit';
      reason = `Net inflow of ${primaryNetFlow.toString()} ${primaryFlow.symbol}`;
    } else if (primaryNetFlow.lessThan(0)) {
      type = 'withdrawal';
      reason = `Net outflow of ${primaryNetFlow.abs().toString()} ${primaryFlow.symbol}`;
    } else {
      // Check if there are any non-zero flows (could be a swap/exchange)
      const hasNonZeroFlows = flows.some(
        (flow) => new Decimal(flow.amountIn).greaterThan(0) || new Decimal(flow.amountOut).greaterThan(0)
      );

      if (hasNonZeroFlows) {
        type = 'trade';
        reason = 'Net zero flow with asset movement (swap/DeFi interaction)';
      } else {
        type = 'fee';
        reason = 'No asset movement (fee/gas payment only)';
      }
    }

    // Build assets array
    const assets = flows
      .filter((flow) => new Decimal(flow.amountIn).greaterThan(0) || new Decimal(flow.amountOut).greaterThan(0))
      .map((flow) => {
        const netFlow = new Decimal(flow.netFlow);
        return {
          amount: netFlow.abs().toString(),
          direction: netFlow.greaterThan(0) ? ('in' as const) : ('out' as const),
          symbol: flow.symbol,
        };
      });

    return {
      assets,
      primaryAmount: maxAbsFlow.toString(),
      primarySymbol: primaryFlow.symbol,
      reason,
      type,
    };
  }
}
