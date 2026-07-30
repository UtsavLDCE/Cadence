import { prisma } from "@/lib/prisma";
import { MAX_TASK_HOURS, WORKDAY_HOURS } from "@/lib/task-status";

// Admin-configurable planning caps, read from the AppSettings singleton. Server
// enforcement routes call this instead of the task-status constants so the
// admin's overrides take effect. Falls back to the defaults if the row is
// somehow absent (never in practice — every settings-touching page upserts it).
export async function hourLimits(): Promise<{ maxTaskHours: number; workdayHours: number }> {
  const s = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { maxTaskHours: true, workdayHours: true },
  });
  return {
    maxTaskHours: s?.maxTaskHours ?? MAX_TASK_HOURS,
    workdayHours: s?.workdayHours ?? WORKDAY_HOURS,
  };
}
