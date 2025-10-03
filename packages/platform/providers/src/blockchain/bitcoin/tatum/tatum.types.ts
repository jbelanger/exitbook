// Tatum API response types
export interface TatumBitcoinTransaction {
  block: string;
  blockNumber: number;
  fee: number;
  hash: string;
  hex: string;
  index: number;
  inputs: TatumBitcoinInput[];
  locktime: number;
  outputs: TatumBitcoinOutput[];
  size: number;
  time: number;
  version: number;
  vsize: number;
  weight: number;
  witnessHash: string;
}

export interface TatumBitcoinInput {
  coin: {
    address: string;
    coinbase: boolean;
    height: number;
    reqSigs?: number | undefined;
    script: string;
    type?: string | undefined;
    value: number;
    version: number;
  };
  prevout: {
    hash: string;
    index: number;
  };
  script: string;
  sequence: number;
}

export interface TatumBitcoinOutput {
  address?: string | undefined;
  script: string;
  scriptPubKey: {
    reqSigs?: number | undefined;
    type: string;
  };
  value: number;
}

export interface TatumBitcoinBalance {
  incoming: string;
  outgoing: string;
}
