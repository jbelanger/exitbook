# Akash API Implementation Guide

## Executive Summary

**Problem**: Standard Cosmos REST API (`/cosmos/tx/v1beta1/txs`) does NOT have transaction event indexing enabled on Akash. All event-based queries return 0 results.

**✅ SOLUTION FOUND**: Akash has a **custom Console API** (`console-api.akash.network`) with:

- ✅ Full historical transaction data (back to Dec 2024, likely earlier)
- ✅ Clean REST API with address-based queries
- ✅ Balance information with delegation/staking details
- ✅ Transaction details with full sender/recipient info
- ✅ Simple offset/limit pagination

**Alternative**: Implement CometBFT RPC client (limited to ~2 months retention on public nodes)

## ⭐ Akash Console API (RECOMMENDED)

### Base URL

```
https://console-api.akash.network/v1
```

### Available Endpoints

#### 1. Get Address Balance and Info

```bash
GET /addresses/{address}

# Example:
curl -s "https://console-api.akash.network/v1/addresses/akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5"
```

**Response Structure:**

```json
{
  "total": 748426495,           // Total balance in uakt
  "available": 748426495,        // Available balance in uakt
  "delegated": 0,                // Delegated amount in uakt
  "rewards": 0,                  // Staking rewards in uakt
  "commission": 0,               // Validator commission in uakt
  "assets": [
    {
      "symbol": "AKT",
      "logoUrl": "https://console.akash.network/images/akash-logo.svg",
      "amount": 748.426495       // Already converted to AKT (decimal)
    }
  ],
  "delegations": [],             // Array of delegation objects
  "redelegations": [],           // Array of redelegation objects
  "latestTransactions": [...]    // Last 5 transactions (same structure as transactions endpoint)
}
```

#### 2. Get Address Transactions (Paginated)

```bash
GET /addresses/{address}/transactions/{skip}/{limit}

# Examples:
curl -s "https://console-api.akash.network/v1/addresses/akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5/transactions/0/10"
curl -s "https://console-api.akash.network/v1/addresses/akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5/transactions/10/10"
```

**Response Structure:**

```json
{
  "count": 5, // Total number of transactions
  "results": [
    {
      "height": 24481569,
      "datetime": "2025-12-04T18:41:56.335Z",
      "hash": "4407219321D8F430A89B3B3A788383DF292A93B8F78438377779135376B47A6C",
      "isSuccess": true,
      "error": null,
      "gasUsed": 16693330,
      "gasWanted": 20000000,
      "fee": 500000, // Fee in uakt
      "memo": "...",
      "isSigner": false, // Whether address is the transaction signer
      "messages": [
        {
          "id": "83eb0370-dfe6-48a9-a369-e26673213345",
          "type": "/cosmos.bank.v1beta1.MsgMultiSend",
          "amount": 0, // Amount in uakt (0 for MsgMultiSend, use detail endpoint)
          "isReceiver": true // Whether address is receiver in this message
        }
      ]
    }
  ]
}
```

**Pagination:**

- `skip`: Offset (0-indexed)
- `limit`: Number of results (test with different limits to find max)
- Results ordered by newest first (descending by height)

#### 3. Get Transaction Details

```bash
GET /transactions/{hash}

# Example:
curl -s "https://console-api.akash.network/v1/transactions/CB485D29C234BA4C507F30A8A9C8B8512A1151235D0BE3F84B6E36B3ACED0DA8"
```

**Response Structure:**

```json
{
  "height": 19538016,
  "datetime": "2024-12-27T15:46:28.783Z",
  "hash": "CB485D29C234BA4C507F30A8A9C8B8512A1151235D0BE3F84B6E36B3ACED0DA8",
  "isSuccess": true,
  "multisigThreshold": null,
  "signers": ["akash14pkmzwzatmv6rcwc365zypxrn7s92lfedyz85v"],
  "error": null,
  "gasUsed": 67141,
  "gasWanted": 103749,
  "fee": 5188, // Fee in uakt
  "memo": "",
  "messages": [
    {
      "id": "d5ab3124-211f-4169-a272-0bf8bf1a1bd5",
      "type": "/cosmos.bank.v1beta1.MsgSend",
      "data": {
        "from_address": "akash14pkmzwzatmv6rcwc365zypxrn7s92lfedyz85v",
        "to_address": "akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5",
        "amount": [
          {
            "denom": "uakt",
            "amount": "284870994"
          }
        ]
      },
      "relatedDeploymentId": null
    }
  ]
}
```

### Data Retention

✅ **Historical data confirmed**: December 27, 2024 transactions retrieved successfully
✅ **Likely full history**: This is a custom indexer, not a pruning node

### Implementation Guidance

#### Create Akash Console API Client

```typescript
// packages/blockchain-providers/src/blockchains/cosmos/providers/akash-console/
// akash-console.api-client.ts

export class AkashConsoleApiClient extends BaseApiClient {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: 'https://console-api.akash.network/v1',
    });
  }

  async getAddressBalances(address: string): Promise<Result<RawBalanceData, Error>> {
    const result = await this.httpClient.get(`/addresses/${address}`);
    // Parse result.assets[0].amount (already in AKT decimal)
    // Convert to uakt for consistency: amount * 1e6
  }

  async *streamAddressTransactions(address: string, resumeCursor?: CursorState) {
    let skip = resumeCursor?.metadata?.skip ?? 0;
    const limit = 100; // Test to find optimal limit

    while (true) {
      const result = await this.httpClient.get(`/addresses/${address}/transactions/${skip}/${limit}`);

      if (result.isErr() || result.value.results.length === 0) {
        break;
      }

      // Fetch full transaction details for sender/recipient info
      const enrichedTxs = await Promise.all(
        result.value.results.map((tx) => this.httpClient.get(`/transactions/${tx.hash}`))
      );

      yield ok({
        data: enrichedTxs,
        cursorState: { metadata: { skip: skip + limit } },
      });

      skip += limit;

      if (result.value.results.length < limit) {
        break; // Last page
      }
    }
  }
}
```

#### Key Implementation Notes

1. **Balance Endpoint**:
   - Returns `assets[0].amount` already in AKT decimal format
   - Convert back to `uakt` for consistency: `amount * 1e6`
   - Also provides delegation/staking info if needed

2. **Transaction List**:
   - Lightweight response (no sender/recipient in messages)
   - Use for initial pagination
   - Fetch `/transactions/{hash}` for full details when needed

3. **Transaction Details**:
   - Full `from_address` and `to_address` in message data
   - Complete amount information with denom
   - Consider batching detail fetches to reduce API calls

4. **Pagination Strategy**:
   - Use offset/limit pattern (`skip`/`limit`)
   - Store `skip` value in cursor metadata
   - Results are pre-sorted (newest first)

5. **Error Handling**:
   - Test with invalid addresses to see error format
   - Handle empty results (`.count === 0`)
   - Check rate limits (unknown, test with rapid requests)

#### Zod Schemas

```typescript
// akash-console.schemas.ts

const AkashAssetSchema = z.object({
  symbol: z.string(),
  logoUrl: z.string().optional(),
  amount: z.number(),
});

const AkashBalanceResponseSchema = z.object({
  total: z.number(),
  available: z.number(),
  delegated: z.number(),
  rewards: z.number(),
  commission: z.number(),
  assets: z.array(AkashAssetSchema),
  delegations: z.array(z.unknown()),
  redelegations: z.array(z.unknown()),
  latestTransactions: z.array(z.unknown()).optional(),
});

const AkashTransactionMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: z.number(),
  isReceiver: z.boolean().optional(),
});

const AkashTransactionSchema = z.object({
  height: z.number(),
  datetime: z.string(),
  hash: z.string(),
  isSuccess: z.boolean(),
  error: z.string().nullable(),
  gasUsed: z.number(),
  gasWanted: z.number(),
  fee: z.number(),
  memo: z.string(),
  isSigner: z.boolean(),
  messages: z.array(AkashTransactionMessageSchema),
});

const AkashTransactionListResponseSchema = z.object({
  count: z.number(),
  results: z.array(AkashTransactionSchema),
});

const AkashMessageDataSchema = z.object({
  from_address: z.string().optional(),
  to_address: z.string().optional(),
  amount: z
    .array(
      z.object({
        denom: z.string(),
        amount: z.string(),
      })
    )
    .optional(),
  // Add other message types as needed
});

const AkashTransactionDetailMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: AkashMessageDataSchema,
  relatedDeploymentId: z.string().nullable(),
});

const AkashTransactionDetailSchema = z.object({
  height: z.number(),
  datetime: z.string(),
  hash: z.string(),
  isSuccess: z.boolean(),
  multisigThreshold: z.number().nullable(),
  signers: z.array(z.string()),
  error: z.string().nullable(),
  gasUsed: z.number(),
  gasWanted: z.number(),
  fee: z.number(),
  memo: z.string(),
  messages: z.array(AkashTransactionDetailMessageSchema),
});
```

### Testing

Test address: `akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5`

- Has 5 transactions (as of 2026-01-19)
- Date range: Dec 27, 2024 - Dec 4, 2025
- Balance: 748.426495 AKT

### Comparison: Console API vs RPC

| Feature              | Console API                    | RPC API                        |
| -------------------- | ------------------------------ | ------------------------------ |
| **Historical Data**  | ✅ Full history (Dec 2024+)    | ❌ ~2 months only              |
| **Ease of Use**      | ✅ Clean REST JSON             | ⚠️ Protobuf decoding needed    |
| **Pagination**       | ✅ Simple offset/limit         | ⚠️ Page numbers                |
| **Balance Info**     | ✅ Included with staking       | ⚠️ Separate endpoints          |
| **Sender/Recipient** | ✅ Full details in tx endpoint | ✅ In events                   |
| **Rate Limits**      | ❓ Unknown (test needed)       | ✅ Known (varies by node)      |
| **Timestamp**        | ✅ Included in response        | ❌ Requires block fetch        |
| **Akash-Specific**   | ⚠️ Only works for Akash        | ✅ Works for all Cosmos chains |

**Recommendation**: Use Console API for Akash, RPC for other Cosmos chains without REST indexing.

---

## REST API Limitations (Current Implementation)

### What Doesn't Work

All event-based transaction queries via REST API return 0 results:

```bash
# Tested and confirmed NOT working on Akash REST endpoints:
GET /cosmos/tx/v1beta1/txs?events=coin_received.receiver='akash1...'  → 0 results
GET /cosmos/tx/v1beta1/txs?events=transfer.recipient='akash1...'      → 0 results
GET /cosmos/tx/v1beta1/txs?events=coin_spent.spender='akash1...'      → 0 results
GET /cosmos/tx/v1beta1/txs?events=message.sender='akash1...'          → 0 results
```

### What Does Work

Individual transaction lookups by hash work fine:

```bash
GET /cosmos/tx/v1beta1/txs/{hash}  → ✅ Returns full transaction
```

### Chains Affected

Testing revealed this affects multiple Cosmos chains:

- ✅ **Fetch.ai**: REST event indexing works
- ❌ **Akash**: REST event indexing disabled
- ❌ **Osmosis**: REST event indexing disabled

## RPC API Capabilities (Validated)

### Endpoints Tested and Working

All tested Akash RPC endpoints support transaction event indexing:

| Endpoint                              | Earliest Block | Earliest Date | Retention       |
| ------------------------------------- | -------------- | ------------- | --------------- |
| `https://rpc.akashnet.net:443`        | 24,147,513     | Nov 11, 2025  | ~54 days        |
| `https://rpc-akash.ecostake.com:443`  | 24,333,750     | Nov 24, 2025  | ~41 days        |
| `https://akash-rpc.polkachu.com:443`  | 23,939,743     | Oct 28, 2025  | **~68 days** ⭐ |
| `https://akash.c29r3.xyz:443/rpc`     | 24,342,720     | Nov 25, 2025  | ~40 days        |
| `https://akash-rpc.europlots.com:443` | (not tested)   | (not tested)  | -               |

**Note**: All nodes are pruning nodes (NOT archive nodes). Latest block as of 2026-01-04: ~24,930,805

### Working Query Patterns

#### 1. Query Transactions by Recipient (Incoming)

```bash
# Query format:
curl -s "https://rpc.akashnet.net:443/tx_search?query=\"transfer.recipient='akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5'\"&page=1&per_page=30&order_by=desc"

# Response structure:
{
  "jsonrpc": "2.0",
  "id": -1,
  "result": {
    "txs": [
      {
        "hash": "4407219321D8F430A89B3B3A788383DF292A93B8F78438377779135376B47A6C",
        "height": "24481569",
        "index": 4,
        "tx_result": {
          "code": 0,
          "data": "...",
          "log": "",
          "gas_wanted": "20000000",
          "gas_used": "16693330",
          "events": [...]
        },
        "tx": "..."  // base64 encoded transaction
      }
    ],
    "total_count": "1"
  }
}
```

#### 2. Query Transactions by Sender (Outgoing)

```bash
curl -s "https://rpc.akashnet.net:443/tx_search?query=\"message.sender='akash1...'\"&page=1&per_page=30&order_by=desc"
```

#### 3. Get Transaction by Hash

```bash
curl -s "https://rpc.akashnet.net:443/tx?hash=0x4407219321D8F430A89B3B3A788383DF292A93B8F78438377779135376B47A6C"

# Response:
{
  "jsonrpc": "2.0",
  "id": -1,
  "result": {
    "hash": "4407219321D8F430A89B3B3A788383DF292A93B8F78438377779135376B47A6C",
    "height": "24481569",
    "tx_result": {...},
    "tx": "..."
  }
}
```

#### 4. Get Block Information (for timestamps)

```bash
curl -s "https://rpc.akashnet.net:443/block?height=24481569"

# Response includes:
{
  "result": {
    "block": {
      "header": {
        "time": "2025-12-04T18:41:56.335205238Z",
        "height": "24481569",
        ...
      }
    }
  }
}
```

#### 5. Check Node Status and Retention

```bash
curl -s "https://rpc.akashnet.net:443/status"

# Returns:
{
  "result": {
    "sync_info": {
      "earliest_block_height": "24147513",
      "earliest_block_time": "2025-11-11T21:24:53.243580972Z",
      "latest_block_height": "24930805",
      "latest_block_time": "2026-01-04T14:59:11.911372053Z"
    }
  }
}
```

### Query Syntax Rules

**CRITICAL**: Query syntax is sensitive to escaping:

✅ **Correct** (use literal quotes in URL):

```bash
query="transfer.recipient='akash1...'"
```

❌ **Incorrect** (URL encoding breaks the query):

```bash
query=transfer.recipient%3D%27akash1...%27  # Returns error: "invalid character 'm'"
```

### Pagination

```bash
# Parameters:
page=1              # Page number (1-indexed)
per_page=30         # Results per page (max 100)
order_by=desc       # "asc" or "desc"
```

## Verified Transaction Example

Successfully retrieved transaction from Dec 4, 2025:

```json
{
  "hash": "4407219321D8F430A89B3B3A788383DF292A93B8F78438377779135376B47A6C",
  "height": "24481569",
  "timestamp": "2025-12-04T18:41:56.335205238Z",
  "amount": "1uakt",
  "recipient": "akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5",
  "sender": "akash1lgars47nzhfzt0mqsjrdzrx2zcg7c2sktrsrjs",
  "type": "MsgMultiSend"
}
```

## Event Attributes Reference

From actual transaction events, these attributes are indexed:

### Transfer Events

```json
{
  "type": "transfer",
  "attributes": [
    { "key": "recipient", "value": "akash1...", "index": true },
    { "key": "sender", "value": "akash1...", "index": true },
    { "key": "amount", "value": "1uakt", "index": true },
    { "key": "msg_index", "value": "0", "index": true }
  ]
}
```

### Coin Received Events

```json
{
  "type": "coin_received",
  "attributes": [
    { "key": "receiver", "value": "akash1...", "index": true },
    { "key": "amount", "value": "1uakt", "index": true },
    { "key": "msg_index", "value": "0", "index": true }
  ]
}
```

### Coin Spent Events

```json
{
  "type": "coin_spent",
  "attributes": [
    { "key": "spender", "value": "akash1...", "index": true },
    { "key": "amount", "value": "1uakt", "index": true },
    { "key": "msg_index", "value": "0", "index": true }
  ]
}
```

### Message Events

```json
{
  "type": "message",
  "attributes": [
    { "key": "sender", "value": "akash1...", "index": true },
    { "key": "action", "value": "/cosmos.bank.v1beta1.MsgMultiSend", "index": true },
    { "key": "module", "value": "bank", "index": true },
    { "key": "msg_index", "value": "0", "index": true }
  ]
}
```

## Implementation Guidance

### Architecture Pattern

Create a new provider following the existing pattern:

```
packages/blockchain-providers/src/blockchains/cosmos/providers/
├── cosmos-rest/           (existing - limited to chains with REST event indexing)
└── cosmos-rpc/            (new - for chains requiring RPC)
    ├── cosmos-rpc.api-client.ts
    ├── cosmos-rpc.schemas.ts
    ├── mapper-utils.ts
    └── __tests__/
        └── cosmos-rpc-api-client.e2e.test.ts
```

### Key Implementation Points

1. **Extend BaseApiClient**: Follow the pattern from `cosmos-rest.api-client.ts`

2. **Chain Configuration**: Use same `CosmosChainConfig` from `chain-config.interface.ts`
   - Access RPC endpoints via `chainConfig.rpcEndpoints`
   - Polkachu endpoints have longest retention (~68 days)

3. **Event Filters**:
   - Incoming: `transfer.recipient='${address}'`
   - Outgoing: `message.sender='${address}'`
   - Alternative for outgoing: `coin_spent.spender='${address}'` (not tested but likely works)

4. **Timestamp Handling**:
   - RPC `/tx_search` does NOT return timestamps in tx_result
   - Must fetch block data separately: `GET /block?height={height}`
   - Block header contains: `header.time` (RFC3339 format)
   - Consider caching block timestamps to reduce API calls

5. **Response Mapping**:
   - RPC returns `tx` as base64-encoded Protobuf
   - Must decode the transaction body to extract details
   - Events are already decoded in `tx_result.events`

6. **Pagination**:
   - RPC uses `page` and `per_page` parameters
   - No pagination tokens (unlike REST)
   - Must track page numbers in cursor state

7. **Deduplication**:
   - Merge sender and recipient results (same as REST implementation)
   - Deduplicate by txhash

8. **Error Handling**:
   - Check `response.error` field for RPC errors
   - Invalid query syntax returns: `{"code": -32602, "message": "Invalid params"}`

### Response Decoding

The `tx` field is base64-encoded Protobuf. Options:

1. Use `@cosmjs/proto-signing` to decode transaction body
2. Parse events directly (they're already decoded in `tx_result.events`)
3. Hybrid: Use events for most data, only decode tx body when needed

### Registration

Register for chains that need RPC (don't have REST event indexing):

```typescript
// In cosmos-rpc/register-apis.ts
const RPC_ONLY_CHAINS = ['akash', 'osmosis']; // Add chains as needed

for (const chainName of RPC_ONLY_CHAINS) {
  const chainConfig = COSMOS_CHAINS[chainName];
  ProviderRegistry.register({
    create: (config) => new CosmosRpcApiClient({ ...config, chainName }),
    metadata: {
      name: 'cosmos-rpc',
      displayName: `${chainConfig.displayName} RPC`,
      blockchain: chainName,
      // ... rest of metadata
    },
  });
}
```

## Data Retention Limitations

### Historical Data (Pre-October 2025)

⚠️ **Cannot be retrieved via public RPC nodes** - all are pruning nodes with ~2 month retention.

For 2024 transactions, you need:

1. Archive node (broken: `api-archive.akashedge.com`)
2. Mintscan API access (they run private archive indexer)
3. CSV export from Mintscan UI
4. Run your own archive node

### Testing Retention

```bash
# Get node retention info:
curl -s "https://akash-rpc.polkachu.com:443/status" | jq '.result.sync_info | {
  earliest_block_height,
  earliest_block_time,
  latest_block_height,
  latest_block_time
}'
```

## Next Steps

### Recommended: Implement Akash Console API Client

1. Create `AkashConsoleApiClient` class extending `BaseApiClient`
2. Implement Zod schemas (see schemas above)
3. Implement mapper utilities to transform Console API responses to `CosmosTransaction`
4. Write E2E tests using test address: `akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5`
5. Register provider specifically for Akash blockchain
6. Test pagination limits and rate limits
7. Handle MsgMultiSend and other Akash-specific message types

### Alternative: Implement Cosmos RPC Client (for other chains)

1. Create `CosmosRpcApiClient` class extending `BaseApiClient`
2. Implement Zod schemas for RPC responses (`cosmos-rpc.schemas.ts`)
3. Implement mapper utilities to transform RPC responses to `CosmosTransaction`
4. Handle timestamp fetching from block data
5. Write E2E tests
6. Register provider for chains without REST event indexing (Osmosis, etc.)
7. Update chain configs to indicate which provider to use

## Reference: Akash Chain Config

Current configuration at `packages/blockchain-providers/src/blockchains/cosmos/cosmos-chains.json`:

```json
{
  "akash": {
    "chainId": "akashnet-2",
    "chainName": "akash",
    "displayName": "Akash Network",
    "nativeCurrency": "AKT",
    "nativeDecimals": 6,
    "bech32Prefix": "akash",
    "explorerUrls": ["https://www.mintscan.io/akash"],
    "rpcEndpoints": [
      "https://rpc.akashedge.com",
      "https://akash-rpc.polkachu.com" // ⭐ Best retention: ~68 days
    ],
    "restEndpoints": [
      "https://api.akashedge.com",
      "https://akash-api.polkachu.com",
      "https://akash.api.pocket.network",
      "https://api.akashnet.net",
      "https://akash.c29r3.xyz/api"
    ],
    "nativeDenom": "uakt"
  }
}
```

## Testing Checklist

### Console API (Akash)

- [ ] Verify Console API endpoint connectivity
- [ ] Test `/addresses/{address}` balance endpoint
- [ ] Test `/addresses/{address}/transactions/{skip}/{limit}` pagination
- [ ] Test `/transactions/{hash}` detail endpoint
- [ ] Verify pagination with different limits (10, 50, 100)
- [ ] Test with address having 0 transactions
- [ ] Test with invalid address format
- [ ] Verify cursor resumption works (skip parameter)
- [ ] Check error handling for non-existent transactions
- [ ] Measure rate limits (rapid consecutive requests)
- [ ] Test MsgMultiSend message parsing
- [ ] Verify historical data retrieval (Dec 2024)
- [ ] Compare balance values: uakt vs AKT decimal conversion

### RPC API (Other Cosmos Chains)

- [ ] Verify RPC endpoint connectivity
- [ ] Test `/tx_search` with `transfer.recipient` query
- [ ] Test `/tx_search` with `message.sender` query
- [ ] Test `/tx` hash lookup
- [ ] Test `/block` timestamp fetching
- [ ] Verify pagination (multiple pages)
- [ ] Test deduplication of sender/recipient overlap
- [ ] Test with address having 0 transactions
- [ ] Verify cursor resumption works
- [ ] Check error handling for invalid queries
- [ ] Measure performance vs REST implementation
