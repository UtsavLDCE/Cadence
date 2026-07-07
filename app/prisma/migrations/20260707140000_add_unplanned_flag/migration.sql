-- Explicit unplanned-work flag on DailyTask. Replaces overloading
-- workType = 'INTERRUPTION' as the firefighting proxy.
ALTER TABLE "DailyTask" ADD COLUMN "unplanned" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every task previously flagged INTERRUPTION was unplanned work, so
-- historical firefighting numbers are preserved under the new flag.
UPDATE "DailyTask" SET "unplanned" = true WHERE "workType" = 'INTERRUPTION';
