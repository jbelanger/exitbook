import type { UniversalExchangeAdapterConfig } from "@crypto/core";
import type { Exchange } from "ccxt";
import { BaseCCXTAdapter } from "./base-ccxt-adapter.ts";

export class CCXTAdapter extends BaseCCXTAdapter {
  constructor(
    exchange: Exchange,
    exchangeId: string,
    enableOnlineVerification: boolean = false,
  ) {
    const config: UniversalExchangeAdapterConfig = {
      type: "exchange",
      id: exchangeId,
      subType: "ccxt",
    };

    super(exchange, config, enableOnlineVerification);
  }

  protected createExchange(): Exchange {
    // Exchange is already created and passed in constructor
    return this.exchange;
  }
}
