// Import all Bitcoin processors to trigger their registration
//import './blockcypher/blockcypher.mapper.js'; // Disabled, rate limits too low
import './blockstream/blockstream.mapper.js';
//import './blockchain-com/blockchain-com.mapper.js'; // Disabled, timing out frequently
import './mempool-space/mempool-space.mapper.js';
import './tatum/tatum.mapper.js';
