-- Append-only log of task status transitions. Source of truth for cycle time,
-- blocked (HOLD) time, and rework/reopen detection. No backfill: historical
-- transitions are unknowable, so derived metrics accrue from creation onward.

CREATE TABLE "TaskStatusEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" "TaskStatus",
    "to" "TaskStatus" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskStatusEvent_taskId_idx" ON "TaskStatusEvent"("taskId");
CREATE INDEX "TaskStatusEvent_userId_to_idx" ON "TaskStatusEvent"("userId", "to");

ALTER TABLE "TaskStatusEvent"
    ADD CONSTRAINT "TaskStatusEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
