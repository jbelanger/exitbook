/**
 * Standard Ethereum JSON-RPC types for EVM-compatible chains
 * https://ethereum.org/en/developers/docs/apis/json-rpc/
 */

/**
 * Standard Ethereum transaction object from JSON-RPC
 */
export interface EvmRpcTransaction {
  blockHash: string | null;
  blockNumber: string | null; // Hex string
  from: string;
  gas: string; // Hex string
  gasPrice: string; // Hex string
  hash: string;
  input: string; // Hex string - contract call data
  nonce: string; // Hex string
  r: string; // Signature r
  s: string; // Signature s
  to: string | null; // null for contract creation
  transactionIndex: string | null; // Hex string
  type: string; // Hex string - transaction type (0x0, 0x1, 0x2)
  v: string; // Signature v
  value: string; // Hex string - value in wei
  maxFeePerGas?: string | undefined; // Hex string - EIP-1559
  maxPriorityFeePerGas?: string | undefined; // Hex string - EIP-1559
  chainId?: string | undefined; // Hex string
  accessList?: {
    address: string;
    storageKeys: string[];
  }[];
}

/**
 * Transaction receipt from JSON-RPC
 */
export interface EvmRpcTransactionReceipt {
  blockHash: string;
  blockNumber: string; // Hex string
  contractAddress: string | null; // Contract address created (if contract creation)
  cumulativeGasUsed: string; // Hex string
  effectiveGasPrice: string; // Hex string
  from: string;
  gasUsed: string; // Hex string
  logs: EvmRpcLog[];
  logsBloom: string;
  status: string; // Hex string - 0x1 for success, 0x0 for failure
  to: string | null;
  transactionHash: string;
  transactionIndex: string; // Hex string
  type: string; // Hex string
}

/**
 * Event log from JSON-RPC
 */
export interface EvmRpcLog {
  address: string; // Contract address that emitted the log
  blockHash: string;
  blockNumber: string; // Hex string
  data: string; // Hex string - non-indexed log data
  logIndex: string; // Hex string
  removed: boolean;
  topics: string[]; // Array of hex strings - indexed log parameters
  transactionHash: string;
  transactionIndex: string; // Hex string
}

/**
 * Block object from JSON-RPC
 */
export interface EvmRpcBlock {
  baseFeePerGas?: string | undefined; // Hex string - EIP-1559
  difficulty: string; // Hex string
  extraData: string;
  gasLimit: string; // Hex string
  gasUsed: string; // Hex string
  hash: string;
  logsBloom: string;
  miner: string;
  mixHash: string;
  nonce: string;
  number: string; // Hex string
  parentHash: string;
  receiptsRoot: string;
  sha3Uncles: string;
  size: string; // Hex string
  stateRoot: string;
  timestamp: string; // Hex string - Unix timestamp
  totalDifficulty: string; // Hex string
  transactions: string[] | EvmRpcTransaction[]; // Either hashes or full transactions
  transactionsRoot: string;
  uncles: string[];
}

/**
 * Balance response from JSON-RPC
 */
export interface EvmRpcBalance {
  balance: string; // Hex string - balance in wei
}

/**
 * ERC-20 Transfer event signature
 * keccak256("Transfer(address,address,uint256)")
 */
export const ERC20_TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * ERC-721 Transfer event signature (same as ERC-20)
 */
export const ERC721_TRANSFER_EVENT_SIGNATURE = ERC20_TRANSFER_EVENT_SIGNATURE;

/**
 * ERC-1155 TransferSingle event signature
 * keccak256("TransferSingle(address,address,address,uint256,uint256)")
 */
export const ERC1155_TRANSFER_SINGLE_EVENT_SIGNATURE =
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';

/**
 * ERC-1155 TransferBatch event signature
 * keccak256("TransferBatch(address,address,address,uint256[],uint256[])")
 */
export const ERC1155_TRANSFER_BATCH_EVENT_SIGNATURE =
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

/**
 * Combined raw data for EVM RPC provider
 */
export interface EvmRpcRawData {
  transaction: EvmRpcTransaction;
  receipt: EvmRpcTransactionReceipt;
  block?: EvmRpcBlock | undefined;

  // Augmented fields added by API client for chain-specific context
  _nativeCurrency?: string | undefined;
  _nativeDecimals?: number | undefined;
}

/**
 * Parameters for eth_getLogs call
 */
export interface EvmRpcGetLogsParams {
  address?: string | string[] | undefined; // Contract address(es) to filter by
  fromBlock?: string | undefined; // Block number (hex) or "earliest", "latest", "pending"
  toBlock?: string | undefined; // Block number (hex) or "earliest", "latest", "pending"
  topics?: (string | string[] | null)[] | undefined; // Array of topics to filter by
  blockHash?: string | undefined; // Alternative to fromBlock/toBlock - filter by specific block
}
