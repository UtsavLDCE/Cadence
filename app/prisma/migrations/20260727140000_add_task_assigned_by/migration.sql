-- Provenance for manager-assigned day tasks: who dropped this task onto the
-- member's day. Nullable; SetNull on delete of the assigner. Mirrors
-- QueueItem.assignedById.
ALTER TABLE "DailyTask" ADD COLUMN "assignedById" TEXT;

CREATE INDEX "DailyTask_assignedById_idx" ON "DailyTask"("assignedById");

ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
