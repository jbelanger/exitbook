CREATE TABLE "users" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" varchar(255) NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"name" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_parent_account_id_accounts_id_fk";
--> statement-breakpoint
DROP INDEX "external_id_source_idx";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_user_id" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_entries_user_id" ON "entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_external_id_source" ON "ledger_transactions" USING btree ("user_id","external_id","source");--> statement-breakpoint
CREATE INDEX "idx_ledger_tx_user_date" ON "ledger_transactions" USING btree ("user_id","transaction_date");--> statement-breakpoint
CREATE INDEX "idx_ledger_tx_user_source" ON "ledger_transactions" USING btree ("user_id","source");