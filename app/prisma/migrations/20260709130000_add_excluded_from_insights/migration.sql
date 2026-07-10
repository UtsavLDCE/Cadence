-- Add User.excludedFromInsights. Field existed in schema but was applied via
-- `db push` in dev without a migration, so fresh `migrate deploy` never created
-- the column. IF NOT EXISTS keeps drifted dev DBs (that already have it) idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "excludedFromInsights" BOOLEAN NOT NULL DEFAULT false;
