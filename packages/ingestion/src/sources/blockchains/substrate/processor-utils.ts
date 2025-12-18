import type { SubstrateChainConfig, SubstrateTransaction } from '@exitbook/blockchain-providers';
import { derivePolkadotAddressVariants } from '@exitbook/blockchain-providers';
import type { OperationClassification } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ProcessingContext } from '../../../shared/types/processors.js';

import type { SubstrateFundFlow, SubstrateMovement } from './types.js';

/**
 * Enrich session context with SS58 address variants for better transaction matching.
 * Similar to Bitcoin's derived address approach but for Substrate/Polkadot ecosystem.
 *
 * Pure function that generates all possible SS58 format variations of a Substrate address.
 * Different chains use different SS58 formats (Polkadot: 0, Kusama: 2, Generic: 42),
 * but the same public key underlies all variants. This allows matching transactions
 * across different format representations.
 *
 * @param address - The user's Substrate address (in any SS58 format)
 * @returns Session context with original address and all derived SS58 variants
 */
export function enrichSourceContext(address: string): Result<Record<string, unknown>, string> {
  if (!address) {
    return err('Missing address for Substrate session context enrichment');
  }

  // Generate SS58 address variants for all addresses
  const allDerivedAddresses: string[] = [];

  const variants = derivePolkadotAddressVariants(address);
  allDerivedAddresses.push(...variants);

  const uniqueDerivedAddresses = Array.from(new Set(allDerivedAddresses));

  return ok({
    address: address,
    derivedAddresses: uniqueDerivedAddresses,
  });
}

/**
 * Analyze fund flow from normalized Substrate transaction data.
 * Following EVM's comprehensive asset collection approach.
 *
 * Pure function that examines a Substrate transaction and determines:
 * - All inflows (assets received by the user)
 * - All outflows (assets sent by the user)
 * - Primary asset (main movement for simplified display)
 * - Transaction characteristics (staking, governance, utility batch, etc.)
 * - Network fees
 *
 * @param transaction - The normalized Substrate transaction
 * @param sessionContext - Session metadata including user addresses and derived variants
 * @param chainConfig - Chain-specific configuration (decimals, currency, etc.)
 * @returns Fund flow analysis with all movements and metadata
 */
export function analyzeFundFlowFromNormalized(
  transaction: SubstrateTransaction,
  context: ProcessingContext,
  chainConfig: SubstrateChainConfig
): Result<SubstrateFundFlow, Error> {
  const userAddresses = new Set(context.userAddresses);

  const isFromUser = userAddresses.has(transaction.from);
  const isToUser = userAddresses.has(transaction.to);

  // Analyze transaction characteristics
  const hasStaking =
    transaction.module === 'staking' ||
    transaction.call?.includes('bond') ||
    transaction.call?.includes('nominate') ||
    transaction.call?.includes('unbond') ||
    transaction.call?.includes('withdraw');

  const hasGovernance =
    transaction.module === 'democracy' ||
    transaction.module === 'council' ||
    transaction.module === 'treasury' ||
    transaction.module === 'phragmenElection';

  const hasUtilityBatch = transaction.module === 'utility' && transaction.call?.includes('batch');
  const hasProxy = transaction.module === 'proxy';
  const hasMultisig = transaction.module === 'multisig';

  // Collect ALL asset movements (most Substrate transactions are single-asset, but support multi-asset)
  const inflows: SubstrateMovement[] = [];
  const outflows: SubstrateMovement[] = [];

  const amount = parseDecimal(transaction.amount);
  const normalizedAmountResult = normalizeAmount(transaction.amount, chainConfig.nativeDecimals);
  const currency = transaction.currency;

  // Skip zero amounts (but NOT fees)
  const isZeroAmount = amount.isZero();

  // Handle normalization failure
  if (normalizedAmountResult.isErr()) {
    return err(
      new Error(
        `Failed to normalize Substrate transaction amount for tx ${transaction.id}: ${normalizedAmountResult.error.message}. ` +
          `Raw amount: ${transaction.amount}, decimals: ${chainConfig.nativeDecimals}, chain: ${transaction.chainName}`
      )
    );
  }

  const normalizedAmount = normalizedAmountResult.value;

  // Collect movements based on fund flow direction
  if (isFromUser && isToUser) {
    // Self-transfer: same asset in and out (net zero for asset, only fee affects balance)
    if (!isZeroAmount) {
      inflows.push({ amount: normalizedAmount, asset: currency });
      outflows.push({ amount: normalizedAmount, asset: currency });
    }
  } else if (isToUser && !isZeroAmount) {
    // User received funds
    inflows.push({ amount: normalizedAmount, asset: currency });
  } else if (isFromUser && !isZeroAmount) {
    // User sent funds
    outflows.push({ amount: normalizedAmount, asset: currency });
  }

  // Determine primary asset (for simplified consumption and single-asset display)
  let primaryAmount: string;
  let primaryAsset: string;

  if (outflows.length > 0) {
    // Primary is what user sent
    primaryAmount = outflows[0]!.amount;
    primaryAsset = outflows[0]!.asset;
  } else if (inflows.length > 0) {
    // Primary is what user received
    primaryAmount = inflows[0]!.amount;
    primaryAsset = inflows[0]!.asset;
  } else {
    // No movements (fee-only transaction)
    primaryAmount = '0';
    primaryAsset = currency;
  }

  // Track uncertainty for complex transactions
  let classificationUncertainty: string | undefined;
  if (hasUtilityBatch && transaction.events && transaction.events.length > 5) {
    classificationUncertainty = `Utility batch with ${transaction.events.length} events. May contain multiple operations that need separate accounting.`;
  }

  // Normalize fee amount with error handling
  const feeAmountResult = normalizeAmount(transaction.feeAmount, chainConfig.nativeDecimals);
  if (feeAmountResult.isErr()) {
    return err(
      new Error(
        `Failed to normalize Substrate fee amount for tx ${transaction.id}: ${feeAmountResult.error.message}. ` +
          `Raw amount: ${transaction.feeAmount}, decimals: ${chainConfig.nativeDecimals}, chain: ${transaction.chainName}`
      )
    );
  }
  const feeAmount = feeAmountResult.value;

  return ok({
    call: transaction.call || 'unknown',
    chainName: transaction.chainName || 'unknown',
    classificationUncertainty,
    eventCount: transaction.events?.length || 0,
    extrinsicCount: hasUtilityBatch ? 1 : 1, // TODO: Parse batch details if needed
    feeAmount,
    feeCurrency: transaction.feeCurrency || transaction.currency,
    fromAddress: transaction.from,
    hasGovernance: hasGovernance || false,
    hasMultisig: hasMultisig || false,
    hasProxy: hasProxy || false,
    hasStaking: hasStaking || false,
    hasUtilityBatch: hasUtilityBatch || false,
    inflows,
    module: transaction.module || 'unknown',
    outflows,
    primary: {
      amount: primaryAmount,
      asset: primaryAsset,
    },
    toAddress: transaction.to,
  });
}

/**
 * Conservative operation classification with uncertainty tracking.
 * Following EVM's 9/10 confidence approach, with Substrate-specific patterns first.
 *
 * Pure function that applies pattern matching rules to classify transactions.
 * Only classifies patterns we're confident about - complex cases receive informational notes.
 *
 * Pattern matching rules:
 * 1. Staking operations (9/10 confident)
 * 2. Governance operations (9/10 confident)
 * 3. Utility batch (complex - add uncertainty note)
 * 4. Proxy operations (add note)
 * 5. Multisig operations (add note)
 * 6. Fee-only transaction (no asset movements)
 * 7. Simple deposit (only inflows)
 * 8. Simple withdrawal (only outflows)
 * 9. Self-transfer (same asset in and out)
 * 10. Unknown/complex transaction
 *
 * @param fundFlow - The analyzed fund flow
 * @param transaction - The original normalized transaction
 * @returns Operation classification with optional uncertainty notes
 */
export function determineOperationFromFundFlow(
  fundFlow: SubstrateFundFlow,
  transaction: SubstrateTransaction
): OperationClassification {
  const { inflows, outflows } = fundFlow;
  const amount = parseDecimal(fundFlow.primary.amount || '0').abs();
  const isZeroAmount = amount.isZero();

  // Pattern 1: Staking operations (9/10 confident)
  if (fundFlow.hasStaking) {
    // Unbond and withdraw are always withdrawals, regardless of flow direction
    if (transaction.call?.includes('unbond') || transaction.call?.includes('withdraw')) {
      return {
        operation: {
          category: 'staking',
          type: 'unstake',
        },
      };
    }

    // Bond operations - check flow direction
    if (transaction.call?.includes('bond')) {
      if (outflows.length > 0) {
        return {
          operation: {
            category: 'staking',
            type: 'stake',
          },
        };
      } else {
        // Incoming bond (reward)
        return {
          operation: {
            category: 'staking',
            type: 'reward',
          },
        };
      }
    }

    // Nominate and chill are staking operations (no funds move)
    if (transaction.call?.includes('nominate') || transaction.call?.includes('chill')) {
      return {
        notes: [
          {
            message: `Staking operation (${transaction.call}) with no fund movement. Changes validator selection but doesn't affect balance.`,
            metadata: {
              call: transaction.call,
              module: fundFlow.module,
            },
            severity: 'info',
            type: 'staking_operation',
          },
        ],
        operation: {
          category: 'staking',
          type: 'stake',
        },
      };
    }

    // Default staking behavior based on fund flow
    if (outflows.length > 0) {
      return {
        operation: {
          category: 'staking',
          type: 'stake',
        },
      };
    } else if (inflows.length > 0) {
      return {
        operation: {
          category: 'staking',
          type: 'reward',
        },
      };
    }

    // Staking transaction with no movements (fee-only)
    return {
      notes: [
        {
          message: `Staking transaction with no asset movement. Fee-only staking operation.`,
          metadata: {
            feeAmount: fundFlow.feeAmount,
            feeCurrency: fundFlow.feeCurrency,
          },
          severity: 'info',
          type: 'fee_only_staking',
        },
      ],
      operation: {
        category: 'staking',
        type: 'stake',
      },
    };
  }

  // Pattern 2: Governance operations (9/10 confident)
  if (fundFlow.hasGovernance) {
    if (outflows.length > 0) {
      return {
        operation: {
          category: 'governance',
          type: transaction.call?.includes('propose') ? 'proposal' : 'vote',
        },
      };
    } else if (inflows.length > 0) {
      return {
        operation: {
          category: 'governance',
          type: 'refund',
        },
      };
    }
  }

  // Pattern 3: Utility batch (complex - add uncertainty note)
  if (fundFlow.hasUtilityBatch) {
    return {
      notes: [
        {
          message:
            fundFlow.classificationUncertainty ||
            `Utility batch transaction with ${fundFlow.eventCount} events. May contain multiple operations.`,
          metadata: {
            eventCount: fundFlow.eventCount,
            inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
            outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
          },
          severity: 'warning',
          type: 'batch_operation',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 4: Proxy operations (add note)
  if (fundFlow.hasProxy) {
    return {
      notes: [
        {
          message: `Proxy transaction. User authorized another account to perform operations.`,
          metadata: {
            call: fundFlow.call,
            module: fundFlow.module,
          },
          severity: 'info',
          type: 'proxy_operation',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 5: Multisig operations (add note)
  if (fundFlow.hasMultisig) {
    return {
      notes: [
        {
          message: `Multisig transaction. Requires multiple signatures to execute.`,
          metadata: {
            call: fundFlow.call,
            module: fundFlow.module,
          },
          severity: 'info',
          type: 'multisig_operation',
        },
      ],
      operation: {
        category: 'transfer',
        type: 'transfer',
      },
    };
  }

  // Pattern 6: Fee-only transaction (no asset movements)
  if (isZeroAmount && inflows.length === 0 && outflows.length === 0) {
    return {
      operation: {
        category: 'fee',
        type: 'fee',
      },
    };
  }

  // Pattern 7: Simple deposit (only inflows)
  if (outflows.length === 0 && inflows.length >= 1) {
    return {
      operation: {
        category: 'transfer',
        type: 'deposit',
      },
    };
  }

  // Pattern 8: Simple withdrawal (only outflows)
  if (outflows.length >= 1 && inflows.length === 0) {
    return {
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },
    };
  }

  // Pattern 9: Self-transfer (same asset in and out)
  if (outflows.length === 1 && inflows.length === 1) {
    const outAsset = outflows[0]?.asset;
    const inAsset = inflows[0]?.asset;

    if (outAsset === inAsset) {
      return {
        operation: {
          category: 'transfer',
          type: 'transfer',
        },
      };
    }
  }

  // Pattern 10: Unknown/complex transaction
  return {
    notes: [
      {
        message: `Unable to classify transaction with confidence. Module: ${fundFlow.module}, Call: ${fundFlow.call}`,
        metadata: {
          call: fundFlow.call,
          inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
          module: fundFlow.module,
          outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
        },
        severity: 'warning',
        type: 'classification_failed',
      },
    ],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
  };
}

/**
 * Normalize amount from planck (or smallest unit) to token units using chain-specific decimals.
 * Similar to EVM's wei-to-ETH normalization.
 *
 * Pure function that converts raw on-chain amounts (in planck/smallest unit) to human-readable
 * token amounts. Different Substrate chains use different decimal places:
 * - Polkadot (DOT): 10 decimals
 * - Kusama (KSM): 12 decimals
 * - Bittensor (TAO): 9 decimals
 *
 * @param amountPlanck - Amount in planck (smallest unit) as string
 * @param nativeDecimals - Number of decimal places for the chain's native token
 * @returns Result containing normalized amount as string, or Error if conversion fails
 */
export function normalizeAmount(amountPlanck: string | undefined, nativeDecimals: number): Result<string, Error> {
  if (!amountPlanck || amountPlanck === '0') {
    return ok('0');
  }

  try {
    return ok(new Decimal(amountPlanck).dividedBy(new Decimal('10').pow(nativeDecimals)).toFixed());
  } catch (error) {
    return err(
      new Error(
        `Failed to convert ${amountPlanck} planck to main unit with ${nativeDecimals} decimals: ${String(error)}`
      )
    );
  }
}

/**
 * Determine if a fee entry should be recorded for this transaction.
 * Returns true when the user paid the fee (vs validator/other party paying).
 *
 * Pure function that infers who signed/paid for a Substrate transaction.
 * In Substrate chains, the transaction signer/broadcaster pays the fee.
 *
 * Rules (high confidence):
 * 1. If user has ANY outflows -> user initiated and paid fee
 * 2. User-initiated staking operations (unbond, withdraw, nominate, chill) -> user paid fee
 * 3. If from == userAddress and not a staking reward -> user paid fee
 *
 * @param transaction - The normalized Substrate transaction
 * @param fundFlow - The analyzed fund flow
 * @param userAddress - The user's address
 * @returns true if a fee entry should be recorded, false otherwise
 */
export function shouldRecordFeeEntry(
  transaction: SubstrateTransaction,
  fundFlow: SubstrateFundFlow,
  userAddress: string
): boolean {
  // Rule 1: User has outflows -> user initiated transaction and paid fee
  if (fundFlow.outflows.length > 0) {
    return true;
  }

  // Rule 2: User-initiated staking operations (user pays even when receiving funds)
  if (transaction.module === 'staking') {
    // Unbond/withdraw: user requests unstaking -> user pays fee
    if (transaction.call?.includes('unbond') || transaction.call?.includes('withdraw')) {
      return true;
    }
    // Nominate/chill: user manages validators -> user pays fee
    if (transaction.call?.includes('nominate') || transaction.call?.includes('chill')) {
      return true;
    }
    // Bond with outflows already handled by Rule 1
    // Incoming bond (reward) falls through to Rule 3
  }

  // Rule 3: Check if from address matches user (for regular transfers)
  // Note: This may not be accurate for all staking rewards, but handles most cases
  // Substrate addresses are case-sensitive (SS58 base58 encoding)
  return transaction.from === userAddress;
}
