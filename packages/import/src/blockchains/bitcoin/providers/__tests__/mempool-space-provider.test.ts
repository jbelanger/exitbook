import { beforeEach, describe, expect, it, vi } from "vitest";
import { MempoolSpaceProvider } from "../MempoolSpaceProvider.ts";
import type { BlockchainTransaction } from "../../types.ts";

// Mock fetch globally
global.fetch = vi.fn();

describe("MempoolSpaceProvider", () => {
  let provider: MempoolSpaceProvider;
  const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new MempoolSpaceProvider();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Provider Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(provider.name).toBe("mempool.space");
      expect(provider.blockchain).toBe("bitcoin");
      expect(provider.capabilities.supportedOperations).toContain(
        "getAddressTransactions",
      );
      expect(provider.capabilities.supportedOperations).toContain(
        "getAddressBalance",
      );
    });

    it("should initialize with custom configuration", () => {
      const customProvider = new MempoolSpaceProvider({
        baseUrl: "https://custom.mempool.space/api",
        timeout: 5000,
        retries: 5,
      });

      expect(customProvider.name).toBe("mempool.space");
      expect(customProvider.blockchain).toBe("bitcoin");
    });

    it("should have correct rate limiting configuration", () => {
      expect(provider.rateLimit.requestsPerSecond).toBe(0.25);
      expect(provider.rateLimit.burstLimit).toBe(1);
    });

    it("should have correct capabilities", () => {
      const capabilities = provider.capabilities;
      expect(capabilities.maxBatchSize).toBe(25);
      expect(capabilities.supportsHistoricalData).toBe(true);
      expect(capabilities.supportsPagination).toBe(true);
      expect(capabilities.supportsRealTimeData).toBe(true);
      expect(capabilities.supportsTokenData).toBe(false);
    });
  });

  describe("Health Checks", () => {
    it("should report healthy when API is accessible", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => 750000,
      } as Response);

      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://mempool.space/api/blocks/tip/height",
      );
    });

    it("should report unhealthy when API is down", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(false);
    });

    it("should report unhealthy when API returns invalid data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => null,
      } as Response);

      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(false);
    });
  });

  describe("Connection Testing", () => {
    it("should pass connection test with valid response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => 750123,
      } as Response);

      const connectionTest = await provider.testConnection();
      expect(connectionTest).toBe(true);
    });

    it("should fail connection test with invalid response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => "invalid",
      } as Response);

      const connectionTest = await provider.testConnection();
      expect(connectionTest).toBe(false);
    });

    it("should fail connection test on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const connectionTest = await provider.testConnection();
      expect(connectionTest).toBe(false);
    });
  });

  describe("Address Transactions", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
    const mockAddressInfo = {
      address: testAddress,
      chain_stats: {
        tx_count: 2,
        funded_txo_sum: 200000000,
        spent_txo_sum: 100000000,
      },
      mempool_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 },
    };

    const mockTransactionIds = [
      "txid1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "txid2345678901bcdefg2345678901bcdefg2345678901bcdefg2345678901bcdefg",
    ];

    const mockTransaction = {
      txid: "txid1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      version: 2,
      locktime: 0,
      vin: [
        {
          txid: "prev_tx_id",
          vout: 0,
          prevout: {
            scriptpubkey: "script",
            scriptpubkey_asm: "asm",
            scriptpubkey_type: "p2pkh",
            scriptpubkey_address: "sender_address",
            value: 100000000,
          },
          scriptsig: "sig",
          scriptsig_asm: "sig_asm",
          witness: [],
          is_coinbase: false,
          sequence: 0xffffffff,
        },
      ],
      vout: [
        {
          scriptpubkey: "script",
          scriptpubkey_asm: "asm",
          scriptpubkey_type: "p2pkh",
          scriptpubkey_address: testAddress,
          value: 99000000,
        },
      ],
      size: 225,
      weight: 900,
      fee: 1000000,
      status: {
        confirmed: true,
        block_height: 750000,
        block_hash: "block_hash_123",
        block_time: 1640995200,
      },
    };

    it("should fetch address transactions successfully", async () => {
      // Mock address info call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAddressInfo,
      } as Response);

      // Mock transaction IDs call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTransactionIds,
      } as Response);

      // Mock transaction details calls
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTransaction,
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockTransaction, txid: mockTransactionIds[1] }),
      } as Response);

      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(transactions).toHaveLength(2);
      expect(transactions[0]).toMatchObject({
        hash: expect.stringMatching(/^txid/),
        blockNumber: 750000,
        timestamp: 1640995200,
        status: "success",
        type: "transfer_in",
      });
    });

    it("should return empty array for address with no transactions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockAddressInfo,
          chain_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as Response);

      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(transactions).toEqual([]);
    });

    it("should filter transactions by timestamp when since parameter is provided", async () => {
      const futureTimestamp = 1640995300; // After mock transaction

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAddressInfo,
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTransactionIds,
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTransaction,
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTransaction,
      } as Response);

      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress, since: futureTimestamp },
      });

      expect(transactions).toEqual([]);
    });

    it("should handle API errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("API Error"));

      await expect(
        provider.execute({
          type: "getAddressTransactions",
          params: { address: testAddress },
        }),
      ).rejects.toThrow("API Error");
    });

    it("should handle rate limiting with retry", async () => {
      // First call fails with rate limit
      mockFetch.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockAddressInfo,
          chain_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as Response);

      // Should not throw error due to retry mechanism
      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(transactions).toEqual([]);
    });
  });

  describe("Address Balance", () => {
    const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
    const mockAddressInfo = {
      address: testAddress,
      chain_stats: { funded_txo_sum: 200000000, spent_txo_sum: 100000000 },
      mempool_stats: { funded_txo_sum: 50000000, spent_txo_sum: 25000000 },
    };

    it("should fetch address balance successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAddressInfo,
      } as Response);

      const result = await provider.execute({
        type: "getAddressBalance",
        params: { address: testAddress },
      });

      // Balance = (chain funded - chain spent) + (mempool funded - mempool spent)
      // = (200000000 - 100000000) + (50000000 - 25000000) = 100000000 + 25000000 = 125000000 sats = 1.25 BTC
      expect(result).toEqual({
        balance: "1.25",
        token: "BTC",
      });
    });

    it("should handle zero balance", async () => {
      const zeroBalanceInfo = {
        ...mockAddressInfo,
        chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 100000000 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => zeroBalanceInfo,
      } as Response);

      const result = await provider.execute({
        type: "getAddressBalance",
        params: { address: testAddress },
      });

      expect(result).toEqual({
        balance: "0",
        token: "BTC",
      });
    });

    it("should handle API errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Balance API Error"));

      await expect(
        provider.execute({
          type: "getAddressBalance",
          params: { address: testAddress },
        }),
      ).rejects.toThrow("Balance API Error");
    });
  });

  describe("Error Handling", () => {
    it("should throw error for unsupported operations", async () => {
      await expect(
        provider.execute({
          type: "unsupportedOperation" as "getAddressTransactions",
          params: {},
        }),
      ).rejects.toThrow("Unsupported operation: unsupportedOperation");
    });

    it("should handle HTTP error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server Error",
      } as Response);

      await expect(
        provider.execute({
          type: "getAddressBalance",
          params: { address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" },
        }),
      ).rejects.toThrow();
    });

    it("should handle timeout errors", async () => {
      const abortError = new Error("Request timeout");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(
        provider.execute({
          type: "getAddressBalance",
          params: { address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("Rate Limiting", () => {
    it("should handle 429 responses with retry", async () => {
      // First call returns 429
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Map([["Retry-After", "2"]]),
        text: async () => "Rate limited",
        // Add missing Response properties
        redirected: false,
        type: "basic",
        url: "https://mempool.space/api/address/test",
        clone: vi.fn(),
        body: null,
        bodyUsed: false,
        arrayBuffer: vi.fn(),
        blob: vi.fn(),
        formData: vi.fn(),
        json: vi.fn(),
      } as unknown as Response);

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as Response);

      const result = await provider.execute({
        type: "getAddressBalance",
        params: { address: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2" },
      });

      expect(result.balance).toBe("0");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("Transaction Transformation", () => {
    it("should correctly classify deposit transactions", async () => {
      const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
      const depositTransaction = {
        txid: "deposit_tx_id",
        vin: [
          {
            prevout: {
              scriptpubkey_address: "other_address",
              value: 100000000,
            },
          },
        ],
        vout: [{ scriptpubkey_address: testAddress, value: 99000000 }],
        fee: 1000000,
        status: {
          confirmed: true,
          block_height: 750000,
          block_hash: "hash",
          block_time: 1640995200,
        },
        version: 2,
        locktime: 0,
        size: 225,
        weight: 900,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chain_stats: {
            tx_count: 1,
            funded_txo_sum: 99000000,
            spent_txo_sum: 0,
          },
          mempool_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ["deposit_tx_id"],
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => depositTransaction,
      } as Response);

      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(transactions[0].type).toBe("transfer_in");
      expect(transactions[0].value.amount.toString()).toBe("0.99");
    });

    it("should correctly classify withdrawal transactions", async () => {
      const testAddress = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
      const withdrawalTransaction = {
        txid: "withdrawal_tx_id",
        vin: [
          { prevout: { scriptpubkey_address: testAddress, value: 100000000 } },
        ],
        vout: [{ scriptpubkey_address: "other_address", value: 99000000 }],
        fee: 1000000,
        status: {
          confirmed: true,
          block_height: 750000,
          block_hash: "hash",
          block_time: 1640995200,
        },
        version: 2,
        locktime: 0,
        size: 225,
        weight: 900,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chain_stats: {
            tx_count: 1,
            funded_txo_sum: 100000000,
            spent_txo_sum: 100000000,
          },
          mempool_stats: { tx_count: 0, funded_txo_sum: 0, spent_txo_sum: 0 },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ["withdrawal_tx_id"],
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => withdrawalTransaction,
      } as Response);

      const transactions = await provider.execute({
        type: "getAddressTransactions",
        params: { address: testAddress },
      });

      expect(transactions[0].type).toBe("transfer_out");
      expect(transactions[0].value.amount.toString()).toBe("1");
    });
  });
});
