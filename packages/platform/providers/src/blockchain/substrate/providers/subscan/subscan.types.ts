/**
 * Subscan API-specific types for Substrate chains (Polkadot, Kusama, etc.)
 */

// Account display metadata
export interface SubscanAccountDisplay {
  account_index?: string;
  address?: string;
  display?: string;
  evm_address?: string;
  evm_contract?: {
    contract_name?: string;
    verify_source?: string;
  };
  identity?: boolean;
  judgements?: {
    index: number;
    judgement: string;
  }[];
  merkle?: {
    address_type?: string;
    tag_name?: string;
    tag_subtype?: string;
    tag_type?: string;
  };
  parent?: {
    address?: string;
    display?: string;
    identity?: boolean;
    sub_symbol?: string;
  };
  people?: {
    display?: string;
    identity?: boolean;
    judgements?: {
      index: number;
      judgement: string;
    }[];
    parent?: {
      address?: string;
      display?: string;
      identity?: boolean;
      sub_symbol?: string;
    };
  };
}

// NFT/Item metadata
export interface SubscanItemDetail {
  collection_symbol?: string;
  fallback_image?: string;
  image?: string;
  local_image?: string;
  media?: {
    types?: string;
    url?: string;
  }[];
  symbol?: string;
  thumbnail?: string;
}

// Subscan API response types
export interface SubscanTransfer {
  amount: string;
  amount_v2?: string;
  asset_symbol?: string;
  asset_type?: string;
  asset_unique_id?: string;
  block_num: number;
  block_timestamp: Date;
  currency_amount?: string;
  current_currency_amount?: string;
  event_idx?: number;
  extrinsic_index: string;
  fee: string;
  from: string;
  from_account_display?: SubscanAccountDisplay;
  hash: string;
  is_lock?: boolean;
  item_detail?: SubscanItemDetail;
  item_id?: string;
  module: string;
  nonce?: number;
  success: boolean;
  to: string;
  to_account_display?: SubscanAccountDisplay;
  transfer_id?: number;
}

/**
 * Augmented transfer with chain config data
 */
export interface SubscanTransferAugmented extends SubscanTransfer {
  _nativeCurrency: string;
  _nativeDecimals: number;
  _chainDisplayName: string;
}

export interface SubscanTransfersResponse {
  code: number;
  data?: {
    count?: number;
    total?: Record<
      string,
      {
        received?: string;
        sent?: string;
        total?: string;
      }
    >;
    transfers: SubscanTransfer[];
  };
  generated_at?: number;
  message?: string;
}

export interface SubscanAccountData {
  account_display?: {
    address?: string;
  };
  address?: string;
  balance?: string;
  balance_lock?: string;
  bonded?: string;
  democracy_lock?: string;
  election_lock?: string;
  is_council_member?: boolean;
  is_evm_contract?: boolean;
  is_fellowship_member?: boolean;
  is_registrar?: boolean;
  is_techcomm_member?: boolean;
  lock?: string;
  nonce?: number;
  reserved?: string;
  unbonding?: string;
  vesting?: string;
  // Note: for special accounts (like treasury), this might be a hex string
  account?: string;
}

export interface SubscanAccountResponse {
  code: number;
  data?: SubscanAccountData;
  generated_at?: number;
  message?: string;
}
