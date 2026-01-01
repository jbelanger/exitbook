// import type { NearTransaction } from '@exitbook/blockchain-providers';
// import { normalizeNativeAmount, normalizeTokenAmount } from '@exitbook/blockchain-providers';
// import { parseDecimal } from '@exitbook/core';
// import type { OperationClassification } from '@exitbook/core';
// import { getLogger } from '@exitbook/logger';
// import type { Decimal } from 'decimal.js';
// import { type Result, err, ok } from 'neverthrow';

// import type { ProcessingContext } from '../../../shared/types/processors.js';

// import type { NearBalanceChangeAnalysis, NearFundFlow, NearMovement } from './types.js';

// const logger = getLogger('near-processor-utils');

// /**
//  * NEAR action types (normalized to lowercase for case-insensitive matching)
//  * Handles variations from different API providers (e.g., "FUNCTION_CALL", "FunctionCall")
//  */
// enum NearActionType {
//   AddKey = 'add_key',
//   CreateAccount = 'create_account',
//   DeleteAccount = 'delete_account',
//   DeleteKey = 'delete_key',
//   DeployContract = 'deploy_contract',
//   FunctionCall = 'function_call',
//   Stake = 'stake',
//   Transfer = 'transfer',
//   Unstake = 'unstake',
// }

// /**
//  * NEP-141 token transfer method names
//  */
// const TOKEN_TRANSFER_METHODS: string[] = ['ft_transfer', 'ft_transfer_call'];

// /**
//  * Normalize NEAR action type to lowercase with underscores
//  * Handles multiple formats:
//  * - "FUNCTION_CALL" -> "function_call"
//  * - "FunctionCall" -> "function_call"
//  * - "function_call" -> "function_call"
//  * - "functionCall" -> "function_call"
//  */
// function normalizeActionType(actionType: string): string {
//   // First, handle camelCase/PascalCase by inserting underscores before capital letters
//   const withUnderscores = actionType.replace(/([a-z])([A-Z])/g, '$1_$2');
//   // Then convert everything to lowercase
//   return withUnderscores.toLowerCase();
// }

// /**
//  * Detect staking-related actions in a NEAR transaction
//  * Checks for both explicit Stake/Unstake actions and FUNCTION_CALL actions with staking method names
//  */
// export function detectNearStakingActions(actions?: NearTransaction['actions']): boolean {
//   if (!actions) return false;

//   return actions.some((action) => {
//     const normalized = normalizeActionType(action.actionType);

//     // Check for explicit Stake/Unstake actions
//     if (normalized === NearActionType.Stake.valueOf() || normalized === NearActionType.Unstake.valueOf()) {
//       return true;
//     }

//     // Check for FUNCTION_CALL actions with staking-related method names
//     // Note: "deposit" alone is too generic, so we only check for specific staking methods
//     if (normalized === NearActionType.FunctionCall.valueOf() && action.methodName) {
//       const methodLower = action.methodName.toLowerCase();
//       return (
//         methodLower === 'deposit_and_stake' ||
//         methodLower === 'stake' ||
//         methodLower === 'stake_all' ||
//         methodLower === 'unstake' ||
//         methodLower === 'unstake_all' ||
//         methodLower === 'withdraw' ||
//         methodLower === 'withdraw_all'
//       );
//     }

//     return false;
//   });
// }

// /**
//  * Detect contract call actions in a NEAR transaction
//  */
// export function detectNearContractCalls(actions?: NearTransaction['actions']): boolean {
//   if (!actions) return false;

//   return actions.some((action) => {
//     const normalized = normalizeActionType(action.actionType);
//     return (
//       normalized === NearActionType.FunctionCall.valueOf() || normalized === NearActionType.DeployContract.valueOf()
//     );
//   });
// }

// /**
//  * Detect NEP-141 token transfer actions in a NEAR transaction
//  */
// export function detectNearTokenTransfers(actions?: NearTransaction['actions']): boolean {
//   if (!actions) return false;

//   return actions.some((action) => {
//     const normalized = normalizeActionType(action.actionType);
//     return (
//       normalized === NearActionType.FunctionCall.valueOf() &&
//       action.methodName &&
//       TOKEN_TRANSFER_METHODS.includes(action.methodName)
//     );
//   });
// }

// /**
//  * Extract token transfers from NEAR transaction actions
//  * Parses NEP-141 token transfer events from FunctionCall actions
//  */
// export function extractNearTokenTransfers(tx: NearTransaction): Result<NearMovement[], Error> {
//   const movements: NearMovement[] = [];

//   // Use tokenTransfers if available (already parsed by mapper)
//   if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
//     for (const transfer of tx.tokenTransfers) {
//       // Normalize token amount using decimals
//       const normalizedAmountResult = normalizeTokenAmount(transfer.amount, transfer.decimals);
//       if (normalizedAmountResult.isErr()) {
//         return err(
//           new Error(
//             `Failed to normalize NEAR token amount: ${normalizedAmountResult.error.message}. ` +
//               `Raw amount: ${transfer.amount}, decimals: ${transfer.decimals}, contract: ${transfer.contractAddress}`
//           )
//         );
//       }

//       movements.push({
//         amount: normalizedAmountResult.value,
//         asset: transfer.symbol || transfer.contractAddress,
//         decimals: transfer.decimals,
//         tokenAddress: transfer.contractAddress,
//       });
//     }
//   }

//   return ok(movements);
// }

// /**
//  * Consolidate duplicate assets by summing amounts for the same asset
//  */
// export function consolidateNearMovements(movements: NearMovement[]): NearMovement[] {
//   const assetMap = new Map<
//     string,
//     { amount: Decimal; decimals?: number | undefined; tokenAddress?: string | undefined }
//   >();

//   for (const movement of movements) {
//     const existing = assetMap.get(movement.asset);
//     if (existing) {
//       existing.amount = existing.amount.plus(parseDecimal(movement.amount));
//     } else {
//       const entry: { amount: Decimal; decimals?: number; tokenAddress?: string } = {
//         amount: parseDecimal(movement.amount),
//       };
//       if (movement.decimals !== undefined) {
//         entry.decimals = movement.decimals;
//       }
//       if (movement.tokenAddress !== undefined) {
//         entry.tokenAddress = movement.tokenAddress;
//       }
//       assetMap.set(movement.asset, entry);
//     }
//   }

//   return Array.from(assetMap.entries()).map(([asset, data]) => {
//     const result: NearMovement = {
//       amount: data.amount.toFixed(),
//       asset,
//       decimals: data.decimals,
//       tokenAddress: data.tokenAddress,
//     };
//     return result;
//   });
// }

// /**
//  * Check if a decimal string value is zero
//  */
// export function isZeroDecimal(value: string): boolean {
//   try {
//     return parseDecimal(value || '0').isZero();
//   } catch (error) {
//     logger.warn({ error, value }, 'Failed to parse decimal value, treating as zero');
//     return true;
//   }
// }

// /**
//  * Analyze balance changes to collect ALL asset movements (multi-asset tracking)
//  */
// export function analyzeNearBalanceChanges(
//   tx: NearTransaction,
//   allWalletAddresses: Set<string>
// ): Result<NearBalanceChangeAnalysis, Error> {
//   const inflows: NearMovement[] = [];
//   const outflows: NearMovement[] = [];
//   let fromAddress = tx.from;
//   let toAddress = tx.to;

//   // Collect ALL token balance changes involving the user
//   const tokenMovementsResult = extractNearTokenTransfers(tx);
//   if (tokenMovementsResult.isErr()) {
//     return err(tokenMovementsResult.error);
//   }
//   const tokenMovements = tokenMovementsResult.value;
//   for (const movement of tokenMovements) {
//     // Determine direction based on transfer details
//     const transfer = tx.tokenTransfers?.find((t) => t.contractAddress === movement.tokenAddress);
//     if (transfer) {
//       const isUserReceiver = allWalletAddresses.has(transfer.to);
//       const isUserSender = allWalletAddresses.has(transfer.from);

//       if (isUserReceiver && !isUserSender) {
//         inflows.push(movement);
//         toAddress = transfer.to;
//       } else if (isUserSender && !isUserReceiver) {
//         outflows.push(movement);
//         fromAddress = transfer.from;
//       }
//     }
//   }

//   const userIsReceiver = tx.to ? allWalletAddresses.has(tx.to) : false;
//   const userIsSender = tx.from ? allWalletAddresses.has(tx.from) : false;
//   const signerIsUser = userIsSender;

//   const totalStakingDepositYocto = signerIsUser ? calculateStakingDepositAmount(tx.actions) : 0n;

//   // Collect ALL NEAR balance changes involving the user
//   if (tx.accountChanges && tx.accountChanges.length > 0) {
//     for (const change of tx.accountChanges) {
//       const isUserAccount = allWalletAddresses.has(change.account);
//       if (!isUserAccount) continue;

//       // Use BigInt for precise arithmetic with 24-decimal yoctoNEAR values
//       const postBalanceBigInt = BigInt(change.postBalance);
//       const preBalanceBigInt = BigInt(change.preBalance);
//       const nearAmountInYocto = postBalanceBigInt - preBalanceBigInt;

//       if (nearAmountInYocto === 0n) continue; // Skip zero changes

//       // Normalize yoctoNEAR to NEAR (24 decimals)
//       const absAmount = nearAmountInYocto < 0n ? -nearAmountInYocto : nearAmountInYocto;
//       const normalizedNearAmountResult = normalizeNativeAmount(absAmount.toString(), 24);
//       if (normalizedNearAmountResult.isErr()) {
//         return err(
//           new Error(
//             `Failed to normalize NEAR balance change for account ${change.account}: ${normalizedNearAmountResult.error.message}. ` +
//               `Raw amount: ${absAmount.toString()}, decimals: 24`
//           )
//         );
//       }

//       const movement = {
//         amount: normalizedNearAmountResult.value,
//         asset: 'NEAR',
//       };

//       const stakingDepositAdjustment = totalStakingDepositYocto > 0n && nearAmountInYocto > 0n;

//       if (stakingDepositAdjustment) {
//         // Ignore synthetic positive deltas that appear on staking deposit transactions.
//         // These represent intermediary accounting hops before funds are locked and do not
//         // affect the user's liquid balance. The actual decrease is handled via the
//         // staking outflow logic below.
//         continue;
//       }

//       if (nearAmountInYocto > 0n) {
//         inflows.push(movement);
//         toAddress = change.account;
//       } else {
//         outflows.push(movement);
//         fromAddress = change.account;
//       }
//     }
//   }

//   const hasNearMovements =
//     inflows.some((movement) => movement.asset === 'NEAR') || outflows.some((movement) => movement.asset === 'NEAR');

//   if (!hasNearMovements && tx.currency === 'NEAR' && tx.amount && userIsReceiver !== userIsSender) {
//     const normalizedAmountResult = normalizeNativeAmount(tx.amount, 24);
//     if (normalizedAmountResult.isErr()) {
//       return err(
//         new Error(
//           `Failed to normalize NEAR transaction amount for tx ${tx.id}: ${normalizedAmountResult.error.message}. ` +
//             `Raw amount: ${tx.amount}, decimals: 24`
//         )
//       );
//     }
//     const normalizedAmount = normalizedAmountResult.value;
//     if (userIsReceiver) {
//       inflows.push({
//         amount: normalizedAmount,
//         asset: 'NEAR',
//       });
//       toAddress = tx.to || toAddress;
//     } else if (userIsSender) {
//       outflows.push({
//         amount: normalizedAmount,
//         asset: 'NEAR',
//       });
//       fromAddress = tx.from || fromAddress;
//     }
//   }

//   // Handle staking outflows: When user stakes NEAR, it moves from liquid (absolute_nonstaked_amount)
//   // to staked (absolute_staked_amount), but this doesn't always show up in accountChanges from the API.
//   // We need to explicitly add the staking amount as an outflow, but only if accountChanges don't already
//   // reflect the full staking amount (to avoid double-counting in tests or when API behavior varies).
//   const hasStaking = detectNearStakingActions(tx.actions || []);

//   if (hasStaking && signerIsUser && totalStakingDepositYocto > 0n) {
//     // Only add staking outflow if it's not already reflected in the balance changes
//     // Sum all NEAR outflows from accountChanges to check if the stake amount is already counted
//     const existingNearOutflows = outflows
//       .filter((o) => o.asset === 'NEAR')
//       .reduce((sum, o) => sum + BigInt(parseDecimal(o.amount).mul(parseDecimal('10').pow(24)).toFixed(0)), 0n);

//     // If the existing outflows are significantly less than the staking amount, add the difference
//     // Use a threshold to account for small rewards/fees already in the accountChanges
//     const threshold = totalStakingDepositYocto / 10n; // 10% threshold
//     const missing = totalStakingDepositYocto - existingNearOutflows;

//     if (missing > threshold) {
//       const normalizedStakingAmountResult = normalizeNativeAmount(missing.toString(), 24);
//       if (normalizedStakingAmountResult.isErr()) {
//         return err(
//           new Error(
//             `Failed to normalize NEAR staking amount for tx ${tx.id}: ${normalizedStakingAmountResult.error.message}. ` +
//               `Raw amount: ${missing.toString()}, decimals: 24`
//           )
//         );
//       }
//       outflows.push({
//         amount: normalizedStakingAmountResult.value,
//         asset: 'NEAR',
//       });
//       fromAddress = tx.from || fromAddress;
//     }
//   }

//   const consolidatedInflows = consolidateNearMovements(inflows);
//   const consolidatedOutflows = consolidateNearMovements(outflows);

//   // Determine if the user paid the transaction fee
//   // User pays fee when:
//   // 1. They have outflows (sent funds, swapped, staked, etc.), OR
//   // 2. They initiated a transaction with no movements (contract interactions, failed txs)
//   const hasInflows = consolidatedInflows.length > 0;
//   const hasOutflows = consolidatedOutflows.length > 0;
//   const initiatorIsUser = tx.from ? allWalletAddresses.has(tx.from) : false;
//   const inferredSenderIsUser = fromAddress ? allWalletAddresses.has(fromAddress) : false;
//   const feePaidByUser = hasOutflows || (!hasInflows && (initiatorIsUser || inferredSenderIsUser));

//   // Fix Issue #78: Prevent double-counting of fees in NEAR balance calculations
//   // NEAR accountChanges already include fees (net balance deltas), so we must
//   // deduct fees from NEAR outflows to avoid subtracting them twice in accounting.
//   // For fee-only transactions, this reduces the outflow to zero, which we track
//   // via `feeAbsorbedByMovement` to avoid recording a separate fee entry later.
//   // We also track grossAmount (before fee deduction) for proper reporting.
//   let hadOutflowsBeforeFeeAdjustment = false;
//   if (feePaidByUser && tx.feeAmount) {
//     let remainingFee = parseDecimal(tx.feeAmount);

//     if (!remainingFee.isZero()) {
//       for (const movement of consolidatedOutflows) {
//         if (movement.asset !== 'NEAR') {
//           continue;
//         }

//         const movementAmount = parseDecimal(movement.amount);
//         if (movementAmount.isZero()) {
//           continue;
//         }

//         // Store original amount as grossAmount before deducting fee
//         movement.grossAmount = movement.amount;

//         hadOutflowsBeforeFeeAdjustment = true;
//         if (movementAmount.lessThanOrEqualTo(remainingFee)) {
//           remainingFee = remainingFee.minus(movementAmount);
//           movement.amount = '0';
//         } else {
//           movement.amount = movementAmount.minus(remainingFee).toFixed();
//           remainingFee = parseDecimal('0');
//           break;
//         }
//       }

//       // Remove zero-value NEAR movements that resulted from fee deduction
//       for (let index = consolidatedOutflows.length - 1; index >= 0; index--) {
//         const movement = consolidatedOutflows[index];
//         if (movement?.asset === 'NEAR' && isZeroDecimal(movement.amount)) {
//           consolidatedOutflows.splice(index, 1);
//         }
//       }
//     }
//   }

//   // Select primary asset for simplified consumption and single-asset display
//   // Prioritizes largest movement to provide a meaningful summary of complex multi-asset transactions
//   let primary: NearMovement = {
//     amount: '0',
//     asset: 'NEAR',
//   };

//   // Use largest inflow as primary
//   const largestInflow = consolidatedInflows
//     .sort((a, b) => {
//       try {
//         return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
//       } catch (error) {
//         logger.warn({ error, itemA: a, itemB: b }, 'Failed to parse amount during sort comparison, treating as equal');
//         return 0;
//       }
//     })
//     .find((inflow) => !isZeroDecimal(inflow.amount));

//   if (largestInflow) {
//     primary = { ...largestInflow };
//   } else {
//     // If no inflows, use largest outflow
//     const largestOutflow = consolidatedOutflows
//       .sort((a, b) => {
//         try {
//           return parseDecimal(b.amount).comparedTo(parseDecimal(a.amount));
//         } catch (error) {
//           logger.warn(
//             { error, itemA: a, itemB: b },
//             'Failed to parse amount during sort comparison, treating as equal'
//           );
//           return 0;
//         }
//       })
//       .find((outflow) => !isZeroDecimal(outflow.amount));

//     if (largestOutflow) {
//       primary = { ...largestOutflow };
//     }
//   }

//   // Track uncertainty for complex transactions
//   let classificationUncertainty: string | undefined;
//   if (consolidatedInflows.length > 1 || consolidatedOutflows.length > 1) {
//     classificationUncertainty = `Complex transaction with ${consolidatedOutflows.length} outflow(s) and ${consolidatedInflows.length} inflow(s). May be multi-asset swap or batch operation.`;
//   }

//   // Track fee-only transactions where the fee was fully absorbed by movement adjustment
//   // When true, prevents recording a duplicate fee entry in the transaction record
//   const feeAbsorbedByMovement = hadOutflowsBeforeFeeAdjustment && consolidatedOutflows.length === 0;

//   return ok({
//     classificationUncertainty,
//     feeAbsorbedByMovement,
//     feePaidByUser,
//     fromAddress,
//     inflows: consolidatedInflows,
//     outflows: consolidatedOutflows,
//     primary,
//     toAddress,
//   });
// }

// /**
//  * Classify operation based on fund flow analysis with conservative pattern matching.
//  * Only classifies patterns with 9/10 confidence. Complex cases get notes.
//  */
// export function classifyNearOperationFromFundFlow(
//   fundFlow: NearFundFlow,
//   _actions: NearTransaction['actions']
// ): OperationClassification {
//   const { inflows, outflows } = fundFlow;
//   const primaryAmount = parseDecimal(fundFlow.primary.amount || '0').abs();
//   const isZero = primaryAmount.isZero();

//   // Pattern 1: Staking operations (high confidence based on action detection)
//   if (fundFlow.hasStaking) {
//     if (outflows.length > 0 && inflows.length === 0) {
//       return {
//         operation: {
//           category: 'staking',
//           type: 'stake',
//         },
//       };
//     }

//     if (inflows.length > 0 && outflows.length === 0) {
//       // Check if reward or withdrawal based on amount
//       const isReward = primaryAmount.greaterThan(0) && primaryAmount.lessThan(1); // Rewards are typically small
//       return {
//         operation: {
//           category: 'staking',
//           type: isReward ? 'reward' : 'unstake',
//         },
//       };
//     }

//     // Complex staking with both inflows and outflows
//     return {
//       notes: [
//         {
//           message: 'Complex staking operation with both inflows and outflows. Manual review recommended.',
//           metadata: {
//             hasStaking: true,
//             inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
//             outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
//           },
//           severity: 'info',
//           type: 'classification_uncertain',
//         },
//       ],
//       operation: {
//         category: 'staking',
//         type: 'stake',
//       },
//     };
//   }

//   // Pattern 2: Fee-only transaction (no movements)
//   if (isZero && inflows.length === 0 && outflows.length === 0) {
//     return {
//       operation: {
//         category: 'fee',
//         type: 'fee',
//       },
//     };
//   }

//   // Pattern 3: Single-asset swap (9/10 confident)
//   if (outflows.length === 1 && inflows.length === 1) {
//     const outAsset = outflows[0]?.asset;
//     const inAsset = inflows[0]?.asset;

//     if (outAsset !== inAsset) {
//       return {
//         operation: {
//           category: 'trade',
//           type: 'swap',
//         },
//       };
//     }
//   }

//   // Pattern 4: Contract call with token transfers
//   if (fundFlow.hasContractCall && fundFlow.hasTokenTransfers) {
//     // Check if it's a swap (different assets in/out)
//     if (outflows.length === 1 && inflows.length === 1) {
//       const outAsset = outflows[0]?.asset;
//       const inAsset = inflows[0]?.asset;

//       if (outAsset !== inAsset) {
//         return {
//           operation: {
//             category: 'trade',
//             type: 'swap',
//           },
//         };
//       }
//     }

//     // Check if it's a simple token transfer (only outflows or only inflows, not both)
//     if (outflows.length > 0 && inflows.length === 0) {
//       return {
//         operation: {
//           category: 'transfer',
//           type: 'withdrawal',
//         },
//       };
//     }

//     if (inflows.length > 0 && outflows.length === 0) {
//       return {
//         operation: {
//           category: 'transfer',
//           type: 'deposit',
//         },
//       };
//     }

//     // Complex contract interaction (both inflows and outflows, but not a clear swap)
//     return {
//       notes: [
//         {
//           message: 'Contract call with token transfers detected. May be swap or complex operation.',
//           metadata: {
//             hasContractCall: true,
//             hasTokenTransfers: true,
//             inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
//             outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
//           },
//           severity: 'info',
//           type: 'contract_interaction',
//         },
//       ],
//       operation: {
//         category: 'defi',
//         type: 'batch',
//       },
//     };
//   }

//   // Pattern 5: Simple deposit (only inflows)
//   if (outflows.length === 0 && inflows.length >= 1) {
//     return {
//       operation: {
//         category: 'transfer',
//         type: 'deposit',
//       },
//     };
//   }

//   // Pattern 6: Simple withdrawal (only outflows)
//   if (outflows.length >= 1 && inflows.length === 0) {
//     return {
//       operation: {
//         category: 'transfer',
//         type: 'withdrawal',
//       },
//     };
//   }

//   // Pattern 7: Self-transfer (same asset in and out)
//   if (outflows.length === 1 && inflows.length === 1) {
//     const outAsset = outflows[0]?.asset;
//     const inAsset = inflows[0]?.asset;

//     if (outAsset === inAsset) {
//       return {
//         operation: {
//           category: 'transfer',
//           type: 'transfer',
//         },
//       };
//     }
//   }

//   // Pattern 8: Complex multi-asset transaction (UNCERTAIN - add note)
//   if (fundFlow.classificationUncertainty) {
//     return {
//       notes: [
//         {
//           message: fundFlow.classificationUncertainty,
//           metadata: {
//             inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
//             outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
//           },
//           severity: 'info',
//           type: 'classification_uncertain',
//         },
//       ],
//       operation: {
//         category: 'transfer',
//         type: 'transfer',
//       },
//     };
//   }

//   // Pattern 9: Batch operations (multiple actions)
//   if (fundFlow.actionCount > 3) {
//     return {
//       notes: [
//         {
//           message: `Batch transaction with ${fundFlow.actionCount} actions. May contain multiple operations.`,
//           metadata: {
//             actionCount: fundFlow.actionCount,
//             actionTypes: fundFlow.actionTypes,
//             inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
//             outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
//           },
//           severity: 'info',
//           type: 'batch_operation',
//         },
//       ],
//       operation: {
//         category: 'transfer',
//         type: 'transfer',
//       },
//     };
//   }

//   // Ultimate fallback: Couldn't match any confident pattern
//   return {
//     notes: [
//       {
//         message: 'Unable to determine transaction classification using confident patterns.',
//         metadata: {
//           inflows: inflows.map((i) => ({ amount: i.amount, asset: i.asset })),
//           outflows: outflows.map((o) => ({ amount: o.amount, asset: o.asset })),
//         },
//         severity: 'warning',
//         type: 'classification_failed',
//       },
//     ],
//     operation: {
//       category: 'transfer',
//       type: 'transfer',
//     },
//   };
// }

// /**
//  * Analyze fund flow from normalized NEAR transaction data
//  */
// export function analyzeNearFundFlow(tx: NearTransaction, context: ProcessingContext): Result<NearFundFlow, string> {
//   // Use all user addresses for multi-address fund-flow analysis
//   const allWalletAddresses = new Set<string>(context.userAddresses);

//   // Analyze action complexity
//   const actionCount = tx.actions?.length || 0;
//   const actionTypes = tx.actions?.map((action) => action.actionType) || [];

//   // Detect transaction types based on actions
//   const hasStaking = detectNearStakingActions(tx.actions || []);
//   const hasContractCall = detectNearContractCalls(tx.actions || []);
//   const hasTokenTransfers = detectNearTokenTransfers(tx.actions || []);

//   // Enhanced fund flow analysis using balance changes
//   const flowAnalysisResult = analyzeNearBalanceChanges(tx, allWalletAddresses);
//   if (flowAnalysisResult.isErr()) {
//     return err(flowAnalysisResult.error.message);
//   }
//   const flowAnalysis = flowAnalysisResult.value;

//   const fundFlow: NearFundFlow = {
//     feeAmount: tx.feeAmount || '0',
//     feeCurrency: tx.feeCurrency || 'NEAR',
//     feePaidByUser: flowAnalysis.feePaidByUser,
//     feeAbsorbedByMovement: flowAnalysis.feeAbsorbedByMovement,
//     fromAddress: flowAnalysis.fromAddress,
//     toAddress: flowAnalysis.toAddress,
//     hasStaking,
//     hasContractCall,
//     hasTokenTransfers,
//     actionTypes,
//     actionCount,

//     inflows: flowAnalysis.inflows,
//     outflows: flowAnalysis.outflows,
//     primary: flowAnalysis.primary,

//     // Classification uncertainty
//     classificationUncertainty: flowAnalysis.classificationUncertainty,
//   };

//   return ok(fundFlow);
// }

// /**
//  * Determine human-readable transaction type from fund flow
//  */
// export function determineNearTransactionType(fundFlow: NearFundFlow): string {
//   if (fundFlow.hasStaking) {
//     return fundFlow.outflows.length > 0 ? 'Stake' : 'Unstake';
//   }

//   if (fundFlow.hasTokenTransfers) {
//     return 'Token Transfer';
//   }

//   if (fundFlow.hasContractCall) {
//     return 'Contract Call';
//   }

//   if (fundFlow.outflows.length > 0 && fundFlow.inflows.length > 0) {
//     return 'Transfer';
//   }

//   if (fundFlow.outflows.length > 0) {
//     return 'Withdrawal';
//   }

//   if (fundFlow.inflows.length > 0) {
//     return 'Deposit';
//   }

//   return 'Unknown';
// }

// function calculateStakingDepositAmount(actions?: NearTransaction['actions']): bigint {
//   if (!actions || actions.length === 0) {
//     return 0n;
//   }

//   let total = 0n;

//   for (const action of actions) {
//     const normalized = normalizeActionType(action.actionType);

//     if (normalized === NearActionType.Stake.valueOf() && action.deposit) {
//       total += BigInt(action.deposit);
//       continue;
//     }

//     if (normalized === NearActionType.FunctionCall.valueOf() && action.methodName && action.deposit) {
//       const methodLower = action.methodName.toLowerCase();
//       const isStakingMethod =
//         methodLower === 'deposit_and_stake' ||
//         methodLower === 'stake' ||
//         methodLower === 'deposit' ||
//         methodLower === 'stake_all';

//       if (isStakingMethod) {
//         total += BigInt(action.deposit);
//       }
//     }
//   }

//   return total;
// }
