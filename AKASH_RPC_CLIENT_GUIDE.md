# Akash RPC Client Implementation Guide

## Executive Summary

**Problem**: Akash REST API (`/cosmos/tx/v1beta1/txs`) does NOT have transaction event indexing enabled. All event-based queries return 0 results, making it impossible to fetch transactions by address.

**Solution**: Implement a Cosmos RPC client using CometBFT's `/tx_search` endpoint, which DOES have event indexing enabled on Akash nodes.

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

1. Create `CosmosRpcApiClient` class extending `BaseApiClient`
2. Implement Zod schemas for RPC responses (`cosmos-rpc.schemas.ts`)
3. Implement mapper utilities to transform RPC responses to `CosmosTransaction`
4. Handle timestamp fetching from block data
5. Write E2E tests using Akash test address: `akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5`
6. Register provider for Akash and other affected chains
7. Update chain configs to indicate which provider to use (REST vs RPC)

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
