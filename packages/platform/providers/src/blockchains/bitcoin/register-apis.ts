// Import all Bitcoin API clients to trigger their registration
//import './blockcypher/blockcypher.api-client.js'; // Disabled, rate limits too low
import './providers/blockstream/blockstream-api-client.js';
//import './blockchain-com/blockchain-com.api-client.js'; // Disabled, timing out frequently
import './providers/mempool-space/mempool-space-api-client.js';
import './providers/tatum/tatum-bcash.api-client.js';
import './providers/tatum/tatum-bitcoin.api-client.js';
import './providers/tatum/tatum-dogecoin.api-client.js';
import './providers/tatum/tatum-litecoin.api-client.js';
