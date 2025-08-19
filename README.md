# CCXT Crypto Transaction Import Tool

A comprehensive tool for importing and verifying cryptocurrency transactions from various exchanges using multiple adapter types.

## Features

- **Multi-Exchange Support**: Import transactions from KuCoin, Kraken, Coinbase, and other exchanges
- **Multiple Adapter Types**: Choose between CCXT, native, or universal SDK implementations
- **Transaction Types**: Supports trades, deposits, withdrawals, orders, and ledger entries
- **Deduplication**: Intelligent duplicate detection and removal
- **Balance Verification**: Compare calculated vs. live balances
- **Flexible Configuration**: Environment-based credentials and configurable options

## Exchange Adapters

This tool supports multiple adapter types for different exchanges:

### Adapter Types

1. **CCXT Adapter** (`ccxt`): Uses the CCXT library for broad exchange support
2. **Native Adapter** (`native`): Direct API implementation for optimal performance
3. **Universal Adapter** (`universal`): Future support for exchange-specific SDKs

### KuCoin Implementation

For KuCoin, the tool now uses a **native adapter** that:

- Connects directly to KuCoin's API v2
- Provides comprehensive ledger data including trades, deposits, withdrawals
- Implements proper rate limiting and authentication
- Supports both sandbox and production environments
- Offers better error handling and logging

### Configuration

Configure exchanges in `config/exchanges.json`:

```json
{
  "exchanges": {
    "kucoin": {
      "enabled": true,
      "adapterType": "native",
      "credentials": {
        "apiKey": "env:KUCOIN_API_KEY",
        "secret": "env:KUCOIN_SECRET",
        "password": "env:KUCOIN_PASSPHRASE",
        "sandbox": false
      },
      "options": {
        "rateLimit": 1000
      }
    }
  }
}
```

#### Adapter Type Selection

The tool automatically selects the best adapter type for each exchange:

- **KuCoin**: `native` (recommended for comprehensive data)
- **Other exchanges**: `ccxt` (stable and well-tested)

You can override the adapter type in configuration or via command line options.

## Installation

```bash
npm install
```

## Environment Variables

Set up your API credentials:

```bash
# KuCoin
export KUCOIN_API_KEY="your_api_key"
export KUCOIN_SECRET="your_secret"
export KUCOIN_PASSPHRASE="your_passphrase"

# Other exchanges
export KRAKEN_API_KEY="your_api_key"
export KRAKEN_SECRET="your_secret"
```

## Usage

```bash
# Import from all configured exchanges
npm run import

# Import from specific exchange
npm run import -- --exchange kucoin

# Import with verification
npm run import:verify

# Force specific adapter type
npm run import -- --force-adapter native
```

## Command Line Options

- `--exchange <name>`: Filter by exchange name
- `--since <timestamp>`: Import transactions since timestamp
- `--verify`: Verify balances after import
- `--verbose`: Enable detailed logging
- `--force-adapter <type>`: Force specific adapter type (ccxt|native|universal)

## Architecture

The tool uses a flexible adapter pattern:

```
TransactionImporter
├── ExchangeAdapterFactory
├── CCXTAdapter (for most exchanges)
├── KuCoinAdapter (native implementation)
└── Database (SQLite storage)
```

### Key Components

- **IExchangeAdapter**: Common interface for all exchange implementations
- **ExchangeAdapterFactory**: Creates appropriate adapters based on configuration
- **Transaction Enhancer**: Adds metadata and deduplication hashing
- **Balance Verifier**: Compares imported vs. live balances

## Development

### Adding New Exchange Adapters

1. Implement `IExchangeAdapter` interface
2. Add to `ExchangeAdapterFactory`
3. Update configuration schema
4. Add tests

### Testing

```bash
npm test
```

## Troubleshooting

### KuCoin Authentication Issues

- Ensure API key has required permissions (General, Trade, Transfer)
- Verify passphrase matches the one used during API key creation
- Check if using v2 API key format

### Rate Limiting

- Adjust `rateLimit` in exchange configuration
- Monitor logs for rate limit warnings
- Consider upgrading to higher API tier

## Future Enhancements

- KuCoin Universal SDK integration
- Additional native adapters for other exchanges
- WebSocket real-time transaction monitoring
- Advanced balance reconciliation
- Transaction categorization and reporting
