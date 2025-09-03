CREATE TYPE "public"."account_type" AS ENUM('ASSET_WALLET', 'ASSET_EXCHANGE', 'ASSET_DEFI_LP', 'LIABILITY_LOAN', 'EQUITY_OPENING_BALANCE', 'EQUITY_MANUAL_ADJUSTMENT', 'INCOME_STAKING', 'INCOME_TRADING', 'INCOME_AIRDROP', 'INCOME_MINING', 'EXPENSE_FEES_GAS', 'EXPENSE_FEES_TRADE');--> statement-breakpoint
CREATE TYPE "public"."blockchain_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('CRYPTO', 'FIAT', 'NFT', 'STOCK');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'REWARD', 'STAKING', 'AIRDROP', 'MINING', 'LOAN', 'REPAYMENT', 'TRANSFER', 'GAS');--> statement-breakpoint
CREATE TYPE "public"."metadata_type" AS ENUM('string', 'number', 'json', 'boolean');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency_id" integer NOT NULL,
	"account_type" "account_type" NOT NULL,
	"network" varchar(50),
	"external_address" varchar(255),
	"source" varchar(50),
	"parent_account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blockchain_transaction_details" (
	"transaction_id" integer PRIMARY KEY NOT NULL,
	"tx_hash" varchar(100) NOT NULL,
	"block_height" integer,
	"status" "blockchain_status" NOT NULL,
	"gas_used" integer,
	"gas_price" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockchain_transaction_details_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"decimals" integer NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"network" varchar(50),
	"contract_address" varchar(100),
	"is_native" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "exchange_transaction_details" (
	"transaction_id" integer PRIMARY KEY NOT NULL,
	"order_id" varchar(100),
	"trade_id" varchar(100),
	"symbol" varchar(20),
	"side" "trade_side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"currency_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"direction" "direction" NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"source" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"data_type" "metadata_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transaction_details" ADD CONSTRAINT "blockchain_transaction_details_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_transaction_details" ADD CONSTRAINT "exchange_transaction_details_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_metadata" ADD CONSTRAINT "transaction_metadata_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_currency" ON "accounts" USING btree ("currency_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_type" ON "accounts" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "idx_accounts_source" ON "accounts" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_accounts_parent" ON "accounts" USING btree ("parent_account_id");--> statement-breakpoint
CREATE INDEX "idx_blockchain_tx_hash" ON "blockchain_transaction_details" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_blockchain_status" ON "blockchain_transaction_details" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_blockchain_block_height" ON "blockchain_transaction_details" USING btree ("block_height");--> statement-breakpoint
CREATE INDEX "idx_exchange_order_id" ON "exchange_transaction_details" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_trade_id" ON "exchange_transaction_details" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_symbol" ON "exchange_transaction_details" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_entries_account_currency" ON "entries" USING btree ("account_id","currency_id");--> statement-breakpoint
CREATE INDEX "idx_entries_transaction" ON "entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_entries_currency" ON "entries" USING btree ("currency_id");--> statement-breakpoint
CREATE INDEX "idx_entries_type" ON "entries" USING btree ("entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "external_id_source_idx" ON "ledger_transactions" USING btree ("external_id","source");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_date" ON "ledger_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "idx_ledger_transactions_source" ON "ledger_transactions" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_transaction_metadata_key" ON "transaction_metadata" USING btree ("transaction_id","key");--> statement-breakpoint
CREATE INDEX "idx_metadata_transaction" ON "transaction_metadata" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_metadata_key" ON "transaction_metadata" USING btree ("key");