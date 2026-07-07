import type { Prisma } from "@prisma/client";

// Write surface shared by the root client and a $transaction client, so
// recomputeActualHours works standalone or inside an existing transaction.
type WorkLogWriter = {
  workLog: {
    aggregate: (args: {
      where: { taskId: string };
      _sum: { hours: true };
    }) => Promise<{ _sum: { hours: number | null } }>;
  };
  dailyTask: {
    update: (args: {
      where: { id: string };
      data: { actualHours: number | null };
    }) => unknown;
  };
};

// A task's actualHours mirrors the SUM of its work-log entries. Recompute it after
// any entry is added or removed so every existing effort/insights read (which all
// use DailyTask.actualHours) stays correct without knowing worklogs exist. Entries
// always carry hours > 0, so a null sum means "no entries" and actualHours is
// cleared back to null (unlogged), not zeroed. Rounded to 2 dp to avoid float dust.
export async function recomputeActualHours(
  db: WorkLogWriter,
  taskId: string,
): Promise<number | null> {
  const agg = await db.workLog.aggregate({ where: { taskId }, _sum: { hours: true } });
  const sum = agg._sum.hours;
  const actualHours = sum === null ? null : Math.round(sum * 100) / 100;
  await db.dailyTask.update({ where: { id: taskId }, data: { actualHours } });
  return actualHours;
}

// Nested include for returning a task's work-log entries, newest-worked first.
// Reused by every route/page that echoes a task with its log.
export const WORKLOG_INCLUDE = {
  workLogs: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
} satisfies Prisma.DailyTaskInclude;

// Parse an untrusted hours value from a request body. Must be a finite number > 0.
export function parseLogHours(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // One decimal of precision is plenty for effort; cap the magnitude so a typo
  // can't record a 10000h entry.
  return n > 24 ? null : Math.round(n * 100) / 100;
}
