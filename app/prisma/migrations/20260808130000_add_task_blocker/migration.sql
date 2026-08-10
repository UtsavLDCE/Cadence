-- Cross-person dependency: who this task is blocked on. Powers the "Waiting on
-- you" list on the blocked-on person's My Day so they can prioritize their day
-- around teammates waiting on them.
ALTER TABLE "DailyTask" ADD COLUMN "blockedOnUserId" TEXT;

ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_blockedOnUserId_fkey"
  FOREIGN KEY ("blockedOnUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DailyTask_blockedOnUserId_status_idx" ON "DailyTask"("blockedOnUserId", "status");
