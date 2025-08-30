import { Decimal } from 'decimal.js';

import type { AvalancheTransaction, ClassificationResult, ValueFlow } from './types.ts';

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
  static classifyTransactionGroup(txGroup: AvalancheTransaction[], userAddress: string): ClassificationResult {
    const userAddr = userAddress.toLowerCase();
    const valueFlows = new Map<string, ValueFlow>();

    // Analyze token transfers first (highest priority)
    const tokenTransfers = txGroup.filter(tx => tx.type === 'token');
    if (tokenTransfers.length) {
      for (const token of tokenTransfers) {
        const symbol = token.symbol || 'UNKNOWN';
        const decimals = token.tokenDecimal || 18;
        const amount = new Decimal(token.value).dividedBy(new Decimal(10).pow(decimals));

        if (!valueFlows.has(symbol)) {
          valueFlows.set(symbol, {
            amountIn: '0',
            amountOut: '0',
            netFlow: '0',
            symbol,
          });
        }

        const flow = valueFlows.get(symbol)!;
        if (token.from.toLowerCase() === userAddr) {
          // User sending tokens
          flow.amountOut = new Decimal(flow.amountOut).plus(amount).toString();
        } else if (token.to.toLowerCase() === userAddr) {
          // User receiving tokens
          flow.amountIn = new Decimal(flow.amountIn).plus(amount).toString();
        }

        // Update net flow
        const netFlow = new Decimal(flow.amountIn).minus(flow.amountOut);
        flow.netFlow = netFlow.toString();
      }
    }

    // Analyze internal transactions (medium priority)
    const internalTransfers = txGroup.filter(tx => tx.type === 'internal');
    if (internalTransfers.length) {
      for (const internal of internalTransfers) {
        if (internal.value === '0') continue;

        const amount = new Decimal(internal.value).dividedBy(new Decimal(10).pow(18));
        if (!valueFlows.has('AVAX')) {
          valueFlows.set('AVAX', {
            amountIn: '0',
            amountOut: '0',
            netFlow: '0',
            symbol: 'AVAX',
          });
        }

        const flow = valueFlows.get('AVAX')!;
        if (internal.from.toLowerCase() === userAddr) {
          flow.amountOut = new Decimal(flow.amountOut).plus(amount).toString();
        } else if (internal.to.toLowerCase() === userAddr) {
          flow.amountIn = new Decimal(flow.amountIn).plus(amount).toString();
        }

        const netFlow = new Decimal(flow.amountIn).minus(flow.amountOut);
        flow.netFlow = netFlow.toString();
      }
    }

    // Analyze normal transaction (lowest priority, only if no other flows)
    const normalTx = txGroup.find(tx => tx.type === 'normal');
    if (valueFlows.size === 0 && normalTx && normalTx.value !== '0') {
      const amount = new Decimal(normalTx.value).dividedBy(new Decimal(10).pow(18));
      const flow: ValueFlow = {
        amountIn: '0',
        amountOut: '0',
        netFlow: '0',
        symbol: 'AVAX',
      };

      if (normalTx.from.toLowerCase() === userAddr) {
        flow.amountOut = amount.toString();
      } else if (normalTx.to.toLowerCase() === userAddr) {
        flow.amountIn = amount.toString();
      }

      flow.netFlow = new Decimal(flow.amountIn).minus(flow.amountOut).toString();
      valueFlows.set('AVAX', flow);
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
        type: 'transfer',
      };
    }

    // Find the flow with the largest absolute net amount (primary asset)
    let primaryFlow = flows[0];
    let maxAbsFlow = new Decimal(0);

    for (const flow of flows) {
      const absFlow = new Decimal(flow.netFlow).abs();
      if (absFlow.greaterThan(maxAbsFlow)) {
        maxAbsFlow = absFlow;
        primaryFlow = flow;
      }
    }

    // Determine type based on primary flow direction
    const primaryNetFlow = new Decimal(primaryFlow.netFlow);
    let type: 'deposit' | 'withdrawal' | 'transfer';
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
        flow => new Decimal(flow.amountIn).greaterThan(0) || new Decimal(flow.amountOut).greaterThan(0)
      );

      type = hasNonZeroFlows ? 'transfer' : 'transfer';
      reason = hasNonZeroFlows ? 'Net zero flow with asset movement (likely swap)' : 'No significant value movement';
    }

    // Build assets array
    const assets = flows
      .filter(flow => new Decimal(flow.amountIn).greaterThan(0) || new Decimal(flow.amountOut).greaterThan(0))
      .map(flow => {
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
