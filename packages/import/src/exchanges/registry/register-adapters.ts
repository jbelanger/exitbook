// Import all exchange adapters to trigger their registration
// This must be imported before using the ExchangeAdapterRegistry

// CSV Adapters
import '../kraken/csv-adapter.ts';
import '../kucoin/csv-adapter.ts';
import '../ledgerlive/csv-adapter.ts';

// CCXT Adapters
import '../coinbase/ccxt-adapter.ts';

// Note: Generic CCXTAdapter is handled dynamically in the factory
// since it's not exchange-specific