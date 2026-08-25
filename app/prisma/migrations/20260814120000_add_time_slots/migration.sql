-- Time Audit: manager-only slots pinning a task to a focused start/end window
-- with optional live timer. planned* stored as minutes-from-midnight int.
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "taskId" TEXT NOT NULL,
    "plannedStart" INTEGER NOT NULL,
    "plannedEnd" INTEGER NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimeSlot_userId_date_idx" ON "TimeSlot"("userId", "date");
CREATE INDEX "TimeSlot_taskId_idx" ON "TimeSlot"("taskId");

ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
